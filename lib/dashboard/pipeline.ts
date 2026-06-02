// Upcoming pipeline — open SF opportunities closing in the next 90 days.
//
// Primary source: Salesforce Pipeline Inspection list view (Binny Gill's
// Team by default — see SALESFORCE_PIPELINE_LIST_VIEW_ID). Matches what GTM
// reviews weekly in Lightning. Falls back to the cached sf_opportunities
// table when SF credentials are missing or the live call fails.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import { loadFdesByCustomerId } from "@/lib/dashboard/stats-drilldown";
import {
  listOpportunitiesFromListView,
  opportunityRecordUrl,
  pipelineInspectionUrl,
  pipelineListViewId,
  salesforceConfigured,
  type SfOpportunity,
} from "@/lib/integrations/salesforce";

const WINDOW_DAYS = 90;

export function windowBounds(): { start: string; end: string; label: string } {
  const now = new Date();
  const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const isoDate = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  return {
    start: isoDate(now),
    end: isoDate(end),
    label: `Next ${WINDOW_DAYS} days`,
  };
}

export type PipelineKind = "Renewal" | "Expansion" | "New" | "Other";

export interface PipelineOpportunity {
  sf_id: string;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  owner_name: string | null;
  customer_key: string | null;
  customer_display_name: string | null;
  kind: PipelineKind;
  type_raw: string | null;
  fdes: string[] | null;
  sf_url: string | null;
}

export interface PipelineBundle {
  opportunities: PipelineOpportunity[];
  total_amount: number;
  count: number;
  quarter_label: string;
  by_kind: Record<PipelineKind, number>;
  source: "salesforce_list_view" | "cache";
  list_view_label: string | null;
  pipeline_inspection_url: string | null;
}

interface OppRow {
  sf_id: string;
  customer_id: string;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  owner_name: string | null;
  raw: Record<string, unknown> | null;
  account_sf_id?: string | null;
}

export function classifyOpportunityType(type: string | null | undefined): {
  kind: PipelineKind;
  raw: string | null;
} {
  if (!type) return { kind: "Other", raw: null };
  const t = type.toLowerCase();
  if (t.includes("renewal")) return { kind: "Renewal", raw: type };
  if (t.includes("upgrade") || t.includes("expansion") || t.includes("upsell")) {
    return { kind: "Expansion", raw: type };
  }
  if (t.includes("new")) return { kind: "New", raw: type };
  return { kind: "Other", raw: type };
}

function emptyByKind(): Record<PipelineKind, number> {
  return { Renewal: 0, Expansion: 0, New: 0, Other: 0 };
}

function mapSfOpportunityToPipeline(
  o: SfOpportunity,
  custBySfAccount: Map<string, { key: string; display_name: string; id: string }>,
  fdesByCustomer: Map<string, string[]>
): PipelineOpportunity {
  const cust = custBySfAccount.get(o.AccountId);
  const { kind, raw: type_raw } = classifyOpportunityType(o.Type ?? null);
  const fdes =
    kind === "New" || !cust ? null : fdesByCustomer.get(cust.id) ?? null;
  return {
    sf_id: o.Id,
    name: o.Name,
    stage_name: o.StageName ?? null,
    amount: o.Amount,
    close_date: o.CloseDate ?? null,
    probability: o.Probability,
    owner_name: o.Owner?.Name ?? null,
    customer_key: cust?.key ?? null,
    customer_display_name: cust?.display_name ?? o.Account?.Name ?? null,
    kind,
    type_raw,
    fdes: fdes && fdes.length > 0 ? fdes : null,
    sf_url: opportunityRecordUrl(o.Id),
  };
}

function finishBundle(
  opportunities: PipelineOpportunity[],
  label: string,
  source: PipelineBundle["source"],
  listViewLabel: string | null
): PipelineBundle {
  const total_amount = opportunities.reduce((s, o) => s + (o.amount ?? 0), 0);
  const by_kind = emptyByKind();
  for (const o of opportunities) by_kind[o.kind]++;
  return {
    opportunities,
    total_amount,
    count: opportunities.length,
    quarter_label: label,
    by_kind,
    source,
    list_view_label: listViewLabel,
    pipeline_inspection_url: pipelineInspectionUrl(),
  };
}

