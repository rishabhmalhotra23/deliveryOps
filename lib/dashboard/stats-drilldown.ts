// Loaders that back the Dashboard + Analytics clickable top stats.  Each
// function returns a slim list of items the drill-down panel can render.
// Past-state customers (Churned / Dropped / Past) are excluded from
// active-book aggregates — same rule the analytics + portfolio totals
// use.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import { categoryFromCustomer } from "@/app/_components/brand";
import { MONDAY_PROJECT_COLS, MONDAY_NPS_COLS, colText, unionPeopleColumns } from "@/lib/delivery/taxonomy";

const PAST_STATE_CATEGORIES = new Set(["Churned", "Dropped", "Past"]);

export interface ArrBreakdownRow {
  customer_key: string;
  customer_display_name: string;
  ae_owner: string | null;
  partner: string | null;
  category: string;
  arr: number;
  renewal_date: string | null;
}

export async function loadArrBreakdown(): Promise<ArrBreakdownRow[]> {
  const sb = requireAdmin();
  const [customers, profiles, accounts] = await Promise.all([
    listCustomers(),
    sb.from("profiles").select("customer_id, arr, renewal_date"),
    sb.from("sf_accounts").select("customer_id, annual_revenue"),
  ]);
  const arrByC = new Map<string, { arr: number; renewal_date: string | null }>();
  for (const p of (profiles.data as Array<{ customer_id: string; arr: number | null; renewal_date: string | null }> | null) ?? []) {
    arrByC.set(p.customer_id, { arr: p.arr ?? 0, renewal_date: p.renewal_date });
  }
  const revByC = new Map<string, number | null>();
  for (const a of (accounts.data as Array<{ customer_id: string; annual_revenue: number | null }> | null) ?? []) {
    revByC.set(a.customer_id, a.annual_revenue);
  }
  const rows: ArrBreakdownRow[] = [];
  for (const c of customers) {
    const cat = categoryFromCustomer(c, {
      renewal_date: arrByC.get(c.id)?.renewal_date,
      annual_revenue: revByC.get(c.id) ?? null,
    });
    if (PAST_STATE_CATEGORIES.has(cat)) continue;
    const profile = arrByC.get(c.id);
    rows.push({
      customer_key: c.key,
      customer_display_name: c.display_name,
      ae_owner: c.ae_owner,
      partner: c.partner,
      category: cat,
      arr: profile?.arr ?? 0,
      renewal_date: profile?.renewal_date ?? null,
    });
  }
  return rows.sort((a, b) => b.arr - a.arr);
}

/** Customers in the "needs attention" buckets — At Risk + Upcoming Renewals.
 *  Accepts a pre-fetched ARR breakdown so the dashboard can derive both
 *  drill-downs from one round-trip instead of two. */
export function filterNeedAttention(arrRows: ArrBreakdownRow[]): ArrBreakdownRow[] {
  return arrRows.filter((r) => r.category === "At Risk" || r.category === "Upcoming Renewals");
}

/** @deprecated Use filterNeedAttention(arrRows) instead — this redundantly
 *  re-runs the ARR breakdown query.  Kept for legacy callers; will be
 *  removed once they're migrated. */
export async function loadNeedAttention(): Promise<ArrBreakdownRow[]> {
  const all = await loadArrBreakdown();
  return filterNeedAttention(all);
}

export interface OpenOpportunityRow {
  sf_id: string;
  customer_key: string | null;
  customer_display_name: string | null;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  owner_name: string | null;
}

