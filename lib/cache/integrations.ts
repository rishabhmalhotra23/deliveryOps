// Cache readers — UI pulls from these instead of hitting Salesforce / Monday
// directly on every page load. The sync runner refreshes the underlying
// tables on a weekly cron (in production) or on demand via /api/dev/sync/run.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer as brandCategoryFromCustomer } from "@/app/_components/brand";

export interface SfAccountCache {
  sf_id: string;
  name: string;
  industry: string | null;
  type: string | null;
  annual_revenue: number | null;
  number_of_employees: number | null;
  website: string | null;
  phone: string | null;
  billing_city: string | null;
  billing_country: string | null;
  owner_name: string | null;
  sf_updated_at: string | null;
  synced_at: string;
}

export interface SfOpportunityCache {
  sf_id: string;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  is_closed: boolean;
  is_won: boolean;
  owner_name: string | null;
  sf_updated_at: string | null;
}

export interface SfCaseCache {
  sf_id: string;
  case_number: string | null;
  subject: string | null;
  status: string | null;
  priority: string | null;
  origin: string | null;
  is_closed: boolean;
  sf_created_at: string | null;
  sf_updated_at: string | null;
}

export interface MondayProjectCache {
  monday_item_id: string;
  name: string;
  group_title: string | null;
  state: string | null;
  monday_updated_at: string | null;
  // Lifted from raw_columns or stored directly (migration 0010+)
  fiscal_year: string | null;
  board_name: string | null;
  health: string | null;
  project_status: string | null;
  current_phase: string | null;
  dev_platform: string | null;
  complexity: string | null;
  kickoff_date: string | null;
  go_live_date: string | null;
  timeline_start: string | null;
  timeline_end: string | null;
  partner: string | null;
  /** Combined FDE roster — comma-separated union of Monday's delivery +
   *  engineering columns, deduped.  Replaces the old `tam` + `dev`
   *  fields as part of the "1 single flow" simplification. */
  fde: string | null;
  total_effort_days: number | null;
  delivered_value: string | null;
  ttv_days_text: string | null;
  latest_update: string | null;
}

export interface MondayActivityCache {
  monday_item_id: string;
  name: string;
  group_title: string | null;
  state: string | null;
  monday_updated_at: string | null;
  // Lifted from raw_columns for sorting/filtering in the UI
  priority: string | null;
  status: string | null;
  due_date: string | null;
  created_date: string | null;
  resolved_date: string | null;
  ai_summary: string | null;
  source_link: string | null;
  meeting_excerpt: string | null;
}

export interface MondayNpsCache {
  monday_item_id: string;
  respondent: string;
  group_title: string | null;
  quarter: string | null;
  score: number | null;
  category: string | null;
  response_date: string | null;
  feedback: string | null;
  respondent_type: string | null;
  product_satisfaction: string | null;
}

export interface CustomerEnrichment {
  account: SfAccountCache | null;
  opportunities: SfOpportunityCache[];
  cases: SfCaseCache[];
  projects: MondayProjectCache[];
  activities: MondayActivityCache[];
  nps: MondayNpsCache[];
  freshness: {
    salesforce_synced_at: string | null;
    monday_synced_at: string | null;
  };
}

// Monday Activity Log column IDs for lifting fields out of raw_columns.
// Captured from the live board on 2026-04-30; if the columns are renamed
// in Monday these stay valid (column IDs are stable).
const ACTIVITY_COLS = {
  priority: "color_mm01d100",
  status: "color_mm01fb9d",
  due_date: "date_mm01r1zn",
  created_date: "date_mm01bkxq",
  resolved_date: "date_mm01vncb",
  ai_summary: "text_mm01867a",
  source_link: "link_mm01egt",
  raw_content: "long_text_mm016mph",
};

const NPS_COLS = {
  quarter: "dropdown_mm0ahec7",
  response_date: "date_mm0acgpg",
  score: "numeric_mm0aqvk3",
  category: "color_mm0af90g",
  feedback: "long_text_mm0aq08p",
  respondent_type: "color_mm0axaxp",
  product_satisfaction: "color_mm0amv8q",
};

