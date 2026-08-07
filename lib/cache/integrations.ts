// Cache readers — UI pulls from these instead of hitting Salesforce / Monday
// directly on every page load. The sync runner refreshes the underlying
// tables on a weekly cron (in production) or on demand via /api/dev/sync/run.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer as brandCategoryFromCustomer } from "@/app/_components/brand";
import { getConfirmedArrForCustomer } from "@/lib/commercials/confirmed-arr";

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

import { unionPeopleColumns, legacyFieldsFromProcess } from "@/lib/delivery/taxonomy";
import { TABLES, npsCategory, type Process, type NpsResponse } from "@/lib/supabase/types";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface RawColumns {
  [columnId: string]: { type: string; text: string | null; value: string | null } | undefined;
}

function txt(cols: RawColumns | null | undefined, id: string): string | null {
  return cols?.[id]?.text?.trim() || null;
}

export async function loadCustomerEnrichment(customerId: string): Promise<CustomerEnrichment> {
  const sb = requireAdmin();

  const [acc, opps, cases, processes, activities, nps] = await Promise.all([
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
    // Pull every process for this customer — one row per process, no more
    // historical per-FY-board duplication, so no ordering/filter games needed
    // beyond the go-live sort applied client-side below.
    sb.from(TABLES.processes).select("*").eq("customer_id", customerId),
    sb
      .from("monday_activities")
      .select("*")
      .eq("customer_id", customerId)
      .order("monday_updated_at", { ascending: false })
      .limit(100),
    sb.from(TABLES.npsResponses).select("*").eq("customer_id", customerId),
  ]);

  const projectCache: MondayProjectCache[] = ((processes.data as Process[] | null) ?? [])
    .map((p) => {
      const legacy = legacyFieldsFromProcess(p);
      return {
        monday_item_id: legacy.id,
        name: legacy.name,
        group_title: legacy.group_title,
        state: null,
        monday_updated_at: p.updated_at,
        fiscal_year: legacy.fiscal_year,
        board_name: null,
        health:          legacy.health,
        project_status:  legacy.status,
        current_phase:   legacy.phase,
        dev_platform:    legacy.platform,
        complexity:      legacy.complexity,
        go_live_date:    legacy.go_live_date,
        kickoff_date:    legacy.kickoff_date,
        partner:         p.partner,
        fde:             unionPeopleColumns(legacy.tam_text, legacy.dev_text),
        // total_effort_hours has no confirmed unit conversion from Monday's
        // original "Total Effort" column (it was carried into the native
        // schema as-is) — shown unconverted rather than guessed.
        total_effort_days: p.total_effort_hours != null ? Math.round(p.total_effort_hours) : null,
        // No native equivalent — Monday's "Delivered Value" column was
        // already empty on every row that had it (docs/PROCESSES-SCHEMA-
        // PROPOSAL.md audit), so this was never real content.
        delivered_value: null,
        ttv_days_text:   legacy.ttv_days != null ? String(legacy.ttv_days) : null,
        timeline_start:  null,
        timeline_end:    null,
        // No native equivalent yet — Monday's free-text "latest update" note
        // has no `processes` column. Was real content; now always blank.
        latest_update:   null,
      };
    })
    .sort((a, b) => (b.go_live_date ?? "").localeCompare(a.go_live_date ?? ""));

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

  const npsCache: MondayNpsCache[] = ((nps.data as NpsResponse[] | null) ?? []).map((n) => ({
    monday_item_id: n.id,
    respondent: n.respondent_name,
    // No native equivalent — Monday's NPS board grouped responses by section;
    // nps_responses has no matching column. Not read by the customer-360 NPS
    // card today (grouping there is by quarter, not group_title).
    group_title: null,
    quarter: n.quarter,
    score: n.score,
    category: capitalize(npsCategory(n.score)),
    response_date: n.response_date,
    feedback: n.feedback,
    respondent_type: n.respondent_type,
    product_satisfaction: n.product_satisfaction,
  }));

  // (projectCache is built above in the processes section of Promise.all)

  const lastProcessUpdate = ((processes.data as Process[] | null) ?? [])
    .map((p) => p.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    account: (acc.data as SfAccountCache | null) ?? null,
    opportunities: (opps.data as SfOpportunityCache[] | null) ?? [],
    cases: (cases.data as SfCaseCache[] | null) ?? [],
    projects: projectCache,
    activities: activityCache,
    nps: npsCache,
    freshness: {
      salesforce_synced_at: (acc.data as SfAccountCache | null)?.synced_at ?? null,
      // Was the Monday sync timestamp; `processes` isn't synced from an
      // external source anymore, so this now reflects the most recent
      // process edit for this customer instead.
      monday_synced_at: lastProcessUpdate,
    },
  };
}

