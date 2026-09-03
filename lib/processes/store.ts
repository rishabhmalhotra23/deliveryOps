// The processes store — CRUD for the native process record (0021). Service-role
// reads/writes; Auth0 gates access at the middleware/route layer, same model as
// lib/migrations/store.ts, which this widens.
//
// Two writes are distinct on purpose (see docs/mockups/ia-step-1.5.html panel 3):
//   updateProcess    — an actual field edit. Stamps field_provenance per changed
//                       key so a later Slack/Linear suggestion can tell a human
//                       edit apart from an import default.
//   markReviewed     — confirming a row is still accurate. Not an edit: it does
//                       not touch field_provenance, only reviewed_at/reviewed_by.

import { requireAdmin } from "@/lib/supabase/server";
import {
  TABLES,
  PROCESS_GENERATED_COLUMNS,
  ACTIVE_LIFECYCLES,
  DELIVERED_LIFECYCLES,
  ARCHIVE_LIFECYCLES,
  type Process,
  type ProcessView,
  type ProcessLifecycle,
  type ProcessPlatform,
  type ProcessPhase,
  type MigrationStage,
  type RosterKind,
} from "@/lib/supabase/types";
import { resolveOrCreateRosterEntry, getRosterEntry } from "@/lib/roster/store";

export class ProcessNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Unknown process: ${id}`);
    this.name = "ProcessNotFoundError";
  }
}

export class InvalidProcessInputError extends Error {}

// Fields the drawer may set. Deliberately excludes identity (account,
// process_name, customer_id/key), generated columns (ttv_days), import
// provenance (source_*), and needs_attention — those are import-time or
// creation-time, not drawer edits.
const EDITABLE_FIELDS: (keyof Process)[] = [
  "customer_id",
  "lifecycle",
  "phase",
  "health",
  "blocked_on",
  "work_mode",
  "platform",
  "migration_stage",
  "complexity",
  "priority",
  "kickoff_date",
  "go_live_date",
  "total_effort_hours",
  "fde_owner",
  "tam_owner",
  "engg_owner",
  "partner",
  "fde_owner_id",
  "tam_owner_id",
  "engg_owner_id",
  "partner_id",
  "value_minutes_saved_per_run",
  "value_basis",
  "blockers",
  "notes",
  "date_parity_complete",
  "date_customer_handover",
  "date_customer_validation",
  "completion_pct",
  "linear_ticket_ids",
  "arr",
  "company_size",
];

const GENERATED = new Set<string>(PROCESS_GENERATED_COLUMNS);

function pickEditable(patch: Partial<Process>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) {
    if (GENERATED.has(f as string)) continue;
    if (f in patch && patch[f] !== undefined) out[f as string] = patch[f];
  }
  return out;
}

// ─── Cross-field derivation ─────────────────────────────────────────────────
// lifecycle, phase and migration_stage overlap in what they're describing —
// the team shouldn't have to set the same "where is this at" answer three
// times. When one of them moves, fill in the others *if the caller didn't
// already say something about them*, so an explicit multi-field edit is
// always trusted over a guess.
//
// Only the most common, unambiguous mappings are covered here — anything not
// listed (e.g. migration_stage: not_required, or phase's m5_exception_handling)
// is left alone rather than guessed at.

// A migration moving through these stages is, from the Delivery board's
// point of view, simply "this process is in development" or "in UAT" or
// "live" — not_required is deliberately absent, since it carries no
// delivery-status signal at all.
const MIGRATION_STAGE_TO_LIFECYCLE: Partial<Record<MigrationStage, ProcessLifecycle>> = {
  in_development: "in_development",
  engg_pending: "in_development",
  parity_testing: "uat",
  customer_validation: "uat",
  live_on_v2: "live",
  migrated_pending_commercial: "live",
  v2_native: "live",
};

const LIFECYCLE_TO_PHASE: Partial<Record<ProcessLifecycle, ProcessPhase>> = {
  backlog: "pre_kickoff",
  upcoming: "pre_kickoff",
  discovery: "m1_discovery",
  in_development: "m2_development",
  uat: "m3_testing_uat",
  live: "m4_deployment",
};

// Auto-derivation only ever moves a process forward through its normal flow —
// it never overrides a hold or terminal state a human deliberately set.
const FLOW_LIFECYCLES = new Set<ProcessLifecycle>([
  "backlog",
  "upcoming",
  "discovery",
  "in_development",
  "uat",
  "live",
]);

/** Pure: fills in lifecycle/phase from a migration_stage or lifecycle change
 *  already present in `update`, without touching anything the caller set
 *  explicitly. Exported for unit testing. */
export function withDerivedFields(
  existing: Process,
  update: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...update };

  if (
    "migration_stage" in next &&
    !("lifecycle" in next) &&
    FLOW_LIFECYCLES.has(existing.lifecycle)
  ) {
    const derived = MIGRATION_STAGE_TO_LIFECYCLE[next.migration_stage as MigrationStage];
    if (derived && derived !== existing.lifecycle) next.lifecycle = derived;
  }

  const effectiveLifecycle = (next.lifecycle as ProcessLifecycle | undefined) ?? existing.lifecycle;
  if ("lifecycle" in next && !("phase" in next) && FLOW_LIFECYCLES.has(effectiveLifecycle)) {
    const derivedPhase = LIFECYCLE_TO_PHASE[effectiveLifecycle];
    if (derivedPhase && derivedPhase !== existing.phase) next.phase = derivedPhase;
  }

  return next;
}

// ─── Roster resolution ──────────────────────────────────────────────────────
// Every owner/partner field on `processes` has a paired text column and *_id
// FK (0032). A caller can send either half:
//   - the *_id (a picker that already resolved to a roster entry) -- the
//     text column is re-derived from the entry so it never drifts, or
//   - the plain text field (the "+ add new" free-text path, or any legacy
//     caller/script) -- resolveOrCreateRosterEntry finds-or-creates the
//     canonical entry, and both halves get set from its result.
// This runs on every updateProcess() call, not just from the drawer, so the
// roster can never silently fall out of sync going forward.

const OWNER_FIELD_ROSTER: { textField: string; idField: string; kind: RosterKind }[] = [
  { textField: "fde_owner", idField: "fde_owner_id", kind: "person" },
  { textField: "tam_owner", idField: "tam_owner_id", kind: "person" },
  { textField: "engg_owner", idField: "engg_owner_id", kind: "person" },
  { textField: "partner", idField: "partner_id", kind: "partner_org" },
];

async function resolveRosterFields(update: Record<string, unknown>): Promise<void> {
  for (const { textField, idField, kind } of OWNER_FIELD_ROSTER) {
    if (idField in update) {
      const id = update[idField] as string | null;
      if (id) {
        const entry = await getRosterEntry(id);
        if (entry) update[textField] = entry.display_name;
      } else {
        update[textField] = null;
      }
      continue;
    }
    if (textField in update) {
      const raw = update[textField] as string | null;
      if (raw && raw.trim()) {
        const entry = await resolveOrCreateRosterEntry(kind, raw);
        update[idField] = entry.id;
        update[textField] = entry.display_name;
      } else {
        update[idField] = null;
      }
    }
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────

export interface ProcessFilter {
  view?: ProcessView;
  customer_id?: string;
  customer_key?: string;
  needs_attention?: boolean;
  /** Defaults to false: deleted rows are hidden everywhere unless a caller
   *  explicitly asks for them (e.g. a future "Deleted" admin view). */
  includeDeleted?: boolean;
}

const LIFECYCLES_BY_VIEW: Record<ProcessView, string[]> = {
  active: ACTIVE_LIFECYCLES,
  delivered: DELIVERED_LIFECYCLES,
  archive: ARCHIVE_LIFECYCLES,
};

export async function listProcesses(filter: ProcessFilter = {}): Promise<Process[]> {
  const sb = requireAdmin();
  let q = sb.from(TABLES.processes).select("*");
  if (!filter.includeDeleted) q = q.is("deleted_at", null);
  if (filter.view) q = q.in("lifecycle", LIFECYCLES_BY_VIEW[filter.view]);
  if (filter.customer_id) q = q.eq("customer_id", filter.customer_id);
  if (filter.customer_key) q = q.eq("customer_key", filter.customer_key);
  if (typeof filter.needs_attention === "boolean") {
    q = q.eq("needs_attention", filter.needs_attention);
  }
  q = q.order("account", { ascending: true }).order("process_name", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data as Process[]) ?? [];
}

export async function getProcess(
  id: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<Process | null> {
  const sb = requireAdmin();
  let q = sb.from(TABLES.processes).select("*").eq("id", id);
  if (!opts.includeDeleted) q = q.is("deleted_at", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as Process | null) ?? null;
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function updateProcess(
  id: string,
  patch: Partial<Process>,
  actor: string
): Promise<Process> {
  const sb = requireAdmin();
  const existing = await getProcess(id);
  if (!existing) throw new ProcessNotFoundError(id);

  let update = pickEditable(patch);
  if (Object.keys(update).length === 0) return existing;
  update = withDerivedFields(existing, update);
  await resolveRosterFields(update);

  const now = new Date().toISOString();
  const provenance = { ...existing.field_provenance };
  for (const field of Object.keys(update)) {
    provenance[field] = { by: actor, at: now };
  }
  update.field_provenance = provenance;
  update.updated_by = actor;

  const { data, error } = await sb
    .from(TABLES.processes)
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Process;
}

export interface CreateProcessInput {
  process_name: string;
  /** Either an existing customer's display name (when customer_id is set) or
   *  free text for a not-yet-onboarded account — `account` is the NOT NULL
   *  denormalized label on the row either way. */
  account: string;
  customer_id?: string | null;
  lifecycle?: ProcessLifecycle;
  platform?: ProcessPlatform;
  fde_owner?: string | null;
}

// New processes are always delivery work, not migration work, by definition —
// migration_stage only ever becomes something else via a drawer edit, the
// same mechanism used to move a process off the V2 Migration report.
const NEW_PROCESS_MIGRATION_STAGE = "not_required" as const;
const DEFAULT_LIFECYCLE: ProcessLifecycle = "backlog";
const DEFAULT_PLATFORM: ProcessPlatform = "v2";

/** Pure: validates and shapes the insert row. Split out from createProcess so
 *  the validation/defaulting rules are unit-testable without Supabase. */
export function buildCreateProcessRow(
  input: CreateProcessInput,
  actor: string
): Record<string, unknown> {
  const process_name = input.process_name.trim();
  const account = input.account.trim();
  if (!process_name) throw new InvalidProcessInputError("Process name is required.");
  if (!account) throw new InvalidProcessInputError("Account is required.");

  return {
    process_name,
    account,
    customer_id: input.customer_id || null,
    lifecycle: input.lifecycle ?? DEFAULT_LIFECYCLE,
    platform: input.platform ?? DEFAULT_PLATFORM,
    migration_stage: NEW_PROCESS_MIGRATION_STAGE,
    fde_owner: input.fde_owner || null,
    updated_by: actor,
  };
}

export async function createProcess(input: CreateProcessInput, actor: string): Promise<Process> {
  const sb = requireAdmin();
  const row = buildCreateProcessRow(input, actor);
  // fde_owner on creation goes through the same roster resolution as a
  // drawer edit, so a brand-new process never bypasses the roster.
  await resolveRosterFields(row);
  const { data, error } = await sb.from(TABLES.processes).insert(row).select("*").single();
  if (error) throw error;
  return data as Process;
}

// Soft-delete: same "not an edit" distinction as markReviewed — removing a
// bad row doesn't touch field_provenance, only deleted_at/deleted_by.

export async function deleteProcess(id: string, actor: string): Promise<Process> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processes)
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new ProcessNotFoundError(id);
    throw error;
  }
  return data as Process;
}

export async function restoreProcess(id: string, actor: string): Promise<Process> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processes)
    .update({ deleted_at: null, deleted_by: null, updated_by: actor })
    .eq("id", id)
    .not("deleted_at", "is", null)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new ProcessNotFoundError(id);
    throw error;
  }
  return data as Process;
}

// ─── Bulk writes ────────────────────────────────────────────────────────────
// Loop the single-row primitives above rather than a multi-row update, so
// bulk behavior (derivation, provenance stamping, "row already deleted")
// never diverges from what a single-row edit does. Partial failure is
// expected — a bad id in a 40-row selection shouldn't fail the other 39.

export interface BulkResult<T> {
  updated: T[];
  failed: { id: string; error: string }[];
}

/** Exported for unit testing — the partial-failure aggregation is pure given
 *  any async `fn`, so it's tested directly rather than through a live
 *  Supabase call. */
export async function bulkApply<T>(
  ids: string[],
  fn: (id: string) => Promise<T>
): Promise<BulkResult<T>> {
  const updated: T[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      updated.push(await fn(id));
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { updated, failed };
}

// Bulk requests are capped so one request can't fan out into hundreds of
// sequential Supabase round trips.
export const MAX_BULK_IDS = 200;

export class TooManyIdsError extends Error {
  constructor(count: number) {
    super(`Bulk requests are capped at ${MAX_BULK_IDS} ids, got ${count}.`);
    this.name = "TooManyIdsError";
  }
}

function assertBulkSize(ids: string[]): void {
  if (ids.length > MAX_BULK_IDS) throw new TooManyIdsError(ids.length);
}

export async function bulkUpdateProcesses(
  ids: string[],
  patch: Partial<Process>,
  actor: string
): Promise<BulkResult<Process>> {
  assertBulkSize(ids);
  return bulkApply(ids, (id) => updateProcess(id, patch, actor));
}

export async function bulkDeleteProcesses(
  ids: string[],
  actor: string
): Promise<BulkResult<Process>> {
  assertBulkSize(ids);
  return bulkApply(ids, (id) => deleteProcess(id, actor));
}

export async function markReviewed(id: string, actor: string): Promise<Process> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processes)
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: actor })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new ProcessNotFoundError(id);
    throw error;
  }
  return data as Process;
}
