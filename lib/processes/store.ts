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
} from "@/lib/supabase/types";

export class ProcessNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Unknown process: ${id}`);
    this.name = "ProcessNotFoundError";
  }
}

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
  "value_minutes_saved_per_run",
  "value_basis",
  "blockers",
  "notes",
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

// ─── Reads ────────────────────────────────────────────────────────────────

export interface ProcessFilter {
  view?: ProcessView;
  customer_id?: string;
  customer_key?: string;
  needs_attention?: boolean;
}

const LIFECYCLES_BY_VIEW: Record<ProcessView, string[]> = {
  active: ACTIVE_LIFECYCLES,
  delivered: DELIVERED_LIFECYCLES,
  archive: ARCHIVE_LIFECYCLES,
};

export async function listProcesses(filter: ProcessFilter = {}): Promise<Process[]> {
  const sb = requireAdmin();
  let q = sb.from(TABLES.processes).select("*");
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

export async function getProcess(id: string): Promise<Process | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processes)
    .select("*")
    .eq("id", id)
    .maybeSingle();
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

  const update = pickEditable(patch);
  if (Object.keys(update).length === 0) return existing;

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
