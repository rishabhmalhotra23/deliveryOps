// Cumulative "processes migrated to V2" chart for the All-Hands report.
// Deliberately all-time-since-program-start, not reset per fiscal quarter —
// the migration program is one continuous effort, and a quarter boundary
// would be an arbitrary reset (Rishabh, 2026-08-07). Deliberately cumulative,
// not a per-week count — a running total can't look like a step backward on
// a quiet week the way a discrete weekly bar can. The chart's own final value
// always equals AllHandsStatus.migrationDoneCount (see migratedToV2Date below
// for why) — no separate population that can silently drift out of sync with
// the tile it sits next to.

import type { Process } from "@/lib/supabase/types";

// V2 migration became a company-wide program in mid-June 2026 (Rishabh,
// 2026-08-10) — a handful of pilot migrations (JBI, TTX, Plunkett, Norco,
// Bradley & Beams) landed one at a time over the prior two years and predate
// the program itself. Every All-Hands chart that plots "since the program
// started" — migration progress and ticket velocity alike — shares this one
// floor, so the two charts always cover the identical window and stay
// visually comparable side by side.
export const V2_PROGRAM_LAUNCH = new Date("2026-06-15T00:00:00Z");

export interface ProgressPoint {
  weekStart: string; // ISO date, Monday of that week
  cumulativeMigratedToV2: number;
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

/** The program's start date: the earliest, across all processes with real V2
 *  evidence, of each process's actual-migration-progress date — a parity/
 *  handover/validation/live milestone if it has reached one, else its
 *  kickoff_date, clamped (see below). Derived rather than hardcoded so it
 *  never needs manual updating. Returns null if nothing qualifies (e.g. an
 *  empty or freshly-seeded table).
 *
 *  kickoff_date marks when the process's ORIGINAL v1 automation began, which
 *  for older processes can be years before any V2 migration work started —
 *  using it as the primary signal produced a program start of 2022-12-26 in
 *  production (one old process with a stray linear ticket), stretching the
 *  progress chart with a multi-year flat lead-in before real migration work
 *  began. A parity/handover/validation/live date, when present, is real
 *  evidence that migration work landed and takes precedence; kickoff_date is
 *  only used as a fallback for a process that has V2 evidence (e.g. a linear
 *  ticket) but hasn't reached any of those milestones yet — i.e. it's
 *  actively being migrated but nothing has landed.
 *
 *  That fallback is CLAMPED, and the clamp is load-bearing rather than
 *  belt-and-braces: attaching a Linear ticket to an old v1 process is the
 *  normal first step of starting its migration, and that single edit would
 *  otherwise make its years-old kickoff_date the program start and bring the
 *  multi-year flat chart straight back. So a fallback kickoff_date can never
 *  pull the program start earlier than `earliestMilestoneDate` — the earliest
 *  real parity/handover/validation/live date anywhere in the set. Anything
 *  before that is raised up to it; real milestone dates are unaffected, since
 *  they are all >= earliestMilestoneDate by construction. If no process has
 *  reached any milestone at all, there is nothing to clamp against and the
 *  plain minimum of available kickoff_dates is used. */
export function computeMigrationProgramStart(processes: Process[]): Date | null {
  const evidenceBearing = processes.filter(hasV2Evidence);

  // Pass 1: the earliest real migration milestone anywhere. Processes that
  // have not reached one contribute nothing here.
  const milestoneDates = evidenceBearing
    .map(parityReachedDate)
    .filter((d): d is Date => d != null);
  const earliestMilestoneDate =
    milestoneDates.length > 0 ? milestoneDates.reduce((min, d) => (d < min ? d : min)) : null;

  // Pass 2: each process's own progress date, with the kickoff_date fallback
  // clamped up to earliestMilestoneDate.
  const dates = evidenceBearing
    .map((p) => parityReachedDate(p) ?? (p.kickoff_date ? new Date(p.kickoff_date) : null))
    .filter((d): d is Date => d != null)
    .map((d) => (earliestMilestoneDate && d < earliestMilestoneDate ? earliestMilestoneDate : d));

  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

/** The date a process actually became "done" — live_on_v2 or
 *  migrated_pending_commercial, matching AllHandsStatus.migrationDoneCount's
 *  own classification exactly, so this chart's final value always equals that
 *  tile's number.
 *
 *  date_parity_complete/date_customer_handover/date_customer_validation are
 *  NOT usable as a general "reached done" signal (Rishabh, 2026-08-10,
 *  investigating why the chart's peak didn't reconcile with any visible
 *  tile): production has one of those dates set on 44 of the 45
 *  migration-goal processes — including ones still in in_development or
 *  engg_pending — so they're populated early/broadly, not stamped
 *  specifically on completion. went_live_at is the one field that's clean:
 *  all 9 live_on_v2 rows have it, and it's stamped once, specifically on
 *  entering that stage (see MIGRATION_DONE_STAGE in lib/supabase/types.ts).
 *  migrated_pending_commercial rows don't go through that flow, but all 12 in
 *  production have date_parity_complete set — reliable for THIS narrower
 *  population because migration_stage already gates membership; the same
 *  field is unreliable as a general population filter but fine as a "when"
 *  once you already know "which". */
function migratedToV2Date(p: Process): Date | null {
  if (p.migration_stage !== "live_on_v2" && p.migration_stage !== "migrated_pending_commercial") return null;
  const raw = p.went_live_at ?? p.date_parity_complete;
  return raw ? new Date(raw) : null;
}

/** One point per week from the first Monday at or after programStart through asOf,
 *  each a running total of how many processes had become "done" by that week.
 *  Weeks with no new completions simply repeat the previous total. If programStart is
 *  not a Monday, the first data point represents the next Monday; this ensures all
 *  points represent full ISO weeks. */
export function computeMigratedToV2Progress(processes: Process[], programStart: Date, asOf: Date): ProgressPoint[] {
  const reachedDates = processes
    .map(migratedToV2Date)
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
    points.push({ weekStart: week.toISOString().slice(0, 10), cumulativeMigratedToV2: cumulative });
  }
  return points;
}
