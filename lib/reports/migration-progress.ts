// Cumulative "processes at or past parity" chart for the All-Hands report.
// Deliberately all-time-since-program-start, not reset per fiscal quarter —
// the migration program is one continuous effort, and a quarter boundary
// would be an arbitrary reset (Rishabh, 2026-08-07). Deliberately cumulative,
// not a per-week count — a running total can't look like a step backward on
// a quiet week the way a discrete weekly bar can.

import type { Process } from "@/lib/supabase/types";

export interface ProgressPoint {
  weekStart: string; // ISO date, Monday of that week
  cumulativeAtOrPastParity: number;
}

/** A process counts as "real V2 migration evidence" using the same rule as
 *  lib/processes/loader.ts's hasV2Evidence() / isV2Relevant() — any real
 *  signal of migration activity, not just a platform label. */
function hasV2Evidence(p: Process): boolean {
  return (
    p.linear_ticket_ids.length > 0 ||
    p.date_parity_complete != null ||
    p.date_customer_handover != null ||
    p.date_customer_validation != null ||
    p.went_live_at != null
  );
}

/** Earliest kickoff_date among processes with real V2 evidence — the
 *  program's start date, derived rather than hardcoded so it never needs
 *  manual updating. Returns null if nothing qualifies (e.g. an empty or
 *  freshly-seeded table). */
export function computeMigrationProgramStart(processes: Process[]): Date | null {
  const dates = processes
    .filter(hasV2Evidence)
    .map((p) => p.kickoff_date)
    .filter((d): d is string => d != null)
    .map((d) => new Date(d));
  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}

/** The earliest of a process's parity-or-later milestone dates — the date it
 *  first counted as "at or past parity". Reaching handover, validation, or
 *  go-live all imply parity was reached at or before that date. Returns null
 *  if the process never reached any of them. */
function parityReachedDate(p: Process): Date | null {
  const candidates = [p.date_parity_complete, p.date_customer_handover, p.date_customer_validation, p.went_live_at]
    .filter((d): d is string => d != null)
    .map((d) => new Date(d));
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d < min ? d : min));
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

/** One point per week from programStart to asOf, each a running total of how
 *  many processes had reached parity-or-later by that week. Weeks with no
 *  new milestones simply repeat the previous total. */
export function computeCumulativeProgress(processes: Process[], programStart: Date, asOf: Date): ProgressPoint[] {
  const reachedDates = processes
    .map(parityReachedDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());

  const points: ProgressPoint[] = [];
  let firstWeek = startOfIsoWeek(programStart);
  // If programStart is not a Monday, start from the next Monday
  if (firstWeek < programStart) {
    firstWeek = new Date(firstWeek);
    firstWeek.setUTCDate(firstWeek.getUTCDate() + 7);
  }
  const lastWeek = startOfIsoWeek(asOf);
  let cumulative = 0;
  let reachedIdx = 0;

  for (let week = new Date(firstWeek); week <= lastWeek; week.setUTCDate(week.getUTCDate() + 7)) {
    const weekEnd = new Date(week);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    while (reachedIdx < reachedDates.length && reachedDates[reachedIdx] < weekEnd) {
      cumulative++;
      reachedIdx++;
    }
    points.push({ weekStart: week.toISOString().slice(0, 10), cumulativeAtOrPastParity: cumulative });
  }
  return points;
}