// Monday Projects board column IDs come from lib/delivery/taxonomy.ts.
// Aliases below match this module's pre-existing field names so call sites
// keep working without churn.
import { MONDAY_PROJECT_COLS, unionPeopleColumns } from "@/lib/delivery/taxonomy";

const PROJECT_COLS = {
  health:         MONDAY_PROJECT_COLS.health,
  project_status: MONDAY_PROJECT_COLS.status,
  current_phase:  MONDAY_PROJECT_COLS.phase,
  dev_platform:   MONDAY_PROJECT_COLS.platform,
  complexity:     MONDAY_PROJECT_COLS.complexity,
  kickoff_date:   MONDAY_PROJECT_COLS.kickoff_date,
  go_live_date:   MONDAY_PROJECT_COLS.go_live_date,
  partner:        MONDAY_PROJECT_COLS.partner,
  // Monday still exposes two separate people-columns (delivery + engineering);
  // we union them into a single "fde" field downstream.
  tam:            MONDAY_PROJECT_COLS.tam,
  dev:            MONDAY_PROJECT_COLS.dev,
};

interface RawColumns {
  [columnId: string]: { type: string; text: string | null; value: string | null } | undefined;
}

function txt(cols: RawColumns | null | undefined, id: string): string | null {
  return cols?.[id]?.text?.trim() || null;
}