function buildCustomerMaps(customers: Awaited<ReturnType<typeof listCustomers>>) {
  const custBySfAccount = new Map<string, { key: string; display_name: string; id: string }>();
  const custById = new Map(customers.map((c) => [c.id, c]));
  for (const c of customers) {
    if (c.salesforce_account_id) {
      custBySfAccount.set(c.salesforce_account_id, {
        key: c.key,
        display_name: c.display_name,
        id: c.id,
      });
    }
  }
  return { custBySfAccount, custById };
}

async function loadFromSalesforceListView(
  start: string,
  end: string,
  label: string
): Promise<PipelineBundle> {
  const listViewId = pipelineListViewId();
  const [live, customers, fdesByCustomer] = await Promise.all([
    listOpportunitiesFromListView(listViewId, { start, end }),
    listCustomers(),
    loadFdesByCustomerId().catch(() => new Map<string, string[]>()),
  ]);

  const { custBySfAccount } = buildCustomerMaps(customers);
  const opportunities = live.records.map((o) =>
    mapSfOpportunityToPipeline(o, custBySfAccount, fdesByCustomer)
  );

  return finishBundle(opportunities, label, "salesforce_list_view", live.label);
}

async function loadFromCache(
  start: string,
  end: string,
  label: string
): Promise<PipelineBundle> {
  const sb = requireAdmin();

  const [opps, customers, fdesByCustomer] = await Promise.all([
    sb
      .from("sf_opportunities")
      .select(
        "sf_id, customer_id, name, stage_name, amount, close_date, probability, owner_name, raw, account_sf_id"
      )
      .eq("is_closed", false)
      .gte("close_date", start)
      .lte("close_date", end)
      .order("amount", { ascending: false })
      .limit(100),
    listCustomers().catch(() => []),
    loadFdesByCustomerId().catch(() => new Map<string, string[]>()),
  ]);

  const { custById, custBySfAccount } = buildCustomerMaps(customers);

  const opportunities: PipelineOpportunity[] = ((opps.data as OppRow[] | null) ?? []).map((o) => {
    const cust = custById.get(o.customer_id);
    const raw = o.raw ?? {};
    const typeStr =
      (raw["Type"] as string | undefined) ??
      (raw["Opportunity_Type__c"] as string | undefined) ??
      null;
    const { kind, raw: type_raw } = classifyOpportunityType(typeStr);
    const fdes = kind === "New" ? null : fdesByCustomer.get(o.customer_id) ?? null;
    const accountName =
      (raw["Account"] as { Name?: string } | undefined)?.Name ??
      (o.account_sf_id ? custBySfAccount.get(o.account_sf_id)?.display_name : null) ??
      null;
    return {
      sf_id: o.sf_id,
      name: o.name,
      stage_name: o.stage_name,
      amount: o.amount,
      close_date: o.close_date,
      probability: o.probability,
      owner_name: o.owner_name,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? accountName,
      kind,
      type_raw,
      fdes: fdes && fdes.length > 0 ? fdes : null,
      sf_url: opportunityRecordUrl(o.sf_id),
    };
  });

  return finishBundle(opportunities, label, "cache", null);
}

export async function loadUpcomingPipeline(): Promise<PipelineBundle> {
  const { start, end, label } = windowBounds();
  const inspectionUrl = pipelineInspectionUrl();

  // Always load from the Supabase cache first — this is what powered the
  // dashboard before and matches synced SF opps for DeliveryOps customers.
  const cached = await loadFromCache(start, end, label);

  if (!salesforceConfigured()) {
    return { ...cached, pipeline_inspection_url: inspectionUrl };
  }

  // Try Pipeline Inspection (Binny Gill's Team list view). Only replace the
  // cached list when live returns rows — an empty list view must not hide
  // deals that are already in our cache.
  try {
    const live = await loadFromSalesforceListView(start, end, label);
    if (live.count > 0) {
      return { ...live, pipeline_inspection_url: inspectionUrl };
    }
  } catch (err) {
    console.warn(
      "[pipeline] Live Salesforce list view failed; using cache.",
      err instanceof Error ? err.message : err
    );
  }

  return {
    ...cached,
    pipeline_inspection_url: inspectionUrl,
    source: "cache",
    list_view_label: null,
  };
}
