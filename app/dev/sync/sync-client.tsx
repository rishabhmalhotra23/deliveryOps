"use client";

import { useEffect, useState } from "react";

interface SyncRun {
  id: string;
  source: string;
  scope: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_synced: number;
  error: string | null;
  details: Record<string, unknown> | null;
}

interface StatusResponse {
  runs: SyncRun[];
  counts: Record<string, number>;
}

interface BoardTier {
  label: string;
  key: "projects" | "activities" | "nps";
}

const MONDAY_BOARDS: BoardTier[] = [
  { label: "All Projects (total)", key: "projects" },
  { label: "Activity Log", key: "activities" },
  { label: "NPS Tracking", key: "nps" },
];

interface BoardCounts {
  fetched: number;
  matched: number;
  inserted: number;
}

interface PerBoardCounts extends BoardCounts {
  board_id: string;
  board_name: string;
  fiscal_year: string;
}

function extractMondayBoardCounts(details: Record<string, unknown> | null, key: BoardTier["key"]): BoardCounts | null {
  if (!details || typeof details !== "object") return null;
  const board = (details as Record<string, unknown>)[key];
  if (!board || typeof board !== "object") return null;
  const b = board as Record<string, unknown>;
  return {
    fetched: typeof b.fetched === "number" ? b.fetched : 0,
    matched: typeof b.matched === "number" ? b.matched : 0,
    inserted: typeof b.inserted === "number" ? b.inserted : 0,
  };
}

function extractProjectsByBoard(details: Record<string, unknown> | null): PerBoardCounts[] {
  if (!details || !Array.isArray(details.projects_by_board)) return [];
  return (details.projects_by_board as PerBoardCounts[]).map((b) => ({
    board_id: b.board_id,
    board_name: b.board_name,
    fiscal_year: b.fiscal_year,
    fetched: b.fetched ?? 0,
    matched: b.matched ?? 0,
    inserted: b.inserted ?? 0,
  }));
}

