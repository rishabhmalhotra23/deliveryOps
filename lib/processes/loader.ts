// Delivery page loader. Reads `processes` (0021) directly — no Monday
// involved. One fetch serves every view on the page: the Active-work board
// (lanes), the Delivered/Archive/All tables, and the Q-on-Q charts.
//
// Lane assignment reuses laneFor()/viewForLifecycle() from the importer's
// taxonomy module rather than re-deriving the mapping; those two functions
// are already unit-tested against the real archive counts.

import { requireAdmin } from "@/lib/supabase/server";
import { laneFor, viewForLifecycle, type ActiveLane } from "@/lib/import/monday-taxonomy";
import { TABLES, type Process, type ProcessView } from "@/lib/supabase/types";

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

export async function loadProcessesOverview(): Promise<ProcessesOverview> {
  const sb = requireAdmin();

  const [processesRes, customersRes, suggestionsRes] = await Promise.all([
    sb.from(TABLES.processes).select("*"),
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