export async function loadCustomerEnrichment(customerId: string): Promise<CustomerEnrichment> {
  const sb = requireAdmin();

  const [acc, opps, cases, projects, activities, nps] = await Promise.all([
    sb.from("sf_accounts").select("*").eq("customer_id", customerId).maybeSingle(),
    sb
      .from("sf_opportunities")
      .select("*")
      .eq("customer_id", customerId)
      .order("close_date", { ascending: false })
      .limit(50),
    sb
      .from("sf_cases")
      .select("*")
      .eq("customer_id", customerId)
      .order("sf_created_at", { ascending: false })
      .limit(50),
    // Pull ALL projects (no fiscal_year filter) so historical + active
    // all appear on the customer page. Order by go_live_date (stored col) desc.
    sb
      .from("monday_projects")
      .select(
        "monday_item_id, name, group_title, state, monday_updated_at, " +
        "fiscal_year, board_name, raw_columns, " +
        "go_live_date, kickoff_date, " +
        "total_effort_days, delivered_value, ttv_days_text, " +
        "timeline_start, timeline_end, latest_update"
      )
      .eq("customer_id", customerId)
      .order("go_live_date", { ascending: false, nullsFirst: false })
      .limit(500),
    sb
      .from("monday_activities")
      .select("*")
      .eq("customer_id", customerId)
      .order("monday_updated_at", { ascending: false })
      .limit(100),
    sb
      .from("monday_nps_responses")
      .select("*")
      .eq("customer_id", customerId)
      .order("monday_updated_at", { ascending: false })
      .limit(50),
  ]);

  type ProjectRow = {
    monday_item_id: string;
    name: string;
    group_title: string | null;
    state: string | null;
    monday_updated_at: string | null;
    fiscal_year: string | null;
    board_name: string | null;
    raw_columns: RawColumns;
    go_live_date: string | null;
    kickoff_date: string | null;
    total_effort_days: number | null;
    delivered_value: string | null;
    ttv_days_text: string | null;
    timeline_start: string | null;
    timeline_end: string | null;
    latest_update: string | null;
  };
  const projectCache: MondayProjectCache[] = (
    (projects.data as ProjectRow[] | null) ?? []
  ).map((p) => {
    const cols = p.raw_columns ?? {};
    return {
      monday_item_id: p.monday_item_id,
      name: p.name,
      group_title: p.group_title,
      state: p.state,
      monday_updated_at: p.monday_updated_at,
      fiscal_year: p.fiscal_year,
      board_name: p.board_name,
      health:          txt(cols, PROJECT_COLS.health),
      project_status:  txt(cols, PROJECT_COLS.project_status),
      current_phase:   txt(cols, PROJECT_COLS.current_phase),
      dev_platform:    txt(cols, PROJECT_COLS.dev_platform),
      complexity:      txt(cols, PROJECT_COLS.complexity),
      // Use stored columns (migration 0012) for dates so they sort correctly.
      go_live_date:    p.go_live_date ?? txt(cols, PROJECT_COLS.go_live_date),
      kickoff_date:    p.kickoff_date ?? txt(cols, PROJECT_COLS.kickoff_date),
      partner:         txt(cols, PROJECT_COLS.partner),
      fde:             unionPeopleColumns(txt(cols, PROJECT_COLS.tam), txt(cols, PROJECT_COLS.dev)),
      total_effort_days: p.total_effort_days,
      delivered_value: p.delivered_value,
      ttv_days_text:   p.ttv_days_text,
      timeline_start:  p.timeline_start,
      timeline_end:    p.timeline_end,
      latest_update:   p.latest_update,
    };
  });

  type ActivityRow = {
    monday_item_id: string;
    name: string;
    group_title: string | null;
    state: string | null;
    monday_updated_at: string | null;
    raw_columns: RawColumns;
  };
  const activityCache: MondayActivityCache[] = (
    (activities.data as ActivityRow[] | null) ?? []
  ).map((a) => {
    const cols = a.raw_columns ?? {};
    const raw = txt(cols, ACTIVITY_COLS.raw_content);
    // Pull 280 chars of meeting context, stripped of the redundant
    // "Customer: X / Meeting: Y / Owner: Z" header that prefixes Fireflies
    // output.
    let excerpt: string | null = null;
    if (raw) {
      const stripped = raw.replace(/^(?:customer:|meeting:|owner:).*$/gim, "").trim();
      excerpt = stripped.length > 280 ? stripped.slice(0, 280) + "…" : stripped;
    }
    return {
      monday_item_id: a.monday_item_id,
      name: a.name,
      group_title: a.group_title,
      state: a.state,
      monday_updated_at: a.monday_updated_at,
      priority: txt(cols, ACTIVITY_COLS.priority),
      status: txt(cols, ACTIVITY_COLS.status),
      due_date: txt(cols, ACTIVITY_COLS.due_date),
      created_date: txt(cols, ACTIVITY_COLS.created_date),
      resolved_date: txt(cols, ACTIVITY_COLS.resolved_date),
      ai_summary: txt(cols, ACTIVITY_COLS.ai_summary),
      source_link: txt(cols, ACTIVITY_COLS.source_link),
      meeting_excerpt: excerpt,
    };
  });

  type NpsRow = {
    monday_item_id: string;
    name: string;
    group_title: string | null;
    raw_columns: RawColumns;
  };
  const npsCache: MondayNpsCache[] = ((nps.data as NpsRow[] | null) ?? []).map((n) => {
    const cols = n.raw_columns ?? {};
    const scoreText = txt(cols, NPS_COLS.score);
    return {
      monday_item_id: n.monday_item_id,
      respondent: n.name,
      group_title: n.group_title,
      quarter: txt(cols, NPS_COLS.quarter),
      score: scoreText ? Number(scoreText) : null,
      category: txt(cols, NPS_COLS.category),
      response_date: txt(cols, NPS_COLS.response_date),
      feedback: txt(cols, NPS_COLS.feedback),
      respondent_type: txt(cols, NPS_COLS.respondent_type),
      product_satisfaction: txt(cols, NPS_COLS.product_satisfaction),
    };
  });

  // (projectCache is built above in the projects section of Promise.all)

  return {
    account: (acc.data as SfAccountCache | null) ?? null,
    opportunities: (opps.data as SfOpportunityCache[] | null) ?? [],
    cases: (cases.data as SfCaseCache[] | null) ?? [],
    projects: projectCache,
    activities: activityCache,
    nps: npsCache,
    freshness: {
      salesforce_synced_at: (acc.data as SfAccountCache | null)?.synced_at ?? null,
      monday_synced_at:
        (projects.data as Array<{ synced_at: string }> | null)?.[0]?.synced_at ?? null,
    },
  };
}

