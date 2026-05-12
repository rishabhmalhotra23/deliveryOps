// Kognitos v2 sync — pulls workspace metadata, processes, and recent run
// history into k2_workspaces / k2_processes / k2_runs.
//
// Per-customer linking: customers.kognitos_v2_workspace_id is matched against
// the K2 workspace ID for every row. Today the PAT is single-workspace, so
// only customers mapped to that workspace get customer_id populated.
//
// Cheap design: fetches the workspace once, then up to 200 processes and
// up to 500 runs in a single Inngest step. Idempotent — every row keyed on
// the K2-side ID with `on conflict do update`.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import {
  getCurrentWorkspace,
  listProcesses,
  listRuns,
  kognitosV2Configured,
  type K2Process,
  type K2Run,
  type K2Workspace,
} from "@/lib/integrations/kognitos/v2";

export interface KognitosV2SyncResult {
  workspace_id: string | null;
  workspace_synced: boolean;
  processes: { fetched: number; upserted: number; mapped_to_customer: number };
  runs: { fetched: number; upserted: number; mapped_to_customer: number };
  errors: Array<{ stage: string; error: string }>;
}

interface SyncOpts {
  processLimit?: number;
  runLimit?: number;
}

export async function syncKognitosV2(opts: SyncOpts = {}): Promise<KognitosV2SyncResult> {
  const result: KognitosV2SyncResult = {
    workspace_id: null,
    workspace_synced: false,
    processes: { fetched: 0, upserted: 0, mapped_to_customer: 0 },
    runs: { fetched: 0, upserted: 0, mapped_to_customer: 0 },
    errors: [],
  };

  if (!kognitosV2Configured()) {
    result.errors.push({ stage: "config", error: "Kognitos v2 env vars missing." });
    return result;
  }

  const workspaceId = process.env.KOGNITOS_V2_WORKSPACE_ID!.trim();
  result.workspace_id = workspaceId;
  const sb = requireAdmin();

  // Build a workspace_id → customer_id map once. The PAT scopes to a single
  // K2 workspace, so this is usually 0–1 entries today; schema is multi-
  // workspace-ready for when we onboard additional Kognitos tenants.
  const customers = await listCustomers();
  const customerByWorkspaceId = new Map<string, string>();
  for (const c of customers) {
    if (c.kognitos_v2_workspace_id) customerByWorkspaceId.set(c.kognitos_v2_workspace_id, c.id);
  }

  // ─── 1. Workspace ─────────────────────────────────────────────────────────
  try {
    const ws = await getCurrentWorkspace();
    await upsertWorkspace(sb, workspaceId, ws);
    result.workspace_synced = true;
  } catch (err) {
    result.errors.push({
      stage: "workspace",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ─── 2. Processes ─────────────────────────────────────────────────────────
  let processes: K2Process[] = [];
  try {
    processes = await listProcesses({ limit: opts.processLimit ?? 100 });
    result.processes.fetched = processes.length;

    for (const p of processes) {
      const customerId = customerByWorkspaceId.get(workspaceId) ?? null;
      const { error } = await sb
        .from("k2_processes")
        .upsert(toProcessRow(workspaceId, customerId, p), { onConflict: "k2_process_id" });
      if (!error) {
        result.processes.upserted++;
        if (customerId) result.processes.mapped_to_customer++;
      }
    }
  } catch (err) {
    result.errors.push({
      stage: "processes",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ─── 3. Runs ──────────────────────────────────────────────────────────────
  // Fetch the recent run history — workspace-level if the cluster supports
  // it, otherwise the client falls back to per-process iteration and merges.
  try {
    const runs = await listRuns({ limit: opts.runLimit ?? 200 });
    result.runs.fetched = runs.length;

    for (const r of runs) {
      const customerId = customerByWorkspaceId.get(workspaceId) ?? null;
      const { error } = await sb
        .from("k2_runs")
        .upsert(toRunRow(workspaceId, customerId, r), { onConflict: "k2_run_id" });
      if (!error) {
        result.runs.upserted++;
        if (customerId) result.runs.mapped_to_customer++;
      }
    }
  } catch (err) {
    result.errors.push({
      stage: "runs",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

// ─── Row builders ────────────────────────────────────────────────────────────

async function upsertWorkspace(
  sb: ReturnType<typeof requireAdmin>,
  workspaceId: string,
  ws: K2Workspace
): Promise<void> {
  await sb
    .from("k2_workspaces")
    .upsert(
      {
        k2_workspace_id: workspaceId,
        display_name: ws.display_name ?? ws.name ?? null,
        description: ws.description ?? null,
        state: ws.state ?? null,
        raw: ws.raw as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "k2_workspace_id" }
    );
}

function toProcessRow(workspaceId: string, customerId: string | null, p: K2Process) {
  return {
    k2_process_id: p.id,
    k2_workspace_id: workspaceId,
    customer_id: customerId,
    display_name: p.display_name ?? null,
    name: p.name ?? null,
    state: p.state ?? null,
    k2_created_at: p.created_at ?? null,
    k2_updated_at: p.updated_at ?? null,
    raw: p.raw as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

function toRunRow(workspaceId: string, customerId: string | null, r: K2Run) {
  return {
    k2_run_id: r.id,
    k2_process_id: r.process_id ?? null,
    k2_workspace_id: workspaceId,
    customer_id: customerId,
    state: resolveRunState(r.state),
    started_at: r.started_at ?? null,
    ended_at: r.ended_at ?? null,
    duration_ms: r.duration_ms ?? computeDuration(r.started_at, r.ended_at),
    raw: r.raw as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

// Kognitos returns state as an object whose only populated key names the
// resolved status. We flatten it to a single string for indexing.
function resolveRunState(state: K2Run["state"]): string | null {
  if (!state || typeof state !== "object") return null;
  for (const key of ["completed", "failed", "awaiting_guidance", "running", "stopped"]) {
    if ((state as Record<string, unknown>)[key]) return key;
  }
  return null;
}

function computeDuration(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return e - s;
}