export interface PortfolioSummary {
  total: number;
  by_category: Record<string, number>;
  by_ae: Record<string, number>;
  by_partner: Record<string, number>;
  // total_arr = sum of most-recent Closed-Won SF opp amounts across active
  // customers, close_date ≤ today.  This is the confirmed contracted ARR —
  // open/pipeline opps are excluded because they inflate the figure with
  // estimates.  See loadArrBreakdown() for per-customer breakdown.
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
    .select("id, key, custom_category, lifecycle_group, partner, ae_owner, salesforce_account_id, monday_workspace_id")
    .is("deleted_at", null);
  const list = (customers ?? []) as Array<{
    id: string;
    key: string;
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
  const [allOppsForArr, accountsForCat, openOppsCount, cases, lastSf, lastMon, profilesForCat] = await Promise.all([
    // All SF opps needed to compute confirmed ARR (closed-won, close_date ≤ today)
    // and renewal dates.
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed"),
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

  // Compute confirmed ARR per customer from Closed-Won SF opps
  // (close_date ≤ today).  Open/pipeline opps are excluded to prevent
  // inflating the figure with unconfirmed estimates.
  type OppRow = { customer_id: string; amount: number | null; close_date: string | null; is_won: boolean; is_closed: boolean };
  const oppsByC = new Map<string, OppRow[]>();
  for (const o of (allOppsForArr.data as OppRow[] | null) ?? []) {
    const list2 = oppsByC.get(o.customer_id) ?? [];
    list2.push(o);
    oppsByC.set(o.customer_id, list2);
  }
  const keyById = new Map(list.map((c) => [c.id, c.key]));
  function confirmedArrForCustomer(customerId: string): { arr: number; renewal_date: string | null } {
    const opps = oppsByC.get(customerId) ?? [];
    const { arr, renewal_date } = getConfirmedArrForCustomer(keyById.get(customerId), opps);
    return {
      arr,
      renewal_date: renewal_date ?? renewalByC.get(customerId) ?? null,
    };
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
    const { arr: cArr, renewal_date } = confirmedArrForCustomer(c.id);
    const cat = brandCategoryFromCustomer(c, {
      renewal_date,
      annual_revenue: revenueByC.get(c.id) ?? null,
    });
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (PAST_STATE_CATEGORIES.has(cat)) continue;
    activeIds.add(c.id);
    const ae = c.ae_owner ?? "(unassigned)";
    byAe[ae] = (byAe[ae] ?? 0) + 1;
    const p = c.partner ?? "Direct";
    byPartner[p] = (byPartner[p] ?? 0) + 1;
    void cArr; // used per-customer below
  }
  const activeCount = activeIds.size;
  // Sum confirmed ARR only over active customers.
  let totalArr = 0;
  for (const id of activeIds) {
    totalArr += confirmedArrForCustomer(id).arr;
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
    total_open_opportunities: openOppsCount.count ?? 0,
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
 *  - `arr` = most recent Closed-Won SF opp amount (close_date ≤ today).
 *  - `renewal_date` = soonest open opp close_date after today.
 *  - `annual_revenue` from `sf_accounts` — the customer's company-wide
 *    Salesforce revenue, used to bucket large customers into "Strategic Growth".
 */
export interface CustomerCommercials {
  arr: number | null;
  renewal_date: string | null;
  annual_revenue: number | null;
}

/**
 * Bulk-load ARR + renewal date + company revenue for every customer.
 * ARR is derived from the most-recent Closed-Won SF opportunity per customer
 * (close_date ≤ today) so it stays accurate as SF is updated without needing
 * a manual profile backfill.
 */
export async function loadCustomerCommercialsMap(): Promise<
  Map<string, CustomerCommercials>
> {
  const sb = requireAdmin();
  const [oppsRes, accountsRes, customersRes] = await Promise.all([
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed"),
    sb.from("sf_accounts").select("customer_id, annual_revenue"),
    sb.from("customers").select("id, key").is("deleted_at", null),
  ]);

  type OppRow = {
    customer_id: string;
    amount: number | null;
    close_date: string | null;
    is_won: boolean;
    is_closed: boolean;
  };
  const keyById = new Map(
    ((customersRes.data ?? []) as Array<{ id: string; key: string }>).map((c) => [c.id, c.key])
  );
  const oppsByCId = new Map<string, OppRow[]>();
  for (const o of (oppsRes.data ?? []) as OppRow[]) {
    const list = oppsByCId.get(o.customer_id) ?? [];
    list.push(o);
    oppsByCId.set(o.customer_id, list);
  }

  const accounts = (accountsRes.data ?? []) as Array<{
    customer_id: string;
    annual_revenue: number | null;
  }>;
  const revenueMap = new Map<string, number | null>(
    accounts.map((a) => [a.customer_id, a.annual_revenue])
  );

  // Collect all unique customer IDs from both sources.
  const allCustomerIds = new Set<string>([
    ...oppsByCId.keys(),
    ...revenueMap.keys(),
  ]);

  const map = new Map<string, CustomerCommercials>();
  for (const cid of allCustomerIds) {
    const opps = oppsByCId.get(cid) ?? [];
    const { arr, renewal_date } = getConfirmedArrForCustomer(keyById.get(cid), opps);
    map.set(cid, {
      arr: arr > 0 ? arr : null,
      renewal_date,
      annual_revenue: revenueMap.get(cid) ?? null,
    });
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
