// Composes the All-Hands report from three already-live sources plus two
// report-specific derivations. See docs/mockups/2026-08-07-allhands-report-layout.html
// for the approved layout this feeds.

import { requireAdmin } from "@/lib/supabase/server";
import { loadV2MigrationOverview, type V2MigrationOverview } from "@/lib/processes/loader";
import { loadTicketsBundle } from "@/lib/tickets/loader";
import { getConfirmedArrForCustomer } from "@/lib/commercials/confirmed-arr";
import { resolveRange, type DateRange, type RangeRequest } from "@/lib/reports/date-range";
import { computeMigrationProgramStart, computeCumulativeProgress, type ProgressPoint } from "@/lib/reports/migration-progress";
import { findRenewalSpotlight, findAtRiskMigratingCustomers, type RenewalSpotlight, type AtRiskMigratingEntry } from "@/lib/reports/allhands-signals";
import { resolveBlockers, type BlockerItem } from "@/lib/reports/allhands-blockers";
import {
  computeDomainBuckets,
  computeCustomerTicketConcentration,
  type DomainBucket,
  type CustomerTicketConcentration,
} from "@/lib/reports/allhands-ticket-buckets";
import { computeTicketVelocity, type TicketVelocityPoint } from "@/lib/reports/allhands-ticket-velocity";
import { TABLES, IN_FLIGHT_STAGES, type Process } from "@/lib/supabase/types";

export interface AllHandsStatus {
  liveCount: number;
  activeCount: number;
  migratingNowCount: number;
  queuedCount: number;
  /** live_on_v2 + migrated_pending_commercial — migration work genuinely
   *  finished, whether or not the customer has signed off commercially yet.
   *  migrationDoneCount + migratingNowCount == migrationGoalTotal, always —
   *  same population, no other stage exists outside those two groups. */
  migrationDoneCount: number;
  /** Total processes ever in scope for the V2 migration program: every
   *  migration_stage row except not_required (never in scope) and v2_native
   *  (built directly on V2, nothing to migrate). This is the "Goal: N total
   *  migrations" denominator everywhere on the report — the chart's goal
   *  line, the stat tiles, and the headline caption all read this same
   *  number so it's never possible for a chart's peak to exceed its own goal. */
  migrationGoalTotal: number;
  /** Processes in the migration-goal population with is_blocked = true, right
   *  now. A single current snapshot, not a historical trend — there's no
   *  point-in-time history of is_blocked to reconstruct a real trend line
   *  from, so this is surfaced as a badge, not a chart series. */
  migrationBlockedNowCount: number;
  byStage: V2MigrationOverview["counts"]["byStage"];
  /** group: "complete" for stages that are done migrating (live_on_v2,
   *  migrated_pending_commercial — shown for context), "in_progress" for the
   *  IN_FLIGHT_STAGES that migratingNowCount actually sums. Lets the UI split
   *  the two groups visually instead of implying all rows sum to one count. */
  stageRows: Array<{ stage: string; label: string; count: number; processNames: string[]; group: "complete" | "in_progress" }>;
}

export interface AllHandsReport {
  range: DateRange;
  generatedAt: string;
  status: AllHandsStatus;
  /** Cumulative "at or past parity" count, weekly, over the SAME population
   *  status.migrationGoalTotal counts — its final point can never exceed
   *  migrationGoalTotal, since both are drawn from the same filtered set. */
  cumulativeProgress: ProgressPoint[];
  /** Weekly cumulative ticket-created vs ticket-closed counts, over all
   *  in-scope Linear tickets (not just hard blockers — this chart is about
   *  overall ticket velocity, not severity). */
  ticketVelocity: TicketVelocityPoint[];
  renewalSpotlight: RenewalSpotlight | null;
  atRiskMigrating: AtRiskMigratingEntry[];
  blockers: BlockerItem[];
  /** Open HARD BLOCKER tickets grouped by domain (Quill, IDP, Browser, ...),
   *  sorted by volume descending. Deliberately hard_blocker only — mixing in
   *  workaround_exists/just_a_bug tickets diluted "where are we actually
   *  stuck" with general feedback-backlog volume. */
  ticketDomainBuckets: DomainBucket[];
  /** Open hard-blocker tickets grouped by the customer whose migrating
   *  process(es) reference them, sorted by volume descending. Domain buckets
   *  alone hide a single migration (e.g. Conectiv) that racks up blockers
   *  across several domains at once — this surfaces that concentration
   *  directly. */
  customerTicketConcentration: CustomerTicketConcentration[];
  ticketHealth: {
    openInScope: number;
    hardBlockers: number;
    /** Rolling last-7-days deltas from loadTicketsBundle(), NOT the selected
     *  date range — labelled as "last 7 days" in the UI for that reason. */
    closedLast7Days: number;
    newLast7Days: number;
  };
  /** Non-null when the Linear ticket tables couldn't be read (e.g. migrations
   *  0017/0018 not applied to this Supabase project). The blockers and
   *  ticket-health sections are meaningless in that case — the UI renders an
   *  error banner instead of confident zeros. Everything else on the report
   *  still loads, so we surface it rather than throwing. */
  ticketDataError: string | null;
}