export async function loadOpenOpportunities(): Promise<OpenOpportunityRow[]> {
  const sb = requireAdmin();
  const [opps, customers] = await Promise.all([
    sb
      .from("sf_opportunities")
      .select("sf_id, customer_id, name, stage_name, amount, close_date, probability, owner_name")
      .eq("is_closed", false)
      .order("amount", { ascending: false }),
    listCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  const rows: OpenOpportunityRow[] = [];
  for (const o of (opps.data as Array<{
    sf_id: string;
    customer_id: string;
    name: string;
    stage_name: string | null;
    amount: number | null;
    close_date: string | null;
    probability: number | null;
    owner_name: string | null;
  }> | null) ?? []) {
    const cust = custById.get(o.customer_id);
    rows.push({
      sf_id: o.sf_id,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      name: o.name,
      stage_name: o.stage_name,
      amount: o.amount,
      close_date: o.close_date,
      probability: o.probability,
      owner_name: o.owner_name,
    });
  }
  return rows;
}

export interface OpenCaseRow {
  sf_id: string;
  customer_key: string | null;
  customer_display_name: string | null;
  case_number: string | null;
  subject: string | null;
  status: string | null;
  priority: string | null;
  origin: string | null;
}

export async function loadOpenCases(): Promise<OpenCaseRow[]> {
  const sb = requireAdmin();
  const [cases, customers] = await Promise.all([
    sb
      .from("sf_cases")
      .select("sf_id, customer_id, case_number, subject, status, priority, origin")
      .eq("is_closed", false),
    listCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  const rows: OpenCaseRow[] = [];
  for (const c of (cases.data as Array<{
    sf_id: string;
    customer_id: string;
    case_number: string | null;
    subject: string | null;
    status: string | null;
    priority: string | null;
    origin: string | null;
  }> | null) ?? []) {
    const cust = custById.get(c.customer_id);
    rows.push({
      sf_id: c.sf_id,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      case_number: c.case_number,
      subject: c.subject,
      status: c.status,
      priority: c.priority,
      origin: c.origin,
    });
  }
  return rows;
}

// ─── Analytics drill-downs ──────────────────────────────────────────

export interface ActiveProjectRow {
  monday_item_id: string;
  customer_key: string | null;
  customer_display_name: string | null;
  name: string;
  status: string | null;
  health: string | null;
  phase: string | null;
  fiscal_year: string | null;
  group_title: string | null;
  go_live_date: string | null;
  kickoff_date: string | null;
  /** Combined FDE roster — comma-separated union of Monday's delivery +
   *  engineering columns, deduped.  Replaces the old separate `tam` +
   *  `dev` fields. */
  fde: string | null;
}

/** Projects currently in flight — status === "In Progress". */
export async function loadActiveProjects(): Promise<ActiveProjectRow[]> {
  const sb = requireAdmin();
  const [projects, customers] = await Promise.all([
    sb
      .from("monday_projects")
      .select(
        "monday_item_id, customer_id, name, fiscal_year, group_title, " +
          "raw_columns, go_live_date, kickoff_date"
      ),
    listCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  const rows: ActiveProjectRow[] = [];
  type ProjRow = {
    monday_item_id: string;
    customer_id: string;
    name: string;
    fiscal_year: string | null;
    group_title: string | null;
    raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
    go_live_date: string | null;
    kickoff_date: string | null;
  };
  // Same fiscal-year exclusions as the delivery loader so the count
  // matches what /delivery shows.
  const PORTFOLIO_DUPE_FYS = new Set(["account_overview", "portfolio"]);
  for (const p of (projects.data as unknown as ProjRow[] | null) ?? []) {
    if (p.fiscal_year && PORTFOLIO_DUPE_FYS.has(p.fiscal_year)) continue;
    const cols = p.raw_columns ?? {};
    const status = colText(cols, MONDAY_PROJECT_COLS.status);
    if (status !== "In Progress") continue;
    const cust = custById.get(p.customer_id);
    rows.push({
      monday_item_id: p.monday_item_id,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      name: p.name,
      status,
      health: colText(cols, MONDAY_PROJECT_COLS.health),
      phase: colText(cols, MONDAY_PROJECT_COLS.phase),
      fiscal_year: p.fiscal_year,
      group_title: p.group_title,
      go_live_date: p.go_live_date ?? colText(cols, MONDAY_PROJECT_COLS.go_live_date),
      kickoff_date: p.kickoff_date ?? colText(cols, MONDAY_PROJECT_COLS.kickoff_date),
      fde: unionPeopleColumns(
        colText(cols, MONDAY_PROJECT_COLS.tam),
        colText(cols, MONDAY_PROJECT_COLS.dev),
      ),
    });
  }
  return rows;
}

export interface NpsResponseRow {
  monday_item_id: string;
  customer_key: string | null;
  customer_display_name: string | null;
  respondent: string;
  score: number | null;
  category: string | null;
  quarter: string | null;
  feedback: string | null;
}

/** All NPS responses with a numeric score. Sorted newest-first by quarter. */
export async function loadNpsResponses(): Promise<NpsResponseRow[]> {
  const sb = requireAdmin();
  const [nps, customers] = await Promise.all([
    sb
      .from("monday_nps_responses")
      .select("monday_item_id, customer_id, name, raw_columns"),
    listCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  type NpsRow = {
    monday_item_id: string;
    customer_id: string;
    name: string;
    raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
  };
  const rows: NpsResponseRow[] = [];
  for (const r of (nps.data as unknown as NpsRow[] | null) ?? []) {
    const cols = r.raw_columns ?? {};
    const scoreText = colText(cols, MONDAY_NPS_COLS.score);
    const score = scoreText != null ? Number(scoreText) : null;
    if (score == null || !Number.isFinite(score)) continue;
    const cust = custById.get(r.customer_id);
    rows.push({
      monday_item_id: r.monday_item_id,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      respondent: r.name,
      score,
      category: colText(cols, MONDAY_NPS_COLS.category),
      quarter: colText(cols, MONDAY_NPS_COLS.quarter),
      // Feedback column id is captured separately by the analytics
      // loader; for the drill-down we just expose the score + category.
      feedback: colText(cols, "long_text_mm0aq08p"),
    });
  }
  // Sort: newest quarter first (4Q26 > 3Q26 > 2Q26 > 1Q26 > 4Q25...)
  return rows.sort((a, b) => {
    const parse = (s: string | null) => {
      if (!s) return 0;
      const m = /^(\d)Q(\d{2})$/.exec(s);
      return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
    };
    return parse(b.quarter) - parse(a.quarter);
  });
}
