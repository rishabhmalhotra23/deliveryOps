// Combined sync runner — orchestrates Salesforce + Monday syncs with audit
// logging into the sync_runs table. Used by the manual /api/dev/sync/run
// trigger today; in production this is wrapped by the weekly-sync Inngest
// function.

import { requireAdmin } from "@/lib/supabase/server";
import { syncSalesforce, type SalesforceSyncResult } from "./salesforce";
import { syncMonday, type MondaySyncResult } from "./monday";

export interface CombinedSyncResult {
  ok: boolean;
  duration_ms: number;
  salesforce?: SalesforceSyncResult;
  monday?: MondaySyncResult;
  errors: string[];
}

interface SyncOptions {
  sources?: Array<"salesforce" | "monday">;
  customerKey?: string;
}

export async function runFullSync(opts: SyncOptions = {}): Promise<CombinedSyncResult> {
  const start = Date.now();
  const sources = opts.sources ?? ["salesforce", "monday"];
  const result: CombinedSyncResult = { ok: true, duration_ms: 0, errors: [] };

  if (sources.includes("salesforce")) {
    await runOne("salesforce", opts.customerKey ?? "all", async () => {
      const r = await syncSalesforce({ customerKey: opts.customerKey });
      result.salesforce = r;
      const rows = r.accounts + r.opportunities + r.cases;
      if (r.errors.length > 0) {
        for (const e of r.errors) result.errors.push(`salesforce/${e.customer_key}: ${e.error}`);
      }
      return { rows, details: r as unknown as Record<string, unknown> };
    }).catch((err) => {
      result.errors.push(`salesforce: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  if (sources.includes("monday")) {
    await runOne("monday", "all", async () => {
      const r = await syncMonday();
      result.monday = r;
      const rows = r.projects.inserted + r.activities.inserted + r.nps.inserted;
      if (r.errors.length > 0) {
        for (const e of r.errors) result.errors.push(`monday/${e.board}: ${e.error}`);
      }
      return { rows, details: r as unknown as Record<string, unknown> };
    }).catch((err) => {
      result.errors.push(`monday: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  result.ok = result.errors.length === 0;
  result.duration_ms = Date.now() - start;
  return result;
}

async function runOne(
  source: string,
  scope: string,
  fn: () => Promise<{ rows: number; details: Record<string, unknown> }>
): Promise<void> {
  const sb = requireAdmin();
  const { data: run, error: insErr } = await sb
    .from("sync_runs")
    .insert({ source, scope, status: "running" })
    .select("id")
    .single();
  if (insErr) {
    console.warn(`[sync] could not record start of ${source} run:`, insErr.message);
  }
  const runId = (run as { id: string } | null)?.id;
  const startTs = Date.now();

  try {
    const out = await fn();
    if (runId) {
      await sb
        .from("sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "ok",
          rows_synced: out.rows,
          details: out.details,
        })
        .eq("id", runId);
    }
    console.log(`[sync] ${source}/${scope} ok — ${out.rows} rows in ${Date.now() - startTs}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await sb
        .from("sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "error",
          error: msg,
        })
        .eq("id", runId);
    }
    throw err;
  }
}
