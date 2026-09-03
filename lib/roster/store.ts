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

export async function listRosterEntries(filter: RosterFilter = {}): Promise<RosterEntry[]> {
  const sb = requireAdmin();
  let q = sb.from(TABLES.rosterEntries).select("*").is("merged_into_id", null);
  if (filter.kind) q = q.eq("kind", filter.kind);
  if (typeof filter.active === "boolean") q = q.eq("active", filter.active);
  if (filter.role) q = q.contains("roles", [filter.role]);
  if (filter.q && filter.q.trim()) q = q.ilike("display_name", `%${filter.q.trim()}%`);
  q = q.order("display_name", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data as RosterEntry[]) ?? [];
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
  rawName: string
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
    return resolveLiveEntry(data as RosterEntry);
  }

  // No alias yet -- a canonical entry with this exact (case-insensitive)
  // display name may already exist (created moments earlier by a concurrent
  // caller, or seeded by 0033's backfill with different original casing).
  // roster_entries_kind_name_idx is a functional index on
  // (kind, lower(display_name)), which PostgREST's upsert can't target via
  // onConflict, so this does an explicit find-then-insert instead, with a
  // unique-violation retry to stay race-safe.
  const existing = await findEntryByName(kind, trimmed);
  const entry = existing ?? (await insertEntryTolerantly(kind, trimmed));

  await addAlias(trimmed, entry.id);
  return entry;
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

async function insertEntryTolerantly(kind: RosterKind, displayName: string): Promise<RosterEntry> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .insert({ kind, display_name: displayName })
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

/** Repoints every alias and every processes.*_id FK from the loser to the
 *  survivor, then deactivates the loser. The actual cleanup mechanism for
 *  whatever the conservative backfill (0033) didn't catch. */
export async function mergeRosterEntries(loserId: string, survivorId: string): Promise<RosterEntry> {
  if (loserId === survivorId) {
    throw new InvalidRosterInputError("Cannot merge a roster entry into itself.");
  }
  const sb = requireAdmin();

  const { error: aliasErr } = await sb
    .from(TABLES.rosterAliases)
    .update({ roster_entry_id: survivorId })
    .eq("roster_entry_id", loserId);
  if (aliasErr) throw aliasErr;

  for (const column of ["fde_owner_id", "tam_owner_id", "partner_id", "engg_owner_id"]) {
    const { error } = await sb.from(TABLES.processes).update({ [column]: survivorId }).eq(column, loserId);
    if (error) throw error;
  }

  const { data, error } = await sb
    .from(TABLES.rosterEntries)
    .update({ active: false, merged_into_id: survivorId })
    .eq("id", loserId)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new RosterEntryNotFoundError(loserId);
    throw error;
  }
  return data as RosterEntry;
}
