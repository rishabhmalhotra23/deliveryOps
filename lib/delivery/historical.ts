// Groups Delivery's Historical section by the fiscal quarter each process
// went live.
//
// Uses fiscalQuarterOf() from lib/nps/constants — Kognitos's fiscal year runs
// Feb-Jan named for the year it ends in, and every NPS chart plus the team's
// own Excel tracker already speak that. loader.ts's Q-on-Q aggregate keys on
// CALENDAR quarters ("2026 Q1"), which would have filed the same piece of
// work under a different quarter than every other quarterly number in the
// app.
//
// Rows with no go-live date get their own explicit bucket rather than being
// dropped or guessed at: 47 of the 132 historical rows have none, mostly
// needs-triage and churned work that never shipped. Set a date on one and it
// moves into that quarter — same derived rule as everything else here.

import { fiscalQuarterOf, quarterSortKey } from "@/lib/nps/constants";
import type { ProcessLifecycle } from "@/lib/supabase/types";

export const NO_QUARTER = "no-date";

export interface HistoricalRow {
  lifecycle: ProcessLifecycle;
  go_live_date: string | null;
}

export interface QuarterGroup<T> {
  /** "4Q26", or NO_QUARTER for the undated bucket. */
  quarter: string;
  label: string;
  rows: T[];
  /** Shipped and still running. */
  live: number;
  /** Cancelled, churned or retired — work that stopped. */
  ended: number;
  /** Unreviewed, so neither shipped nor deliberately stopped. Counted
   *  separately so the undated bucket doesn't read as 30 failures. */
  needsTriage: number;
}

const ENDED = new Set<ProcessLifecycle>(["cancelled", "churned", "retired"]);

/** Newest quarter first, with the undated bucket pinned last — it isn't a
 *  point in time, so it can't sort among them. */
export function groupByQuarter<T extends HistoricalRow>(rows: T[]): QuarterGroup<T>[] {
  const byQuarter = new Map<string, QuarterGroup<T>>();

  for (const row of rows) {
    const q = fiscalQuarterOf(row.go_live_date) ?? NO_QUARTER;
    const group =
      byQuarter.get(q) ??
      ({
        quarter: q,
        label: q === NO_QUARTER ? "No go-live date" : q,
        rows: [],
        live: 0,
        ended: 0,
        needsTriage: 0,
      } as QuarterGroup<T>);
    group.rows.push(row);
    if (row.lifecycle === "needs_triage") group.needsTriage++;
    else if (ENDED.has(row.lifecycle)) group.ended++;
    else group.live++;
    byQuarter.set(q, group);
  }

  return Array.from(byQuarter.values()).sort((a, b) => {
    if (a.quarter === NO_QUARTER) return 1;
    if (b.quarter === NO_QUARTER) return -1;
    return quarterSortKey(b.quarter) - quarterSortKey(a.quarter);
  });
}

/** Oldest-first series for the delivered-per-quarter bar strip. Excludes the
 *  undated bucket, which has no position on a timeline, and counts only work
 *  that actually shipped — a cancelled process is not an output. */
export function deliveredSeries<T extends HistoricalRow>(
  groups: QuarterGroup<T>[]
): { quarter: string; delivered: number }[] {
  return groups
    .filter((g) => g.quarter !== NO_QUARTER)
    .map((g) => ({ quarter: g.quarter, delivered: g.live }))
    .reverse();
}
