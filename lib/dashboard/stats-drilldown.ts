// Loaders that back the Dashboard + Analytics clickable top stats.  Each
// function returns a slim list of items the drill-down panel can render.
// Past-state customers (Churned / Dropped / Past) are excluded from
// active-book aggregates — same rule the analytics + portfolio totals
// use.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import { categoryFromCustomer } from "@/app/_components/brand";
import {
  formatPersonName,
  isDelivered,
  unionPeopleColumns,
  legacyFieldsFromProcess,
} from "@/lib/delivery/taxonomy";
import { getConfirmedArrForCustomer } from "@/lib/commercials/confirmed-arr";
import { TABLES, npsCategory, type Process, type NpsResponse } from "@/lib/supabase/types";

const PAST_STATE_CATEGORIES = new Set(["Churned", "Dropped", "Past"]);

/**
 * Build a Map<customer_id → canonical FDE roster> across every process that
 * is *not* delivered/cancelled.  Used by the dashboard ARR drill-down, the
 * Customers page strips, and the dashboard Pipeline list to surface which
 * delivery team is working a customer right now.
 *
 * Each person is canonical-cased (e.g. "Shyam P. (PM)") and deduped per
 * customer.  Returns an empty Map if `processes` is empty — callers should
 * treat "no entry" as "no FDE on file" not as an error.
 */
export async function loadFdesByCustomerId(): Promise<Map<string, string[]>> {
  const sb = requireAdmin();
  const { data } = await sb.from(TABLES.processes).select("*");

  const out = new Map<string, Set<string>>();
  for (const p of (data as Process[] | null) ?? []) {
    if (!p.customer_id) continue;
    const legacy = legacyFieldsFromProcess(p);
    if (isDelivered(legacy.status, legacy.group_title)) continue;
    const merged = unionPeopleColumns(legacy.tam_text, legacy.dev_text);
    if (!merged) continue;
    const set = out.get(p.customer_id) ?? new Set<string>();
    for (const piece of merged.split(",")) {
      const name = formatPersonName(piece);
      if (name) set.add(name);
    }
    out.set(p.customer_id, set);
  }
  return new Map(
    Array.from(out.entries(), ([id, set]) => [id, Array.from(set).sort()])
  );
}

export interface ArrBreakdownRow {
  customer_key: string;
  customer_display_name: string;
  ae_owner: string | null;
  partner: string | null;
  category: string;
  /** Confirmed ARR: amount from the most recent Closed-Won SF opportunity
   *  whose close_date ≤ today.  $0 when no Closed-Won deal exists yet
   *  (e.g. POV / partner payment pending). */
  arr: number;
  renewal_date: string | null;
  /** Stage name of the opp that drove `arr`, e.g. "Closed Won".
   *  Useful for spotting "Closed Won - Pending Payment" partner deals. */
  arr_opp_stage: string | null;
  /** Canonical FDE roster across this customer's active projects.
   *  Empty array when no FDE is assigned. */
  fde: string[];
}

export async function loadArrBreakdown(): Promise<ArrBreakdownRow[]> {
  const sb = requireAdmin();
  const [customers, oppsRes, accounts, fdesByCustomer] = await Promise.all([
    listCustomers(),
    // Pull ALL SF opps — we need is_won, is_closed, amount, stage for the
    // confirmed-ARR derivation, and open ones for renewal_date.
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed, stage_name, probability"),
    sb.from("sf_accounts").select("customer_id, annual_revenue"),
    loadFdesByCustomerId().catch(() => new Map<string, string[]>()),
  ]);

  type OppRow = {
    customer_id: string;
    amount: number | null;
    close_date: string | null;
    is_won: boolean;
    is_closed: boolean;
    stage_name: string | null;
    probability: number | null;
  };
  const oppsByC = new Map<string, OppRow[]>();
  for (const o of (oppsRes.data as OppRow[] | null) ?? []) {
    const list = oppsByC.get(o.customer_id) ?? [];
    list.push(o);
    oppsByC.set(o.customer_id, list);
  }

  const revByC = new Map<string, number | null>();
  for (const a of (accounts.data as Array<{ customer_id: string; annual_revenue: number | null }> | null) ?? []) {
    revByC.set(a.customer_id, a.annual_revenue);
  }

  const rows: ArrBreakdownRow[] = [];
  for (const c of customers) {
    const opps = oppsByC.get(c.id) ?? [];
    const { arr, stage, renewal_date } = getConfirmedArrForCustomer(c.key, opps);

    const cat = categoryFromCustomer(c, {
      renewal_date,
      annual_revenue: revByC.get(c.id) ?? null,
    });
    if (PAST_STATE_CATEGORIES.has(cat)) continue;

    rows.push({
      customer_key: c.key,
      customer_display_name: c.display_name,
      ae_owner: c.ae_owner,
      partner: c.partner,
      category: cat,
      arr,
      renewal_date,
      arr_opp_stage: stage,
      fde: fdesByCustomer.get(c.id) ?? [],
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

/** Processes currently in flight — translated legacy status === "In Progress"
 *  (native lifecycle in_development / uat / discovery — see
 *  legacyFieldsFromProcess in lib/delivery/taxonomy.ts). `fiscal_year` is a
 *  fixed "active" string now — `processes` holds one row per process with no
 *  more historical per-FY-board snapshots, and only the old "active" board
 *  ever carried the literal "In Progress" status this filters on. */
export async function loadActiveProjects(): Promise<ActiveProjectRow[]> {
  const sb = requireAdmin();
  const [processesRes, customers] = await Promise.all([
    sb.from(TABLES.processes).select("*"),
    listCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  const rows: ActiveProjectRow[] = [];
  for (const p of (processesRes.data as Process[] | null) ?? []) {
    const legacy = legacyFieldsFromProcess(p);
    if (legacy.status !== "In Progress") continue;
    const cust = p.customer_id ? custById.get(p.customer_id) : undefined;
    rows.push({
      monday_item_id: legacy.id,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      name: legacy.name,
      status: legacy.status,
      health: legacy.health,
      phase: legacy.phase,
      fiscal_year: legacy.fiscal_year,
      group_title: legacy.group_title,
      go_live_date: legacy.go_live_date,
      kickoff_date: legacy.kickoff_date,
      fde: unionPeopleColumns(legacy.tam_text, legacy.dev_text),
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** All NPS responses. Sorted newest-first by quarter. */
export async function loadNpsResponses(): Promise<NpsResponseRow[]> {
  const sb = requireAdmin();
  const [nps, customers] = await Promise.all([
    sb.from(TABLES.npsResponses).select("*"),
    listCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  const rows: NpsResponseRow[] = [];
  for (const r of (nps.data as NpsResponse[] | null) ?? []) {
    const cust = custById.get(r.customer_id);
    rows.push({
      monday_item_id: r.id,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      respondent: r.respondent_name,
      score: r.score,
      category: capitalize(npsCategory(r.score)),
      quarter: r.quarter,
      feedback: r.feedback,
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
