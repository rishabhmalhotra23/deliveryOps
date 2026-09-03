// Delivery page loader. Reads `processes` (0021) directly — no Monday
// involved. One fetch serves every view on the page: the Active-work board
// (lanes), the Delivered/Archive/All tables, and the Q-on-Q charts.
//
// Lane assignment reuses laneFor()/viewForLifecycle() from the importer's
// taxonomy module rather than re-deriving the mapping; those two functions
// are already unit-tested against the real archive counts.

import { requireAdmin } from "@/lib/supabase/server";
import { laneFor, viewForLifecycle, type ActiveLane } from "@/lib/import/monday-taxonomy";
import { TABLES, MIGRATION_STAGES, MIGRATION_STAGE_LABELS, type Process, type ProcessView, type MigrationStage } from "@/lib/supabase/types";
import { getConfirmedArrForCustomer, type OppForConfirmedArr } from "@/lib/commercials/confirmed-arr";

// Full Process row plus fields the UI needs that aren't on the table itself:
// the resolved customer name, the open-suggestion count, and whether this
// row was ever actually classified by an import (vs. sitting at 0021's
// 'discovery' default because nothing ever matched it).
export interface ProcessRow extends Process {
  customer_display_name: string;
  open_suggestion_count: number;
  /** True for rows with no source_system — the 12 old V2-tracker rows that
   *  never matched a Monday item. Not a real "discovery" status, an import
   *  artifact; surfaced so it isn't mistaken for active work. */
  needs_classification: boolean;
}

export const ACTIVE_LANES: ActiveLane[] = ["pipeline", "building", "validating", "stuck"];

export const ACTIVE_LANE_LABELS: Record<ActiveLane, string> = {
  pipeline: "Pipeline",
  building: "Building",
  validating: "Validating",
  stuck: "Stuck",
};

export interface QuarterCounts {
  quarter: string;
  delivered: number;
  in_flight: number;
  at_risk: number;
  inactive: number;
}

export interface QuarterTtv {
  quarter: string;
  avgTtv: number;
  count: number;
}

export interface CustomerQuarterRow {
  customer: string;
  total: number;
  byQ: Record<string, number>;
}

export interface ProcessesOverview {
  all: ProcessRow[];
  lanes: Record<ActiveLane, ProcessRow[]>;
  counts: {
    total: number;
    active: number;
    delivered: number;
    archive: number;
    needsAttention: number;
    needsClassification: number;
    archiveBreakdown: { cancelled: number; churned: number; retired: number };
  };
  qonq: {
    byQuarter: QuarterCounts[];
    avgTtvByQuarter: QuarterTtv[];
    byCustomer: CustomerQuarterRow[];
  };
  facets: {
    customers: string[];
    fdeOwners: string[];
    tamOwners: string[];
    partners: string[];
    /** {id, display_name} pairs, for the drawer's customer-reassignment select. */
    customerOptions: { id: string; display_name: string }[];
  };
}

interface CustomerRow {
  id: string;
  display_name: string;
}

