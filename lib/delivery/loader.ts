// Portfolio-wide Delivery loader. Pulls all Monday project rows (all FY boards
// + active + inactive/cancelled) with their stored columns so the Delivery
// Analytics page has complete historical context for Q-on-Q.
//
// Source: monday_projects + customers caches. All 6 boards are now synced;
// the fiscal_year column identifies which board each row came from.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer } from "@/app/_components/brand";

type RawColumns = Record<string, { type: string; text: string | null; value: string | null }>;
function txt(cols: RawColumns, id: string): string | null {
  const cell = cols?.[id];
  if (!cell) return null;
  return (cell.text ?? "").trim() || null;
}

// Column IDs shared across all project boards (stable against Monday renames).
const COLS = {
  health:      "color_mm01ft4",
  status:      "color_mkzj8fw8",
  phase:       "color_mm06sdrj",
  platform:    "color_mm0698sb",
  kickoff_date:"date_mm011n1f",
  go_live_date:"date_mm01dz3b",
  ttv:         "formula_mm01p18k",
  complexity:  "dropdown_mm06r92k",
  tam:         "multiple_person_mkzrppyd",
  dev:         "multiple_person_mkzrgk3b",
  partner:     "dropdown_mm06hne3",
};

export interface DeliveryProject {
  monday_item_id: string;
  name: string;
  customer_key: string;
  customer_display_name: string;
  customer_category: string;
  ae_owner: string | null;
  // Board provenance
  fiscal_year: string | null;
  board_name: string | null;
  // Monday group (Active / Pipeline / Q1'26 / etc.)
  group_title: string | null;
  state: string | null;
  monday_updated_at: string | null;
  // Lifted from raw_columns
  health: string | null;
  status: string | null;
  phase: string | null;
  platform: string | null;
  complexity: string | null;
  kickoff_date: string | null;
  go_live_date: string | null;
  tam: string | null;
  dev: string | null;
  partner: string | null;
  // Stored columns from migration 0010
  total_effort_days: number | null;
  delivered_value: string | null;
  ttv_days_text: string | null;
  timeline_start: string | null;
  timeline_end: string | null;
  latest_update: string | null;
}

export interface DeliveryFilterFacets {
  customers: string[];
  aes: string[];
  partners: string[];
  fiscal_years: string[];
  statuses: string[];
  platforms: string[];
}

export interface DeliveryBundle {
  projects: DeliveryProject[];
  facets: DeliveryFilterFacets;
  totals: {
    total: number;
    active_in_flight: number;
    at_risk: number;
    delivered_all_time: number;
    delivered_this_quarter: number;
  };
  last_sync: string | null;
}

interface ProjectRow {
  monday_item_id: string;
  name: string;
  group_title: string | null;
  state: string | null;
  monday_updated_at: string | null;
  customer_id: string;
  raw_columns: RawColumns;
  fiscal_year: string | null;
  board_name: string | null;
  go_live_date: string | null;
  kickoff_date: string | null;
  total_effort_days: number | null;
  delivered_value: string | null;
  ttv_days_text: string | null;
  timeline_start: string | null;
  timeline_end: string | null;
  latest_update: string | null;
}

interface CustomerRow {
  id: string;
  key: string;
  display_name: string;
  ae_owner: string | null;
  partner: string | null;
  custom_category: string | null;
  lifecycle_group: string | null;
}

function isCurrentQuarter(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    Math.floor(d.getUTCMonth() / 3) === Math.floor(now.getUTCMonth() / 3)
  );
}

function isDelivered(p: DeliveryProject): boolean {
  const s = (p.status ?? "").toLowerCase();
  return s === "live" || s === "delivered";
}

