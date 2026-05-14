// Per-customer K2 automation health — pulled from cached k2_runs.
// Surfaced on the customer page right rail.

import { requireAdmin } from "@/lib/supabase/server";

export interface K2Metrics {
  enabled: boolean;
  total_runs: number;
  completed: number;
  failed: number;
  awaiting_guidance: number;
  success_rate_pct: number | null;
  exception_rate_pct: number | null;
  avg_duration_sec: number;
  last_run_at: string | null;
  window_days: number;
}

const WINDOW_DAYS = 30;

export async function loadK2Metrics(customerId: string, workspaceId: string | null): Promise<K2Metrics> {
  if (!workspaceId) {
    return {
      enabled: false,
      total_runs: 0,
      completed: 0,
      failed: 0,
      awaiting_guidance: 0,
      success_rate_pct: null,
      exception_rate_pct: null,
      avg_duration_sec: 0,
      last_run_at: null,
      window_days: WINDOW_DAYS,
    };
  }

  const sb = requireAdmin();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("k2_runs")
    .select("state, duration_ms, started_at")
    .eq("customer_id", customerId)
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false });

  const rows = (data as Array<{ state: string | null; duration_ms: number | null; started_at: string | null }> | null) ?? [];
  let completed = 0;
  let failed = 0;
  let awaitingGuidance = 0;
  let totalDuration = 0;
  for (const r of rows) {
    const s = (r.state ?? "").toLowerCase();
    if (s === "completed") completed++;
    else if (s === "failed") failed++;
    else if (s === "awaiting_guidance") awaitingGuidance++;
    totalDuration += r.duration_ms ?? 0;
  }
  const total = rows.length;
  return {
    enabled: true,
    total_runs: total,
    completed,
    failed,
    awaiting_guidance: awaitingGuidance,
    success_rate_pct: total > 0 ? Math.round((completed / total) * 100) : null,
    exception_rate_pct: total > 0 ? Math.round(((failed + awaitingGuidance) / total) * 100) : null,
    avg_duration_sec: total > 0 ? Math.round(totalDuration / total / 1000) : 0,
    last_run_at: rows[0]?.started_at ?? null,
    window_days: WINDOW_DAYS,
  };
}
