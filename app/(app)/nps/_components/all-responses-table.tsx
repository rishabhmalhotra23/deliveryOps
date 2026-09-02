"use client";

// Every individual NPS response, across every quarter and customer — not
// just the aggregated charts above. Client-side search only; the dataset
// is small enough (currently ~80 rows) that a server-side filter isn't
// worth the complexity yet.

import { useMemo, useState } from "react";
import type { NpsResponseListRow } from "@/lib/nps/history";

const CATEGORY_STYLE: Record<string, string> = {
  Promoter: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Passive: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25",
  Detractor: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25",
};

export function AllResponsesTable({ responses }: { responses: NpsResponseListRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return responses;
    return responses.filter((r) =>
      [r.customerDisplayName, r.respondentName, r.quarter, r.feedback ?? ""].join(" ").toLowerCase().includes(s)
    );
  }, [responses, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
          All responses
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, respondent, feedback…"
            className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]"
          />
          <span className="text-[11px] text-[color:var(--muted-foreground)] whitespace-nowrap">
            {filtered.length} of {responses.length}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-6 text-sm text-[color:var(--muted-foreground)]">
          No responses match “{search}”.
        </div>
      ) : (
        <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 overflow-hidden">
          <div className="overflow-x-auto p-2 dark:p-2.5">
            <table className="w-full text-sm dark:border-separate dark:[border-spacing:0_4px]">
              <thead className="bg-[var(--glass-bg)] dark:bg-transparent text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Customer</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Respondent</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Quarter</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Date</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Score</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Category</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Satisfaction</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const td = "dark:bg-[color:var(--surface-2)]";
                  return (
                    <tr key={r.id} className="border-t border-[var(--glass-border)] dark:border-0 align-top">
                      <td className={`px-3 py-2 font-medium text-[color:var(--foreground)] whitespace-nowrap dark:rounded-l-lg ${td}`}>
                        {r.customerDisplayName}
                      </td>
                      <td className={`px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap ${td}`}>
                        {r.respondentName}
                        {r.respondentType ? (
                          <span className="ml-1 text-[10px] text-[color:var(--muted-foreground)]/70">
                            ({r.respondentType})
                          </span>
                        ) : null}
                      </td>
                      <td className={`px-3 py-2 tabular-nums whitespace-nowrap ${td}`}>{r.quarter}</td>
                      <td className={`px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap ${td}`}>
                        {new Date(r.responseDate).toLocaleDateString("en-US")}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold text-[color:var(--foreground)] ${td}`}>
                        {r.score}
                      </td>
                      <td className={`px-3 py-2 ${td}`}>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_STYLE[r.category] ?? ""}`}>
                          {r.category}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap ${td}`}>
                        {r.productSatisfaction ?? "—"}
                      </td>
                      <td className={`px-3 py-2 text-[color:var(--muted-foreground)] min-w-[240px] max-w-[420px] whitespace-normal break-words leading-snug dark:rounded-r-lg ${td}`}>
                        {r.feedback ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