export function SyncClient() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<unknown>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/sync/status");
      setStatus((await res.json()) as StatusResponse);
    } finally {
      setLoading(false);
    }
  }

  async function runSync() {
    setRunning(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/dev/sync/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      setLastResult(json);
      await loadStatus();
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  const latestMondayRun = status?.runs.find((r) => r.source === "monday" && r.status === "ok") ?? null;

  return (
    <div className="space-y-4">
      {/* Counts */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {COUNTS.map((c) => (
          <div key={c.key} className="rounded-md border border-[color:var(--brand-metal)] bg-white dark:bg-white/6 dark:border-white/15 p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)]">
              {c.label}
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-1">
              {status?.counts[c.key] ?? "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Monday board match rates — surface the per-board fetched/matched/inserted
          counts from the most recent successful Monday sync. */}
      {latestMondayRun ? (
        <div className="rounded-md border border-[color:var(--brand-metal)] bg-white dark:bg-white/6 dark:border-white/15">
          <div className="px-4 py-2 text-xs uppercase tracking-wider text-[color:var(--brand-gray)] border-b border-[color:var(--brand-metal-line)] flex items-center justify-between">
            <span>Monday match rates (latest successful sync)</span>
            <span className="text-[color:var(--brand-gray)] normal-case tracking-normal">
              {new Date(latestMondayRun.started_at).toLocaleString()}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">
              <tr>
                <th className="text-left px-4 py-2">Board</th>
                <th className="text-right px-4 py-2">Fetched</th>
                <th className="text-right px-4 py-2">Matched</th>
                <th className="text-right px-4 py-2">Inserted</th>
                <th className="text-right px-4 py-2">Match %</th>
              </tr>
            </thead>
            <tbody>
              {/* Per-project-board breakdown from projects_by_board */}
              {extractProjectsByBoard(latestMondayRun.details).map((b) => {
                const pct = b.fetched > 0 ? (b.matched / b.fetched) * 100 : 0;
                const tone = pct >= 95 ? "text-emerald-700" : pct >= 70 ? "text-amber-700" : "text-red-700";
                return (
                  <tr key={b.board_id} className="border-t border-[color:var(--brand-metal-line)]">
                    <td className="px-4 py-2">
                      <span className="font-medium">{b.board_name}</span>
                      <span className="ml-2 text-[10px] text-[color:var(--brand-gray)] uppercase">{b.fiscal_year}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.fetched}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.matched}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.inserted}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${tone}`}>
                      {pct.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
              {/* Activity Log + NPS totals */}
              {MONDAY_BOARDS.filter((b) => b.key !== "projects").map((b) => {
                const counts = extractMondayBoardCounts(latestMondayRun.details, b.key);
                if (!counts) return null;
                const pct = counts.fetched > 0 ? (counts.matched / counts.fetched) * 100 : 0;
                const tone = pct >= 95 ? "text-emerald-700" : pct >= 70 ? "text-amber-700" : "text-red-700";
                return (
                  <tr key={b.key} className="border-t border-[color:var(--brand-metal-line)]">
                    <td className="px-4 py-2 font-medium">{b.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{counts.fetched}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{counts.matched}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{counts.inserted}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${tone}`}>
                      {pct.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Action bar */}
      <div className="flex items-center gap-3 rounded-md border border-[color:var(--brand-metal)] bg-white dark:bg-white/6 dark:border-white/15 p-3 text-sm">
        <button
          onClick={runSync}
          disabled={running}
          className="rounded-md bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] px-4 py-1.5 font-medium hover:opacity-90 disabled:opacity-50 border border-[color:var(--brand-night)]"
        >
          {running ? "Syncing… (~30s)" : "Run sync now"}
        </button>
        <button
          onClick={loadStatus}
          disabled={loading}
          className="rounded-md border border-[color:var(--brand-metal)] px-3 py-1 text-xs hover:border-[color:var(--brand-night)]"
        >
          Refresh
        </button>
      </div>

      {/* Last run result */}
      {lastResult ? (
        <details className="rounded-md border border-[color:var(--brand-metal)] bg-white dark:bg-white/6 dark:border-white/15 p-3 text-xs">
          <summary className="cursor-pointer">Last sync run details</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap leading-relaxed">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </details>
      ) : null}

      {/* History */}
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white dark:bg-white/6 dark:border-white/15">
        <div className="px-4 py-2 text-xs uppercase tracking-wider text-[color:var(--brand-gray)] border-b border-[color:var(--brand-metal-line)]">
          Recent runs
        </div>
        {status?.runs.length === 0 ? (
          <div className="p-4 text-sm text-[color:var(--brand-gray)]">No sync runs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">
              <tr>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Rows</th>
                <th className="text-right px-4 py-2">Duration</th>
                <th className="text-right px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {(status?.runs ?? []).map((r) => {
                const duration =
                  r.finished_at && r.started_at
                    ? Math.round(
                        (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000
                      )
                    : null;
                return (
                  <tr key={r.id} className="border-t border-[color:var(--brand-metal-line)]">
                    <td className="px-4 py-2 font-medium">{r.source}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          r.status === "ok"
                            ? "bg-emerald-50 text-emerald-800"
                            : r.status === "running"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-red-50 text-red-800"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.rows_synced}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {duration != null ? `${duration}s` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-[color:var(--brand-gray)] tabular-nums">
                      {new Date(r.started_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const COUNTS: Array<{ key: string; label: string }> = [
  { key: "sf_accounts", label: "SF accounts" },
  { key: "sf_opportunities", label: "SF opportunities" },
  { key: "sf_cases", label: "SF cases" },
  { key: "monday_projects", label: "Monday projects" },
  { key: "monday_activities", label: "Monday activities" },
  { key: "monday_nps_responses", label: "Monday NPS" },
];