/** "2026-03-19" -> "2026 Q1" (calendar quarter, matches the old Q-on-Q keying). */
function quarterLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const calQ = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()} Q${calQ}`;
}

const dedupSorted = (values: (string | null | undefined)[]): string[] =>
  Array.from(new Set(values.filter((v): v is string => !!v))).sort();

// Shared by every overview loader — one fetch of `processes` + the customer
// roster + open suggestion counts, mapped into the ProcessRow shape the UI
// needs. Pulled out so loadV2MigrationOverview doesn't re-derive this.
async function fetchAllProcessRows(): Promise<{
  all: ProcessRow[];
  custById: Map<string, CustomerRow>;
}> {
  const sb = requireAdmin();

  const [processesRes, customersRes, suggestionsRes] = await Promise.all([
    sb.from(TABLES.processes).select("*").is("deleted_at", null),
    sb.from("customers").select("id, display_name").is("deleted_at", null),
    sb.from(TABLES.processSuggestions).select("process_id").eq("status", "open"),
  ]);

  if (processesRes.error) throw processesRes.error;
  if (customersRes.error) throw customersRes.error;

  const custById = new Map<string, CustomerRow>();
  for (const c of (customersRes.data as CustomerRow[] | null) ?? []) custById.set(c.id, c);

  const suggestionCounts = new Map<string, number>();
  for (const s of (suggestionsRes.data as { process_id: string }[] | null) ?? []) {
    suggestionCounts.set(s.process_id, (suggestionCounts.get(s.process_id) ?? 0) + 1);
  }

  const rawRows = (processesRes.data as Process[] | null) ?? [];
  const all: ProcessRow[] = rawRows.map((row) => ({
    ...row,
    customer_display_name:
      (row.customer_id && custById.get(row.customer_id)?.display_name) || row.account,
    open_suggestion_count: suggestionCounts.get(row.id) ?? 0,
    needs_classification: !row.source_system,
  }));

  return { all, custById };
}

export async function loadProcessesOverview(): Promise<ProcessesOverview> {
  const { all, custById } = await fetchAllProcessRows();

  // ─── Lanes (Active view) ────────────────────────────────────────────────
  const lanes: Record<ActiveLane, ProcessRow[]> = {
    pipeline: [],
    building: [],
    validating: [],
    stuck: [],
  };
  for (const row of all) {
    const lane = laneFor(row.lifecycle, row.blocked_on);
    if (lane) lanes[lane].push(row);
  }
  for (const lane of ACTIVE_LANES) {
    lanes[lane].sort((a, b) => a.updated_at.localeCompare(b.updated_at)); // stalest first
  }

  // ─── Counts ─────────────────────────────────────────────────────────────
  let active = 0, delivered = 0, archive = 0, needsAttention = 0, needsClassification = 0;
  const archiveBreakdown = { cancelled: 0, churned: 0, retired: 0 };
  for (const row of all) {
    const view: ProcessView = viewForLifecycle(row.lifecycle);
    if (view === "active") active++;
    else if (view === "delivered") delivered++;
    else {
      archive++;
      if (row.lifecycle === "cancelled") archiveBreakdown.cancelled++;
      else if (row.lifecycle === "churned") archiveBreakdown.churned++;
      else if (row.lifecycle === "retired") archiveBreakdown.retired++;
    }
    if (row.needs_attention) needsAttention++;
    if (row.needs_classification) needsClassification++;
  }

  // ─── Q-on-Q ─────────────────────────────────────────────────────────────
  const byQuarterMap = new Map<string, QuarterCounts>();
  const ttvByQuarterMap = new Map<string, number[]>();
  const byCustomerMap = new Map<string, Record<string, number>>();

  for (const row of all) {
    const q = quarterLabel(row.go_live_date) ?? quarterLabel(row.kickoff_date);
    if (!q) continue;
    const bucket = byQuarterMap.get(q) ?? { quarter: q, delivered: 0, in_flight: 0, at_risk: 0, inactive: 0 };
    const view = viewForLifecycle(row.lifecycle);
    if (view === "delivered") bucket.delivered++;
    else if (row.health === "at_risk") bucket.at_risk++;
    else if (view === "archive") bucket.inactive++;
    else bucket.in_flight++;
    byQuarterMap.set(q, bucket);

    if (view === "delivered" && row.go_live_date) {
      const qGoLive = quarterLabel(row.go_live_date)!;
      if (row.ttv_days != null) {
        const arr = ttvByQuarterMap.get(qGoLive) ?? [];
        arr.push(row.ttv_days);
        ttvByQuarterMap.set(qGoLive, arr);
      }
      const custRow = byCustomerMap.get(row.customer_display_name) ?? {};
      custRow[qGoLive] = (custRow[qGoLive] ?? 0) + 1;
      byCustomerMap.set(row.customer_display_name, custRow);
    }
  }

  const byQuarter = Array.from(byQuarterMap.values()).sort((a, b) => a.quarter.localeCompare(b.quarter));
  const avgTtvByQuarter = Array.from(ttvByQuarterMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, days]) => ({
      quarter,
      avgTtv: Math.round(days.reduce((a, b) => a + b, 0) / days.length),
      count: days.length,
    }));
  const byCustomer = Array.from(byCustomerMap.entries())
    .map(([customer, byQ]) => ({
      customer,
      total: Object.values(byQ).reduce((a, b) => a + b, 0),
      byQ,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  return {
    all,
    lanes,
    counts: { total: all.length, active, delivered, archive, needsAttention, needsClassification, archiveBreakdown },
    qonq: { byQuarter, avgTtvByQuarter, byCustomer },
    facets: {
      customers: dedupSorted(all.map((r) => r.customer_display_name)),
      fdeOwners: dedupSorted(all.map((r) => r.fde_owner)),
      tamOwners: dedupSorted(all.map((r) => r.tam_owner)),
      partners: dedupSorted(all.map((r) => r.partner)),
      customerOptions: Array.from(custById.values()).sort((a, b) => a.display_name.localeCompare(b.display_name)),
    },
  };
}

export { viewForLifecycle };

// ─── V2 migration overview ──────────────────────────────────────────────────
// Reads the same `processes` rows as the Delivery page — no separate dataset.
// "V2 relevant" means the row carries some real signal of migration activity;
// plain not_required/v1 rows with no migration fields populated are excluded
// so this page isn't just "every process" with a different label.

/** Stage order for the summary strip — roughly the order work moves through. */
export const V2_STAGES: MigrationStage[] = [
  "in_development",
  "engg_pending",
  "parity_testing",
  "customer_validation",
  "live_on_v2",
  "migrated_pending_commercial",
  "v2_native",
];

/** Any concrete sign this process actually went through migration work, as
 *  opposed to just carrying a stage label. */
function hasV2Evidence(row: ProcessRow): boolean {
  return (
    row.linear_ticket_ids.length > 0 ||
    row.date_parity_complete != null ||
    row.date_customer_handover != null ||
    row.date_customer_validation != null ||
    row.went_live_at != null
  );
}

function isV2Relevant(row: ProcessRow): boolean {
  if (row.migration_stage === "not_required") return false;
  // v2_native means "built directly on v2, nothing ever migrated" — the same
  // reason lib/reports/v2-week's tracker parser has always excluded "V2
  // implementation" from the migration board and counted it only in the
  // estate split. Most v2_native rows here are a side effect of a broad
  // import-time default (platform === 'v2' => v2_native even with zero
  // linear tickets or dates, so cancelled/backlog/pipeline processes tagged
  // platform V2 for unrelated reasons all inherited the label). Only show
  // the ones with real evidence something was actually migrated.
  if (row.migration_stage === "v2_native" && !hasV2Evidence(row)) return false;
  return true;
}

// processes.arr is a one-time snapshot from the V2 Migration Excel import —
// never re-synced, so it drifts from reality the moment a deal renews or
// shrinks (caught 2026-08-06: JBI and Norco were both stale). ARR shown here
// instead comes from the same confirmed-ARR system the customer 360 and
// dashboard already use (lib/commercials/confirmed-arr.ts): the most recent
// past Closed-Won Salesforce opp, with the same manual GTM overrides.
export interface V2ProcessRow extends ProcessRow {
  confirmed_arr: number | null;
}

/** Per-customer migration progress — "Acme: 3 of 5 processes migrated" —
 *  shown on the V2 Migration tab itself rather than only in the separate
 *  All-Hands report. */
export interface CustomerMigrationRollup {
  customer_id: string;
  customer_display_name: string;
  migrated: number;
  total: number;
}

// A row counts as migrated once it's actually live on v2 for the customer —
// not just "in progress" (in_development/engg_pending/parity_testing/
// customer_validation). v2_native is excluded on purpose: per isV2Relevant's
// comment above, that stage means "built directly on v2, nothing migrated,"
// so it carries no migration-progress signal even when it clears the
// evidence bar for being shown at all.
const MIGRATED_STAGES = new Set<MigrationStage>(["live_on_v2", "migrated_pending_commercial"]);

/** Exported for unit testing — pure aggregation over already-loaded rows. */
export function buildCustomerRollup(rows: V2ProcessRow[]): CustomerMigrationRollup[] {
  const byCustomer = new Map<string, CustomerMigrationRollup>();
  for (const row of rows) {
    if (!row.customer_id) continue;
    let entry = byCustomer.get(row.customer_id);
    if (!entry) {
      entry = {
        customer_id: row.customer_id,
        customer_display_name: row.customer_display_name,
        migrated: 0,
        total: 0,
      };
      byCustomer.set(row.customer_id, entry);
    }
    entry.total++;
    if (MIGRATED_STAGES.has(row.migration_stage)) entry.migrated++;
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);
}

export interface V2MigrationOverview {
  rows: V2ProcessRow[];
  counts: {
    total: number;
    byStage: Record<MigrationStage, number>;
  };
  customerRollup: CustomerMigrationRollup[];
  facets: {
    customers: string[];
    fdeOwners: string[];
    tamOwners: string[];
    partners: string[];
    customerOptions: { id: string; display_name: string }[];
  };
}

export async function loadV2MigrationOverview(): Promise<V2MigrationOverview> {
  const { all, custById } = await fetchAllProcessRows();
  const relevant = all.filter(isV2Relevant);

  const sb = requireAdmin();
  const { data: oppsData, error: oppsError } = await sb
    .from("sf_opportunities")
    .select("customer_id, amount, close_date, is_won, is_closed, stage_name");
  if (oppsError) throw oppsError;

  const oppsByCustomer = new Map<string, OppForConfirmedArr[]>();
  for (const o of (oppsData as (OppForConfirmedArr & { customer_id: string })[] | null) ?? []) {
    const list = oppsByCustomer.get(o.customer_id) ?? [];
    list.push(o);
    oppsByCustomer.set(o.customer_id, list);
  }

  const rows: V2ProcessRow[] = relevant.map((row) => {
    const opps = (row.customer_id && oppsByCustomer.get(row.customer_id)) || [];
    const confirmed = getConfirmedArrForCustomer(row.customer_key, opps);
    return { ...row, confirmed_arr: confirmed.arr > 0 ? confirmed.arr : null };
  });

  const byStage = Object.fromEntries(MIGRATION_STAGES.map((s) => [s, 0])) as Record<
    MigrationStage,
    number
  >;
  for (const row of rows) byStage[row.migration_stage]++;

  return {
    rows,
    counts: { total: rows.length, byStage },
    customerRollup: buildCustomerRollup(rows),
    facets: {
      customers: dedupSorted(rows.map((r) => r.customer_display_name)),
      fdeOwners: dedupSorted(rows.map((r) => r.fde_owner)),
      tamOwners: dedupSorted(rows.map((r) => r.tam_owner)),
      partners: dedupSorted(rows.map((r) => r.partner)),
      customerOptions: Array.from(custById.values()).sort((a, b) =>
        a.display_name.localeCompare(b.display_name)
      ),
    },
  };
}

export { MIGRATION_STAGE_LABELS };
