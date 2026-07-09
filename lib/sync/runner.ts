// Combined sync runner — orchestrates Salesforce + Monday + Kognitos v2
// syncs with audit logging into the sync_runs table.
//
// Used by both /api/dev/sync/run (manual trigger) and /api/cron/daily-sync
// (daily 08:00 IST Vercel Cron). Each source is wrapped in `runOne` which
// inserts a "running" row in sync_runs, then updates it to "ok" or "error"
// with rows_synced + details JSON. Failures in one source don't abort the
// others — they're collected in `errors` and the response status flips
// to 207 (multi-status) instead of 200.

import { requireAdmin } from "@/lib/supabase/server";
import { syncSalesforce, type SalesforceSyncResult } from "./salesforce";
import { syncMonday, type MondaySyncResult } from "./monday";
import { syncKognitosV2, type KognitosV2SyncResult } from "./kognitos-v2";
import { syncLinearTickets, type LinearTicketsSyncResult } from "./linear-tickets";
import { logger, errorCtx } from "@/lib/logger";

const log = logger("sync/runner");

export type SyncSource = "salesforce" | "monday" | "kognitos-v2" | "linear-tickets";

export interface CombinedSyncResult {
  ok: boolean;
  duration_ms: number;
  salesforce?: SalesforceSyncResult;
  monday?: MondaySyncResult;
  kognitos_v2?: KognitosV2SyncResult;
  linear_tickets?: LinearTicketsSyncResult;
  errors: string[];
}

interface SyncOptions {
  sources?: SyncSource[];
  customerKey?: string;
}

const DEFAULT_SOURCES: SyncSource[] = ["salesforce", "monday", "kognitos-v2", "linear-tickets"];

export async function runFullSync(opts: SyncOptions = {}): Promise<CombinedSyncResult> {
  const start = Date.now();
  const sources = opts.sources ?? DEFAULT_SOURCES;
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

  if (sources.includes("kognitos-v2")) {
    await runOne("kognitos-v2", "workspace", async () => {
      const r = await syncKognitosV2();
      result.kognitos_v2 = r;
      const rows = r.processes.upserted + r.runs.upserted + (r.workspace_synced ? 1 : 0);
      if (r.errors.length > 0) {
        for (const e of r.errors) result.errors.push(`kognitos-v2/${e.stage}: ${e.error}`);
      }
      return { rows, details: r as unknown as Record<string, unknown> };
    }).catch((err) => {
      result.errors.push(`kognitos-v2: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  if (sources.includes("linear-tickets")) {
    await runOne("linear-tickets", "all", async () => {
      const r = await syncLinearTickets();
      result.linear_tickets = r;
      if (r.errors.length > 0) {
        for (const e of r.errors) result.errors.push(`linear-tickets/${e.stage}: ${e.error}`);
      }
      return { rows: r.upserted, details: r as unknown as Record<string, unknown> };
    }).catch((err) => {
      result.errors.push(`linear-tickets: ${err instanceof Error ? err.message : String(err)}`);
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
    log.warn("Could not record sync run start", { source, scope, error: insErr.message });
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
    log.info(`${source}/${scope} ok`, { rows: out.rows, duration_ms: Date.now() - startTs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`${source}/${scope} failed`, { error: msg, duration_ms: Date.now() - startTs });
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
