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
import { TABLES, IN_FLIGHT_STAGES, type Process } from "@/lib/supabase/types";

export interface AllHandsStatus {
  liveCount: number;
  activeCount: number;
  migratingNowCount: number;
  queuedCount: number;
  byStage: V2MigrationOverview["counts"]["byStage"];
  stageRows: Array<{ stage: string; label: string; count: number; processNames: string[] }>;
}

export interface AllHandsReport {
  range: DateRange;
  generatedAt: string;
  status: AllHandsStatus;
  cumulativeProgress: ProgressPoint[];
  renewalSpotlight: RenewalSpotlight | null;
  atRiskMigrating: AtRiskMigratingEntry[];
  blockers: BlockerItem[];
  ticketHealth: {
    openInScope: number;
    hardBlockers: number;
    closedThisPeriod: number;
    newThisPeriod: number;
  };
}

const STAGE_LABELS: Record<string, string> = {
  live_on_v2: "Live on V2",
  migrated_pending_commercial: "Live on V2",
  customer_validation: "Customer validation",
  parity_testing: "Parity testing",
  engg_pending: "Engg pending",
  in_development: "In development",
};
const STAGE_ORDER = ["live_on_v2", "customer_validation", "parity_testing", "engg_pending", "in_development"];

export async function loadAllHandsReport(req: RangeRequest = {}): Promise<AllHandsReport> {
  const sb = requireAdmin();
  const range = resolveRange(req);

  const [overview, tickets, customersRes, oppsRes, processesRes] = await Promise.all([
    loadV2MigrationOverview(),
    loadTicketsBundle(),
    sb.from(TABLES.customers).select("id, key, display_name, custom_category, lifecycle_group").is("deleted_at", null),
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed"),
    sb.from(TABLES.processes).select("*"),
  ]);

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
  const stageRows = STAGE_ORDER.map((stage) => {
    const rows = overview.rows.filter((r) => (stage === "live_on_v2" ? r.migration_stage === "live_on_v2" || r.migration_stage === "migrated_pending_commercial" : r.migration_stage === stage));
    return { stage, label: STAGE_LABELS[stage], count: rows.length, processNames: rows.map((r) => r.process_name) };
  }).filter((row) => row.count > 0);

  // ── Cumulative progress (all-time since program start, not per-quarter) ──
  const programStart = computeMigrationProgramStart(allProcesses);
  const cumulativeProgress = programStart ? computeCumulativeProgress(allProcesses, programStart, range.end) : [];

  // ── Renewal spotlight + at-risk cross-signal ─────────────────────────────
  const renewalSpotlight = findRenewalSpotlight(customers, arrByCustomer, processesByCustomer, range.end);
  const atRiskMigrating = findAtRiskMigratingCustomers(customers, processesByCustomer);

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers = resolveBlockers(tickets.team_asks.now.concat(tickets.team_asks.soon), tickets.open_tickets);

  return {
    range,
    generatedAt: new Date().toISOString(),
    status: {
      liveCount,
      activeCount,
      migratingNowCount: migratingNowRows.length,
      queuedCount,
      byStage: overview.counts.byStage,
      stageRows,
    },
    cumulativeProgress,
    renewalSpotlight,
    atRiskMigrating,
    blockers,
    ticketHealth: {
      openInScope: tickets.totals.open,
      hardBlockers: tickets.open_tickets.filter((t) => t.classification === "hard_blocker").length,
      closedThisPeriod: tickets.delta.newly_closed,
      newThisPeriod: tickets.delta.new_count,
    },
  };
}