export async function loadDeliveryBundle(): Promise<DeliveryBundle> {
  const sb = requireAdmin();

  const [projects, customers, lastSync] = await Promise.all([
    sb
      .from("monday_projects")
      .select(
        "monday_item_id, name, group_title, state, monday_updated_at, customer_id, " +
        "fiscal_year, board_name, raw_columns, " +
        "go_live_date, kickoff_date, " +
        "total_effort_days, delivered_value, ttv_days_text, " +
        "timeline_start, timeline_end, latest_update"
      )
      .order("go_live_date", { ascending: false, nullsFirst: false })
      .limit(1000),
    sb
      .from("customers")
      .select("id, key, display_name, ae_owner, partner, custom_category, lifecycle_group")
      .is("deleted_at", null),
    sb
      .from("sync_runs")
      .select("finished_at")
      .eq("source", "monday")
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const custById = new Map<string, CustomerRow>();
  for (const c of (customers.data as CustomerRow[] | null) ?? []) {
    custById.set(c.id, c);
  }

  const rows: DeliveryProject[] = [];
  for (const p of (projects.data as ProjectRow[] | null) ?? []) {
    const cust = custById.get(p.customer_id);
    if (!cust) continue;
    const cols = p.raw_columns ?? {};
    rows.push({
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_key: cust.key,
      customer_display_name: cust.display_name,
      customer_category: categoryFromCustomer({
        custom_category: cust.custom_category,
        lifecycle_group: cust.lifecycle_group,
      }),
      ae_owner: cust.ae_owner,
      fiscal_year: p.fiscal_year,
      board_name: p.board_name,
      group_title: p.group_title,
      state: p.state,
      monday_updated_at: p.monday_updated_at,
      health:       txt(cols, COLS.health),
      status:       txt(cols, COLS.status),
      phase:        txt(cols, COLS.phase),
      platform:     txt(cols, COLS.platform),
      complexity:   txt(cols, COLS.complexity),
      kickoff_date: p.kickoff_date ?? txt(cols, COLS.kickoff_date),
      go_live_date: p.go_live_date ?? txt(cols, COLS.go_live_date),
      tam:          txt(cols, COLS.tam),
      dev:          txt(cols, COLS.dev),
      partner:      txt(cols, COLS.partner) ?? cust.partner,
      total_effort_days: p.total_effort_days,
      delivered_value:   p.delivered_value,
      ttv_days_text:     p.ttv_days_text,
      timeline_start:    p.timeline_start,
      timeline_end:      p.timeline_end,
      latest_update:     p.latest_update,
    });
  }

  // Build platform list from actual data, not just a hardcoded set.
  const FY_PRIORITY = ["active", "FY-2026", "FY-2025", "FY-2024", "FY-2023", "inactive"];
  const facets: DeliveryFilterFacets = {
    customers: dedup(rows.map((r) => r.customer_display_name)),
    aes:       dedup(rows.map((r) => r.ae_owner).filter((v): v is string => !!v)),
    partners:  dedup(rows.map((r) => r.partner).filter((v): v is string => !!v)),
    fiscal_years: Array.from(new Set(rows.map((r) => r.fiscal_year).filter((v): v is string => !!v)))
      .sort((a, b) => {
        const ai = FY_PRIORITY.indexOf(a); const bi = FY_PRIORITY.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1; if (bi >= 0) return 1;
        return a.localeCompare(b);
      }),
    statuses:  dedup(rows.map((r) => r.status).filter((v): v is string => !!v)),
    platforms: dedup(rows.map((r) => r.platform).filter((v): v is string => !!v)),
  };

  const totals = {
    total: rows.length,
    active_in_flight: rows.filter((r) => r.fiscal_year === "active").length,
    at_risk: rows.filter((r) => (r.health ?? "").toLowerCase().includes("risk")).length,
    delivered_all_time: rows.filter(isDelivered).length,
    delivered_this_quarter: rows.filter(
      (r) => isDelivered(r) && isCurrentQuarter(r.go_live_date)
    ).length,
  };

  return { projects: rows, facets, totals, last_sync: (lastSync.data as { finished_at: string | null } | null)?.finished_at ?? null };
}

function dedup(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort();
}
