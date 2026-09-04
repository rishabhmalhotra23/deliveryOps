// Canonical FDE/TAM/Partner roster (0032). See lib/processes/store.ts's
// updateProcess() for how a plain-text owner/partner edit resolves into a
// roster entry via resolveOrCreateRosterEntry, keeping the FK and the
// legacy text column on `processes` in lockstep on every write.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type RosterEntry, type RosterKind } from "@/lib/supabase/types";

export class RosterEntryNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Unknown roster entry: ${id}`);
    this.name = "RosterEntryNotFoundError";
  }
}

export class InvalidRosterInputError extends Error {}

export interface RosterFilter {
  kind?: RosterKind;
  /** Preferred role. Deliberately a RANKING hint, not a filter — see
   *  listRosterEntries. */
  role?: string;
  q?: string;
  active?: boolean;
}

export async function getRosterEntry(id: string): Promise<RosterEntry | null> {
  const sb = requireAdmin();
  const { data, error } = await sb.from(TABLES.rosterEntries).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as RosterEntry | null) ?? null;
}

/** `filter.role` ranks, it does NOT restrict.
 *
 *  It used to be `roles @> {role}`. 0033 created every roster row without
 *  touching `roles`, so all 27 sat at the '{}' default and the FDE and TAM
 *  pickers — which pass role="fde"/"tam" — matched zero rows and were
 *  permanently empty. 0037 backfills the column from real usage, but a strict
 *  filter would reintroduce exactly the same failure for the next person
 *  added without a role set, and the failure mode is silent: an empty
 *  dropdown looks like an empty roster.
 *
 *  So a missing role can only ever cost you your position in the list. The
 *  picker groups on the same boundary this sort produces. */
export async function listRosterEntries(filter: RosterFilter = {}): Promise<RosterEntry[]> {
  const sb = requireAdmin();
  let q = sb.from(TABLES.rosterEntries).select("*").is("merged_into_id", null);
  if (filter.kind) q = q.eq("kind", filter.kind);
  if (typeof filter.active === "boolean") q = q.eq("active", filter.active);
  if (filter.q && filter.q.trim()) q = q.ilike("display_name", `%${filter.q.trim()}%`);
  q = q.order("display_name", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return rankByRole((data as RosterEntry[]) ?? [], filter.role);
}

/** Role-holders first, then everyone else; alphabetical within each group.
 *  A stable partition rather than a score, so the picker can find the group
 *  boundary by testing the same predicate. */
export function rankByRole<T extends { display_name: string; roles: string[] }>(
  entries: T[],
  role?: string
): T[] {
  if (!role) return entries;
  const holds = (e: T) => e.roles.includes(role);
  return [
    ...entries.filter(holds).sort((a, b) => a.display_name.localeCompare(b.display_name)),
    ...entries.filter((e) => !holds(e)).sort((a, b) => a.display_name.localeCompare(b.display_name)),
  ];
}

export interface RosterSearchHit extends RosterEntry {
  /** Set when this hit came from an alias match rather than the display name
   *  itself — the Roster Picker surfaces this as `matched "alias"` so a pick
   *  is never a silent surprise. */
  matched_alias?: string;
}

/** Search variant of listRosterEntries used by the Roster Picker's
 *  type-ahead: also matches on `roster_aliases`, so old spellings ("karthik
 *  n") keep resolving to the canonical entry instead of only exact-name
 *  substring matches. Falls back to plain listRosterEntries behaviour when
 *  `q` is empty. */
export async function searchRosterEntries(filter: RosterFilter = {}): Promise<RosterSearchHit[]> {
  const query = filter.q?.trim();
  if (!query) return listRosterEntries(filter);

  const sb = requireAdmin();
  let nameQuery = sb.from(TABLES.rosterEntries).select("*").is("merged_into_id", null).ilike("display_name", `%${query}%`);
  if (filter.kind) nameQuery = nameQuery.eq("kind", filter.kind);
  if (typeof filter.active === "boolean") nameQuery = nameQuery.eq("active", filter.active);
  const { data: nameData, error: nameError } = await nameQuery.order("display_name", { ascending: true });
  if (nameError) throw nameError;
  const nameHits = (nameData as RosterEntry[]) ?? [];
  const seen = new Set(nameHits.map((e) => e.id));

  const { data: aliasRows, error: aliasError } = await sb
    .from(TABLES.rosterAliases)
    .select("alias, roster_entry_id")
    .ilike("alias", `%${query}%`)
    .limit(10);
  if (aliasError) throw aliasError;

  const hits: RosterSearchHit[] = [...nameHits];
  for (const row of (aliasRows as { alias: string; roster_entry_id: string }[] | null) ?? []) {
    if (seen.has(row.roster_entry_id)) continue;
    const entry = await getRosterEntry(row.roster_entry_id);
    if (!entry) continue;
    if (entry.merged_into_id) continue;
    if (filter.kind && entry.kind !== filter.kind) continue;
    if (typeof filter.active === "boolean" && entry.active !== filter.active) continue;
    seen.add(entry.id);
    hits.push({ ...entry, matched_alias: row.alias });
  }
  // Same ranking contract as listRosterEntries: role orders, never excludes.
  return rankByRole(
    hits.sort((a, b) => a.display_name.localeCompare(b.display_name)),
    filter.role
  );
}

export interface CreateRosterEntryInput {
  kind: RosterKind;
  display_name: string;
  email?: string | null;
  roles?: string[];
}

export async function createRosterEntry(
  input: CreateRosterEntryInput
): Promise<RosterEntry> {
  const display_name = input.display_name.trim();
  if (!display_name) throw new InvalidRosterInputError("display_name is required.");

  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .insert({
      kind: input.kind,
      display_name,
      email: input.email || null,
      roles: input.roles ?? [],
    })
    .select("*")
    .single();
  if (error) throw error;

  await addAlias(display_name, (data as RosterEntry).id);
  return data as RosterEntry;
}

async function addAlias(raw: string, rosterEntryId: string): Promise<void> {
  const sb = requireAdmin();
  const alias = raw.trim().toLowerCase();
  if (!alias) return;
  const { error } = await sb
    .from(TABLES.rosterAliases)
    .upsert({ alias, roster_entry_id: rosterEntryId }, { onConflict: "alias", ignoreDuplicates: true });
  if (error) throw error;
}

/** Follows merged_into_id so a stale alias never resolves to a deactivated
 *  loser after a merge. */
async function resolveLiveEntry(entry: RosterEntry): Promise<RosterEntry> {
  const sb = requireAdmin();
  let current = entry;
  while (current.merged_into_id) {
    const { data, error } = await sb
      .from(TABLES.rosterEntries)
      .select("*")
      .eq("id", current.merged_into_id)
      .single();
    if (error) throw error;
    current = data as RosterEntry;
  }
  return current;
}

/** Find-or-create: resolves a free-typed name to a canonical roster entry,
 *  creating a new one (plus its alias) the first time this exact string is
 *  seen. Called from updateProcess() whenever a drawer edit sends plain text
 *  for an owner/partner field instead of an already-picked roster id, so the
 *  roster can never silently fall out of sync going forward. */
export async function resolveOrCreateRosterEntry(
  kind: RosterKind,
  rawName: string,
  /** The role this name is being used in (fde/tam/engg). Added to the entry's
   *  `roles` if it isn't there yet, so the 0037 backfill keeps holding as new
   *  people arrive by the free-text path rather than decaying back to the
   *  all-'{}' state that broke the pickers in the first place. */
  role?: string
): Promise<RosterEntry> {
  const trimmed = rawName.trim();
  if (!trimmed) throw new InvalidRosterInputError("A name is required.");
  const alias = trimmed.toLowerCase();

  const sb = requireAdmin();
  const { data: aliasRow, error: aliasError } = await sb
    .from(TABLES.rosterAliases)
    .select("roster_entry_id")
    .eq("alias", alias)
    .maybeSingle();
  if (aliasError) throw aliasError;

  if (aliasRow) {
    const { data, error } = await sb
      .from(TABLES.rosterEntries)
      .select("*")
      .eq("id", (aliasRow as { roster_entry_id: string }).roster_entry_id)
      .single();
    if (error) throw error;
    return ensureRole(await resolveLiveEntry(data as RosterEntry), role);
  }

  // No alias yet -- a canonical entry with this exact (case-insensitive)
  // display name may already exist (created moments earlier by a concurrent
  // caller, or seeded by 0033's backfill with different original casing).
  // roster_entries_kind_name_idx is a functional index on
  // (kind, lower(display_name)), which PostgREST's upsert can't target via
  // onConflict, so this does an explicit find-then-insert instead, with a
  // unique-violation retry to stay race-safe.
  const existing = await findEntryByName(kind, trimmed);
  const entry = existing ?? (await insertEntryTolerantly(kind, trimmed, role));

  await addAlias(trimmed, entry.id);
  return ensureRole(entry, role);
}

/** Adds `role` to an entry's roles if missing. A no-op for partner orgs
 *  (no role passed) and for an entry that already holds it, so the common
 *  path costs nothing. Exported as addRosterRole for the picker path in
 *  updateProcess(), which resolves an id and so never calls
 *  resolveOrCreateRosterEntry. */
export async function addRosterRole(entry: RosterEntry, role: string): Promise<RosterEntry> {
  return ensureRole(entry, role);
}

async function ensureRole(entry: RosterEntry, role?: string): Promise<RosterEntry> {
  if (!role || entry.roles.includes(role)) return entry;
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .update({ roles: [...entry.roles, role] })
    .eq("id", entry.id)
    .select("*")
    .single();
  // A failure here must not fail the process edit that triggered it: the role
  // is a ranking hint, and the write that matters (the owner FK) has either
  // already landed or is about to. Fall back to the un-updated entry.
  if (error) return entry;
  return data as RosterEntry;
}

async function findEntryByName(kind: RosterKind, displayName: string): Promise<RosterEntry | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .select("*")
    .eq("kind", kind)
    .ilike("display_name", displayName)
    .maybeSingle();
  if (error) throw error;
  return (data as RosterEntry | null) ?? null;
}

async function insertEntryTolerantly(
  kind: RosterKind,
  displayName: string,
  role?: string
): Promise<RosterEntry> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .insert({ kind, display_name: displayName, roles: role ? [role] : [] })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const existing = await findEntryByName(kind, displayName);
      if (existing) return existing;
    }
    throw error;
  }
  return data as RosterEntry;
}

/** How many live processes point at each roster entry, keyed by entry id.
 *
 *  Only the Configure dialog needs this — it's what turns "mark as left" from
 *  a blind toggle into a decision ("still the FDE on 2 active processes"). The
 *  owner pickers deliberately don't ask for it, so the hot path stays a single
 *  query. Counts a process once per role it holds on it, which is what the
 *  dialog claims: "assigned to N processes". */
export async function countRosterAssignments(): Promise<Record<string, number>> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processes)
    .select("fde_owner_id, tam_owner_id, engg_owner_id, partner_id")
    .is("deleted_at", null);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of (data as Record<string, string | null>[] | null) ?? []) {
    for (const id of Object.values(row)) {
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

export interface UpdateRosterEntryInput {
  roles?: string[];
  /** false = this person has left. Every picker filters `active: true`, so
   *  they stop being selectable — but their existing assignments are left
   *  alone on purpose: blanking those would erase who actually did the
   *  work. */
  active?: boolean;
}

/** Roles and active only. A rename is renameRosterEntry() — it has to move
 *  the text mirrors on `processes` in the same transaction, which this plain
 *  column write cannot express. */
export async function updateRosterEntry(
  id: string,
  patch: UpdateRosterEntryInput
): Promise<RosterEntry> {
  const existing = await getRosterEntry(id);
  if (!existing) throw new RosterEntryNotFoundError(id);

  const update: Record<string, unknown> = {};
  if (patch.roles !== undefined) {
    const clean = Array.from(new Set(patch.roles.map((r) => r.trim()).filter(Boolean)));
    update.roles = clean;
  }
  if (patch.active !== undefined) update.active = patch.active;
  if (Object.keys(update).length === 0) return existing;

  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as RosterEntry;
}

/** Renames an entry AND the denormalized owner text mirrors on `processes`.
 *
 *  Separate from updateRosterEntry's plain column write because it has to run
 *  as one transaction with updated_at preserved, which only the database can
 *  do — the guard on processes.updated_at is a BEFORE trigger that overwrites
 *  whatever timestamp a client sends. rename_roster_entry() (0038) sets a
 *  transaction-local GUC the trigger honours. The text mirrors have to move
 *  at all because `processes` keeps both halves of every owner (0032:
 *  fde_owner alongside fde_owner_id) so pre-roster readers keep working —
 *  leave the text behind and the roster says "Shyam Prabhal" while the
 *  Delivery table still shows the email it was imported under.
 *
 *  Returns the entry plus how many process rows were re-labelled, so the UI
 *  can say what it just did. */
export async function renameRosterEntry(
  id: string,
  displayName: string
): Promise<{ entry: RosterEntry; processesRelabelled: number }> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new InvalidRosterInputError("display_name cannot be blank.");

  // Fail fast with a clear error rather than letting the function raise.
  if (!(await getRosterEntry(id))) throw new RosterEntryNotFoundError(id);

  const sb = requireAdmin();
  const { data, error } = await sb.rpc("rename_roster_entry", {
    p_entry_id: id,
    p_new_name: trimmed,
  });
  if (error) throw error;

  await addAlias(trimmed, id);
  const entry = await getRosterEntry(id);
  if (!entry) throw new RosterEntryNotFoundError(id);
  return { entry, processesRelabelled: (data as number | null) ?? 0 };
}

/** Repoints every alias and every processes.*_id FK from the loser to the
 *  survivor, then deactivates the loser. The actual cleanup mechanism for
 *  whatever the conservative backfill (0033) didn't catch. */
export async function mergeRosterEntries(loserId: string, survivorId: string): Promise<RosterEntry> {
  if (loserId === survivorId) {
    throw new InvalidRosterInputError("Cannot merge a roster entry into itself.");
  }
  if (!(await getRosterEntry(loserId))) throw new RosterEntryNotFoundError(loserId);
  if (!(await getRosterEntry(survivorId))) throw new RosterEntryNotFoundError(survivorId);

  // Delegated to merge_roster_entry() (0040) rather than looped here. The
  // app-side version repointed the *_owner_id FKs but left the denormalized
  // owner TEXT reading the loser's name, so a merged-away duplicate kept
  // showing in the Delivery table; and repointing an FK to the canonical row
  // for the same human counts as a content change to the updated_at trigger,
  // so a merge reset "Last touched" on every row it touched. Both need one
  // transaction and the GUC the trigger honours, which only the database can
  // give.
  const sb = requireAdmin();
  const { error } = await sb.rpc("merge_roster_entry", {
    p_loser_id: loserId,
    p_survivor_id: survivorId,
  });
  if (error) throw error;

  const loser = await getRosterEntry(loserId);
  if (!loser) throw new RosterEntryNotFoundError(loserId);
  return loser;
}