export interface PortfolioSummary {
  total: number;
  by_category: Record<string, number>;
  by_ae: Record<string, number>;
  by_partner: Record<string, number>;
  // total_arr = sum of profiles.arr across all customers (Kognitos deal ARR).
  // NOT sum of sf_accounts.annual_revenue — that's the customer's company-wide
  // revenue, which is meaningless to aggregate and was producing $billions.
  total_arr: number;
  total_company_revenue: number;
  total_open_opportunities: number;
  total_open_cases: number;
  with_salesforce: number;
  with_monday_workspace: number;
  last_sync: { salesforce: string | null; monday: string | null };
}

export async function loadPortfolioSummary(): Promise<PortfolioSummary> {
  const sb = requireAdmin();

  const { data: customers } = await sb
    .from("customers")
    .select("id, custom_category, lifecycle_group, partner, ae_owner, salesforce_account_id, monday_workspace_id")
    .is("deleted_at", null);
  const list = (customers ?? []) as Array<{
    id: string;
    custom_category: string | null;
    lifecycle_group: string | null;
    partner: string | null;
    ae_owner: string | null;
    salesforce_account_id: string | null;
    monday_workspace_id: string | null;
  }>;

  // Pull profiles + accounts so the category distribution reflects the
  // dynamic rules (renewal-in-90-days → Upcoming Renewals, revenue>$20M →
  // Strategic Growth).  Without these the dashboard chip counts would
  // diverge from what /customers shows.
  const [arr, accountsForCat, opps, cases, lastSf, lastMon, profilesForCat] = await Promise.all([
    // Pull customer_id alongside ARR so we can filter past-state customers
    // out of total_arr.
    sb.from("profiles").select("customer_id, arr"),
    sb.from("sf_accounts").select("customer_id, annual_revenue"),
    sb.from("sf_opportunities").select("id", { count: "exact", head: true }).eq("is_closed", false),
    sb.from("sf_cases").select("id", { count: "exact", head: true }).eq("is_closed", false),
    sb.from("sync_runs").select("finished_at").eq("source", "salesforce").eq("status", "ok").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("sync_runs").select("finished_at").eq("source", "monday").eq("status", "ok").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("profiles").select("customer_id, renewal_date"),
  ]);

  const renewalByC = new Map<string, string | null>();
  for (const p of (profilesForCat.data as Array<{ customer_id: string; renewal_date: string | null }> | null) ?? []) {
    renewalByC.set(p.customer_id, p.renewal_date);
  }
  const revenueByC = new Map<string, number | null>();
  for (const a of (accountsForCat.data as Array<{ customer_id: string; annual_revenue: number | null }> | null) ?? []) {
    revenueByC.set(a.customer_id, a.annual_revenue);
  }

  // Past-state customers (Churned / Dropped / Past) are excluded from the
  // active-book aggregates (total_arr, total_company_revenue, by_ae,
  // by_partner, total customer count).  The `by_category` chip strip keeps
  // them so the user can still see the breakdown of the entire portfolio
  // composition.
  const PAST_STATE_CATEGORIES = new Set(["Churned", "Dropped", "Past"]);
  const byCategory: Record<string, number> = {};
  const byAe: Record<string, number> = {};
  const byPartner: Record<string, number> = {};
  const activeIds = new Set<string>();
  for (const c of list) {
    const cat = brandCategoryFromCustomer(c, {
      renewal_date: renewalByC.get(c.id) ?? null,
      annual_revenue: revenueByC.get(c.id) ?? null,
    });
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (PAST_STATE_CATEGORIES.has(cat)) continue;
    activeIds.add(c.id);
    const ae = c.ae_owner ?? "(unassigned)";
    byAe[ae] = (byAe[ae] ?? 0) + 1;
    const p = c.partner ?? "Direct";
    byPartner[p] = (byPartner[p] ?? 0) + 1;
  }
  const activeCount = activeIds.size;
  // Sum ARR only over active customers — past-state rows contribute zero.
  const arrRows = (arr.data as Array<{ customer_id: string; arr: number | null }> | null) ?? [];
  let totalArr = 0;
  for (const row of arrRows) {
    if (activeIds.has(row.customer_id)) totalArr += row.arr ?? 0;
  }
  let totalCompanyRevenue = 0;
  for (const [id, v] of revenueByC) {
    if (activeIds.has(id)) totalCompanyRevenue += v ?? 0;
  }

  return {
    total: activeCount,
    by_category: byCategory,
    by_ae: byAe,
    by_partner: byPartner,
    total_arr: totalArr,
    total_company_revenue: totalCompanyRevenue,
    total_open_opportunities: opps.count ?? 0,
    total_open_cases: cases.count ?? 0,
    with_salesforce: list.filter((c) => c.salesforce_account_id).length,
    with_monday_workspace: list.filter((c) => c.monday_workspace_id).length,
    last_sync: {
      salesforce: (lastSf.data as { finished_at: string } | null)?.finished_at ?? null,
      monday: (lastMon.data as { finished_at: string } | null)?.finished_at ?? null,
    },
  };
}