// Only the stages in STAGE_ORDER below are ever looked up here.
// `migrated_pending_commercial` gets its own row — migration work is
// genuinely finished, the customer just hasn't signed off commercially yet.
// Folding it into `live_on_v2` previously hid a bucket that was, in
// production, larger than any single in-flight stage.
const STAGE_LABELS: Record<string, string> = {
  live_on_v2: "Live on V2",
  migrated_pending_commercial: "Migrated, pending commercial",
  customer_validation: "Customer validation",
  parity_testing: "Parity testing",
  engg_pending: "Engg pending",
  in_development: "In development",
};
const STAGE_ORDER = [
  "live_on_v2",
  "migrated_pending_commercial",
  "customer_validation",
  "parity_testing",
  "engg_pending",
  "in_development",
];

/**
 * Loads the whole All-Hands report.
 *
 * Range semantics, so a future reader doesn't mistake this for a bug: only
 * `range.label` (header) and `range.end` (the chart's "as of" and the renewal
 * spotlight's "today") actually consume the selected range. `status`,
 * `atRiskMigrating`, `cumulativeProgress` and `renewalSpotlight` are
 * current-state snapshots by design — they answer "where does the portfolio
 * stand right now", not "what happened inside this window" — so Week / Month /
 * Quarter render the same content with a different header. `ticketHealth`'s
 * closed/new counts come from loadTicketsBundle()'s hardcoded rolling 7-day
 * delta and are labelled "last 7 days" in the UI accordingly.
 */
