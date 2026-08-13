// Portfolio-wide Delivery loader, used only by the agent's `find_projects` /
// `summarize_portfolio` tools (lib/agent/operations.ts) — the /delivery page
// itself reads lib/processes/loader.ts directly.
//
// Source: `processes` + customers, translated to the legacy Monday string
// vocabulary via legacyFieldsFromProcess (see lib/delivery/taxonomy.ts) so
// this loader's shape — and the agent tools built on it — didn't need to
// change when Monday was retired.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer } from "@/app/_components/brand";
import { isDelivered as txIsDelivered, unionPeopleColumns, formatPersonName, legacyFieldsFromProcess } from "@/lib/delivery/taxonomy";
import { TABLES, type Process } from "@/lib/supabase/types";

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

  const [processesRes, customers] = await Promise.all([
    sb.from(TABLES.processes).select("*").order("go_live_date", { ascending: false, nullsFirst: false }),
    sb
      .from("customers")
      .select("id, key, display_name, ae_owner, partner, custom_category, lifecycle_group")
      .is("deleted_at", null),
  ]);

  const custById = new Map<string, CustomerRow>();
  for (const c of (customers.data as CustomerRow[] | null) ?? []) {
    custById.set(c.id, c);
  }

  const allRows: DeliveryProject[] = [];
  for (const p of (processesRes.data as Process[] | null) ?? []) {
    const cust = p.customer_id ? custById.get(p.customer_id) : undefined;
    if (!cust) continue;
    const legacy = legacyFieldsFromProcess(p);
    allRows.push({
      monday_item_id: legacy.id,
      name: legacy.name,
      customer_key: cust.key,
      customer_display_name: cust.display_name,
      customer_category: categoryFromCustomer({
        custom_category: cust.custom_category,
        lifecycle_group: cust.lifecycle_group,
      }),
      ae_owner: cust.ae_owner,
      fiscal_year: legacy.fiscal_year,
      board_name: null,
      group_title: legacy.group_title,
      state: null,
      monday_updated_at: p.updated_at,
      health:       legacy.health,
      status:       legacy.status,
      phase:        legacy.phase,
      platform:     legacy.platform,
      complexity:   legacy.complexity,
      kickoff_date: legacy.kickoff_date,
      go_live_date: legacy.go_live_date,
      fde:          unionPeopleColumns(legacy.tam_text, legacy.dev_text),
      partner:      p.partner ?? cust.partner,
      // No native equivalent for total_effort_days/delivered_value/
      // timeline_start/timeline_end/latest_update — see the equivalent note
      // in lib/cache/integrations.ts.
      total_effort_days: p.total_effort_hours != null ? Math.round(p.total_effort_hours) : null,
      delivered_value:   null,
      ttv_days_text:     legacy.ttv_days != null ? String(legacy.ttv_days) : null,
      timeline_start:    null,
      timeline_end:      null,
      latest_update:     null,
    });
  }

  // `processes` holds one row per process — no more per-FY-board duplication
  // to dedupe. Kept as a no-op safety net in case a real duplicate slips in
  // (e.g. two rows with the same customer + name from a bad import).
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

  return { projects: rows, facets, totals };
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
