// Cache readers — UI pulls from these instead of hitting Salesforce / Monday
// directly on every page load. The sync runner refreshes the underlying
// tables on a weekly cron (in production) or on demand via /api/dev/sync/run.

import { requireAdmin } from "@/lib/supabase/server";

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
    sb
      .from("monday_projects")
      .select("*")
      .eq("customer_id", customerId)
      .order("monday_updated_at", { ascending: false })
      .limit(50),
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

  return {
    account: (acc.data as SfAccountCache | null) ?? null,
    opportunities: (opps.data as SfOpportunityCache[] | null) ?? [],
    cases: (cases.data as SfCaseCache[] | null) ?? [],
    projects: (projects.data as MondayProjectCache[] | null) ?? [],
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
  total_arr: number;
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

  const byCategory: Record<string, number> = {};
  const byAe: Record<string, number> = {};
  const byPartner: Record<string, number> = {};
  for (const c of list) {
    const cat = c.custom_category ?? "Active";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    const ae = c.ae_owner ?? "(unassigned)";
    byAe[ae] = (byAe[ae] ?? 0) + 1;
    const p = c.partner ?? "Direct";
    byPartner[p] = (byPartner[p] ?? 0) + 1;
  }

  const [arr, opps, cases, lastSf, lastMon] = await Promise.all([
    sb.from("sf_accounts").select("annual_revenue"),
    sb.from("sf_opportunities").select("id", { count: "exact", head: true }).eq("is_closed", false),
    sb.from("sf_cases").select("id", { count: "exact", head: true }).eq("is_closed", false),
    sb.from("sync_runs").select("finished_at").eq("source", "salesforce").eq("status", "ok").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("sync_runs").select("finished_at").eq("source", "monday").eq("status", "ok").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const totalArr =
    ((arr.data as Array<{ annual_revenue: number | null }> | null) ?? []).reduce(
      (sum, a) => sum + (a.annual_revenue ?? 0),
      0
    );

  return {
    total: list.length,
    by_category: byCategory,
    by_ae: byAe,
    by_partner: byPartner,
    total_arr: totalArr,
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