export async function loadAllHandsReport(req: RangeRequest = {}): Promise<AllHandsReport> {
  const sb = requireAdmin();
  const range = resolveRange(req);

  const [overview, tickets, customersRes, oppsRes, processesRes] = await Promise.all([
    loadV2MigrationOverview(),
    loadTicketsBundle(),
    // .order("key") so every customer-derived list on this report (the
    // at-risk-and-migrating list, and the renewal spotlight's tiebreak input)
    // is stable across page loads and PNG exports rather than depending on
    // Postgres's physical row order.
    sb.from(TABLES.customers).select("id, key, display_name, custom_category, lifecycle_group").is("deleted_at", null).order("key"),
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed"),
    sb.from(TABLES.processes).select("*"),
  ]);
  // Surface read failures instead of silently rendering a misleadingly-empty
  // report (0 live processes, no renewal spotlight, etc.) — same convention
  // as lib/processes/loader.ts's fetchAllProcessRows().
  if (customersRes.error) throw customersRes.error;
  if (oppsRes.error) throw oppsRes.error;
  if (processesRes.error) throw processesRes.error;

  type CustomerRow = { id: string; key: string; display_name: string; custom_category: string | null; lifecycle_group: string | null };
  const customers = (customersRes.data as CustomerRow[] | null) ?? [];

  type OppRow = { customer_id: string; amount: number | null; close_date: string | null; is_won: boolean; is_closed: boolean };
  const oppsByCustomer = new Map<string, OppRow[]>();
  for (const o of (oppsRes.data as OppRow[] | null) ?? []) {
    const list = oppsByCustomer.get(o.customer_id) ?? [];
    list.push(o);
    oppsByCustomer.set(o.customer_id, list);
  }
  const arrByCustomer = new Map(
    customers.map((c) => [c.id, getConfirmedArrForCustomer(c.key, oppsByCustomer.get(c.id) ?? [])])
  );

  const allProcesses = (processesRes.data as Process[] | null) ?? [];
  const processesByCustomer = new Map<string, Process[]>();
  for (const p of allProcesses) {
    if (!p.customer_id) continue;
    const list = processesByCustomer.get(p.customer_id) ?? [];
    list.push(p);
    processesByCustomer.set(p.customer_id, list);
  }

  // ── Status ──────────────────────────────────────────────────────────────
  const liveCount = allProcesses.filter((p) => p.lifecycle === "live").length;
  const activeCount = allProcesses.filter((p) => !["live", "cancelled", "churned", "retired"].includes(p.lifecycle)).length;
  const queuedCount = allProcesses.filter((p) => p.lifecycle === "backlog" || p.lifecycle === "upcoming").length;
  // "Migrating now" = truly in-flight stages only (IN_FLIGHT_STAGES, the same
  // constant lib/supabase/types.ts already exports for this exact purpose) —
  // does NOT include live_on_v2/migrated_pending_commercial, which are
  // already-finished migrations, not work in progress. The stage board below
  // is a broader view that legitimately includes a "Live on V2" column for
  // context (see the mockup), so it's built from its own filter, not this one.
  const migratingNowRows = overview.rows.filter((r) => IN_FLIGHT_STAGES.includes(r.migration_stage));
  // The migration-goal population: every migration_stage row except
  // not_required (never in scope for V2 at all) and v2_native (built
  // directly on V2 — there's nothing to migrate). This is the SAME
  // population computeCumulativeProgress charts, so the chart's peak and
  // the goal line always agree — no two-different-filters mismatch.
  const migrationTrackedRows = overview.rows.filter((r) => r.migration_stage !== "v2_native");
  const migrationDoneRows = migrationTrackedRows.filter((r) => !IN_FLIGHT_STAGES.includes(r.migration_stage));
  const migrationBlockedNowCount = migrationTrackedRows.filter((r) => r.is_blocked).length;
  const stageRows = STAGE_ORDER.map((stage) => {
    const rows = overview.rows.filter((r) => r.migration_stage === stage);
    return {
      stage,
      label: STAGE_LABELS[stage],
      count: rows.length,
      processNames: rows.map((r) => r.process_name),
      group: (IN_FLIGHT_STAGES.includes(stage as Process["migration_stage"]) ? "in_progress" : "complete") as
        | "complete"
        | "in_progress",
    };
  }).filter((row) => row.count > 0);

  // ── Cumulative progress (all-time since program start, not per-quarter) ──
  // Computed over migrationTrackedRows — NOT overview.rows directly, and NOT
  // every process row. The chart's peak has to stay <= the goal line, and the
  // goal is migrationGoalTotal (migrationTrackedRows.length): using a
  // differently-filtered population for either one previously let the chart
  // read "46" against a goal of "45", or let migration_stage='not_required'
  // rows that happen to carry a milestone date inflate the numerator.
  // V2ProcessRow extends Process, so these carry every milestone field the
  // derivation needs.
  const trackedProcesses: Process[] = migrationTrackedRows;
  const derivedProgramStart = computeMigrationProgramStart(trackedProcesses);
  // V2 migration became a company-wide program in mid-June 2026 (Rishabh,
  // 2026-08-10) — a handful of pilot migrations (JBI, TTX, Plunkett, Norco,
  // Bradley & Beams) landed one at a time over the prior two years and
  // predate the program itself. Charting from their dates compresses the
  // real ~6-week ramp into a sliver of a 2-year-wide chart, reading as one
  // spike instead of a legible climb. The chart's window is floored at the
  // program's actual launch — never earlier — while
  // computeMigrationProgramStart's per-process derivation (and the
  // "N of M tracked... since the program started" headline denominator,
  // which doesn't depend on this floor) are unaffected.
  const V2_PROGRAM_LAUNCH = new Date("2026-06-15T00:00:00Z");
  const programStart = derivedProgramStart && derivedProgramStart > V2_PROGRAM_LAUNCH ? derivedProgramStart : V2_PROGRAM_LAUNCH;
  const cumulativeProgress = derivedProgramStart ? computeCumulativeProgress(trackedProcesses, programStart, range.end) : [];

  // ── Renewal spotlight + at-risk cross-signal ─────────────────────────────
  const renewalSpotlight = findRenewalSpotlight(customers, arrByCustomer, processesByCustomer, range.end);
  const atRiskMigrating = findAtRiskMigratingCustomers(customers, processesByCustomer);

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers = resolveBlockers(tickets.team_asks.now.concat(tickets.team_asks.soon));
  const hardBlockerOpenTickets = tickets.open_tickets.filter((t) => t.classification === "hard_blocker");
  const ticketDomainBuckets = computeDomainBuckets(hardBlockerOpenTickets);
  const hardBlockerTicketsById = new Map(hardBlockerOpenTickets.map((t) => [t.id, t]));
  const customerTicketConcentration = computeCustomerTicketConcentration(customers, processesByCustomer, hardBlockerTicketsById);
  const ticketVelocity = computeTicketVelocity(tickets.open_tickets.concat(tickets.closed_tickets), range.end);

  return {
    range,
    generatedAt: new Date().toISOString(),
    status: {
      liveCount,
      activeCount,
      migratingNowCount: migratingNowRows.length,
      queuedCount,
      migrationDoneCount: migrationDoneRows.length,
      migrationGoalTotal: migrationTrackedRows.length,
      migrationBlockedNowCount,
      byStage: overview.counts.byStage,
      stageRows,
    },
    cumulativeProgress,
    ticketVelocity,
    renewalSpotlight,
    atRiskMigrating,
    blockers,
    ticketDomainBuckets,
    customerTicketConcentration,
    ticketHealth: {
      openInScope: tickets.totals.open,
      hardBlockers: tickets.open_tickets.filter((t) => t.classification === "hard_blocker").length,
      closedLast7Days: tickets.delta.newly_closed,
      newLast7Days: tickets.delta.new_count,
    },
    ticketDataError: tickets.data_error,
  };
}
