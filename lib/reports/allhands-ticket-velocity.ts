// Weekly cumulative created-vs-closed ticket counts for the All-Hands report's
// second chart. Unlike the migration-progress chart's "blocked processes"
// line, this one is fully reconstructible from real historical timestamps
// (linear_created_at, closed_at) rather than a point-in-time snapshot — no
// history table needed.

import type { TicketRow } from "@/lib/tickets/types";

export interface TicketVelocityPoint {
  weekStart: string; // ISO date, Monday of that week
  cumulativeCreated: number;
  cumulativeClosed: number;
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

/** `tickets` should already be the in-scope population (loadTicketsBundle()'s
 *  open_tickets + closed_tickets, both already in_scope-filtered) — this
 *  function does no scope filtering of its own.
 *
 *  `windowStart` sets where the chart's visible range begins — shared with
 *  the migration-progress chart (see V2_PROGRAM_LAUNCH in
 *  migration-progress.ts) so both charts cover the identical window.
 *  Cumulative counts are seeded with everything before windowStart, so the
 *  totals stay real cumulative-since-ever-created numbers (matching the
 *  "N created" headline) — only the chart's visible starting point moves,
 *  not what's being counted. */
export function computeTicketVelocity(tickets: TicketRow[], windowStart: Date, asOf: Date): TicketVelocityPoint[] {
  if (tickets.length === 0) return [];

  const createdDates = tickets.map((t) => new Date(t.linear_created_at)).sort((a, b) => a.getTime() - b.getTime());
  const closedDates = tickets
    .map((t) => t.closed_at)
    .filter((d): d is string => d != null)
    .map((d) => new Date(d))
    .sort((a, b) => a.getTime() - b.getTime());

  let firstWeek = startOfIsoWeek(windowStart);
  if (firstWeek < windowStart) {
    firstWeek = new Date(firstWeek);
    firstWeek.setUTCDate(firstWeek.getUTCDate() + 7);
  }
  const lastWeek = startOfIsoWeek(asOf);

  const points: TicketVelocityPoint[] = [];
  let createdIdx = createdDates.filter((d) => d < firstWeek).length;
  let closedIdx = closedDates.filter((d) => d < firstWeek).length;
  let cumulativeCreated = createdIdx;
  let cumulativeClosed = closedIdx;

  for (let week = new Date(firstWeek); week <= lastWeek; week.setUTCDate(week.getUTCDate() + 7)) {
    const weekEnd = new Date(week);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    while (createdIdx < createdDates.length && createdDates[createdIdx] < weekEnd) {
      cumulativeCreated++;
      createdIdx++;
    }
    while (closedIdx < closedDates.length && closedDates[closedIdx] < weekEnd) {
      cumulativeClosed++;
      closedIdx++;
    }
    points.push({ weekStart: week.toISOString().slice(0, 10), cumulativeCreated, cumulativeClosed });
  }
  return points;
}
