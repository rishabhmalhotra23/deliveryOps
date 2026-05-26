// Portfolio-wide Delivery loader. Pulls all Monday project rows (all FY boards
// + active + inactive/cancelled) with their stored columns so the Delivery
// Analytics page has complete historical context for Q-on-Q.
//
// Source: monday_projects + customers caches. All 6 boards are now synced;
// the fiscal_year column identifies which board each row came from.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer } from "@/app/_components/brand";
import { MONDAY_PROJECT_COLS as COLS, colText, isDelivered as txIsDelivered, unionPeopleColumns, formatPersonName } from "@/lib/delivery/taxonomy";

type RawColumns = Record<string, { type: string; text: string | null; value: string | null }>;
function txt(cols: RawColumns, id: string): string | null {
  return colText(cols, id);
}

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
  /** Combined FDE roster — comma-separated union of Monday's delivery +
   *  engineering columns, deduped.  Replaces the old separate `tam` +
   *  `dev` fields as part of the "1 single flow" simplification. */
  fde: string | null;
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
  /** Individual FDE names (already canonical-cased) across all active projects. */
  fdes: string[];
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
  return txIsDelivered(p.status);
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

  // The Account Overview boards (per-customer workspaces) and the Projects
  // Portfolio board are *aggregate* surfaces — every project they list is
  // already on one of the FY delivery boards.  Including them here triples
  // the row count and pollutes every chart with placeholder "Active
  // Projects" rows that have empty status / phase / FDE fields.  We keep
  // them in the per-customer cache (used by /customers/[key]) but exclude
  // them from the portfolio-wide view.
  const PORTFOLIO_DUPE_FYS = new Set(["account_overview", "portfolio"]);

  const allRows: DeliveryProject[] = [];
  for (const p of (projects.data as ProjectRow[] | null) ?? []) {
    if (p.fiscal_year && PORTFOLIO_DUPE_FYS.has(p.fiscal_year)) continue;
    const cust = custById.get(p.customer_id);
    if (!cust) continue;
    const cols = p.raw_columns ?? {};
    allRows.push({
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
      fde:          unionPeopleColumns(txt(cols, COLS.tam), txt(cols, COLS.dev)),
      partner:      txt(cols, COLS.partner) ?? cust.partner,
      total_effort_days: p.total_effort_days,
      delivered_value:   p.delivered_value,
      ttv_days_text:     p.ttv_days_text,
      timeline_start:    p.timeline_start,
      timeline_end:      p.timeline_end,
      latest_update:     p.latest_update,
    });
  }

  // Even after dropping the AO + Portfolio boards a customer can have the
  // same project name on two FY boards (e.g. kicked off in FY-2025, went
  // live in FY-2026).  Dedupe by (customer_id, normalised name) so the
  // delivery view shows each project once, picking the row that carries
  // the most signal (richest data wins).
  const rows = dedupeByCustomerAndName(allRows);

  // Build platform list from actual data, not just a hardcoded set.
  const FY_PRIORITY = ["active", "FY-2026", "FY-2025", "FY-2024", "FY-2023", "inactive"];
  // FDE facet: every individual person across the (collapsed) fde field,
  // canonical-cased so "shyam" and "Shyam Prabhakara" both become
  // "Shyam P. (PM)" — the same string the UI displays.
  const fdeSet = new Set<string>();
  for (const r of rows) {
    if (!r.fde) continue;
    for (const piece of r.fde.split(",")) {
      const name = formatPersonName(piece);
      if (name) fdeSet.add(name);
    }
  }
  const facets: DeliveryFilterFacets = {
    customers: dedup(rows.map((r) => r.customer_display_name)),
    aes:       dedup(rows.map((r) => r.ae_owner).filter((v): v is string => !!v)),
    fdes:      Array.from(fdeSet).sort(),
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

// Normalise a project name for dedup: lowercase, strip the customer prefix
// ("Acme — Project Foo" → "project foo"), collapse whitespace.  Keeps the
// dedup key resilient to formatting differences between FY boards (Monday
// users sometimes prefix on one board and not on another).
function normaliseProjectName(name: string, customerName: string): string {
  const stripped = name.replace(
    new RegExp(`^${customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-—:|]+\\s*`, "i"),
    ""
  );
  return stripped.toLowerCase().replace(/\s+/g, " ").trim();
}

// "Information score" — higher is better.  Used when collapsing duplicates
// so the row with the richest data wins (and we don't accidentally pick a
// placeholder row over a real one).
function infoScore(p: DeliveryProject): number {
  let s = 0;
  if (p.status) s += 4;
  if (p.go_live_date) s += 3;
  if (p.phase) s += 2;
  if (p.kickoff_date) s += 2;
  if (p.health) s += 1;
  if (p.platform) s += 1;
  if (p.fde) s += 1;
  if (p.total_effort_days != null) s += 1;
  if (p.latest_update) s += 1;
  // "active" board rows are the live source of truth, beat all FY history.
  if (p.fiscal_year === "active") s += 5;
  return s;
}


function dedupeByCustomerAndName(rows: DeliveryProject[]): DeliveryProject[] {
  const byKey = new Map<string, DeliveryProject>();
  for (const r of rows) {
    const key = `${r.customer_key}::${normaliseProjectName(r.name, r.customer_display_name)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, r);
      continue;
    }
    // Same project across two boards — keep whichever carries more signal.
    // On a tie, prefer the more recently updated Monday item.
    const next = infoScore(r);
    const prev = infoScore(existing);
    if (next > prev) byKey.set(key, r);
    else if (next === prev) {
      const nu = r.monday_updated_at ?? "";
      const pu = existing.monday_updated_at ?? "";
      if (nu > pu) byKey.set(key, r);
    }
  }
  return Array.from(byKey.values());
}