/** Per-customer commercial summary used by the customers list strips +
 *  the dynamic category derivation (see `categoryFromCustomer`).
 *
 *  - `arr` and `renewal_date` come from `profiles` (the Kognitos deal facts).
 *  - `annual_revenue` comes from `sf_accounts` (the customer's company-
 *    wide revenue per Salesforce) — used to bucket large customers into
 *    "Strategic Growth".
 */
export interface CustomerCommercials {
  arr: number | null;
  renewal_date: string | null;
  annual_revenue: number | null;
}

/**
 * Bulk-load ARR + renewal date + company revenue for every customer.
 * Two parallel round-trips (profiles + sf_accounts); consumers look up
 * by customer_id.
 */
export async function loadCustomerCommercialsMap(): Promise<
  Map<string, CustomerCommercials>
> {
  const sb = requireAdmin();
  const [profilesRes, accountsRes] = await Promise.all([
    sb.from("profiles").select("customer_id, arr, renewal_date"),
    sb.from("sf_accounts").select("customer_id, annual_revenue"),
  ]);
  const profiles = (profilesRes.data ?? []) as Array<{
    customer_id: string;
    arr: number | null;
    renewal_date: string | null;
  }>;
  const accounts = (accountsRes.data ?? []) as Array<{
    customer_id: string;
    annual_revenue: number | null;
  }>;

  const map = new Map<string, CustomerCommercials>();
  for (const row of profiles) {
    map.set(row.customer_id, {
      arr: row.arr,
      renewal_date: row.renewal_date,
      annual_revenue: null,
    });
  }
  for (const row of accounts) {
    const prev = map.get(row.customer_id);
    if (prev) {
      prev.annual_revenue = row.annual_revenue;
    } else {
      // SF account exists but no profile row yet — keep the revenue so the
      // category rule still fires.
      map.set(row.customer_id, {
        arr: null,
        renewal_date: null,
        annual_revenue: row.annual_revenue,
      });
    }
  }
  return map;
}

// Bulk lookup of Salesforce-derived domains keyed by customer_id. Used by the
// customers list and dashboard to feed the logo fallback (Clearbit / favicon
// services). One round-trip; the client component handles per-row rendering.
export async function loadCustomerDomainMap(): Promise<Map<string, string | null>> {
  const sb = requireAdmin();
  const { data } = await sb
    .from("sf_accounts")
    .select("customer_id, website")
    .not("website", "is", null);
  const rows = (data ?? []) as Array<{ customer_id: string; website: string | null }>;
  const map = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.website) continue;
    try {
      const u = new URL(row.website.startsWith("http") ? row.website : `https://${row.website}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host && host.includes(".")) map.set(row.customer_id, host);
    } catch {
      // Ignore malformed websites — they fall through to the email/key
      // heuristics in `deriveCustomerDomain`.
    }
  }
  return map;
}
