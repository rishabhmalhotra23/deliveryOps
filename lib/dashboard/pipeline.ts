// Upcoming pipeline — SF opportunities closing in the next 90 days.
// Gives the team a rolling forward-looking view of what's incoming so
// they can prepare renewals and expansions before they land. A rolling
// window (rather than calendar-quarter) means the section stays useful
// late in a quarter when most upcoming closes are actually in Q+1.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import {
  MONDAY_PROJECT_COLS,
  colText,
  formatPersonName,
  isDelivered,
  unionPeopleColumns,
} from "@/lib/delivery/taxonomy";

const WINDOW_DAYS = 90;

function windowBounds(): { start: string; end: string; label: string } {
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
  /** Classified from Salesforce `Opportunity.Type` (read from raw jsonb). */
  kind: PipelineKind;
  /** Raw SF Type string for the tooltip / debugging. */
  type_raw: string | null;
  /**
   * Canonical-cased list of FDEs currently working this customer's
   * non-delivered projects.  `null` when the opportunity is for a new
   * logo (no FDE assigned yet) or when no active project exists.
   */
  fdes: string[] | null;
}

export interface PipelineBundle {
  opportunities: PipelineOpportunity[];
  total_amount: number;
  count: number;
  quarter_label: string;
  /** Counts per kind, useful for the section header summary. */
  by_kind: Record<PipelineKind, number>;
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
}

/**
 * Map a Salesforce `Opportunity.Type` value to our four-way classification.
 * Salesforce orgs are inconsistent: some use "New Business" / "Renewal" /
 * "Existing Customer - Upgrade", others use "New" / "Existing", others leave
 * it blank entirely. We do a forgiving substring match.
 */
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

export async function loadUpcomingPipeline(): Promise<PipelineBundle> {
  const sb = requireAdmin();
  const { start, end, label } = windowBounds();

  const [opps, customers, projects] = await Promise.all([
    sb
      .from("sf_opportunities")
      .select(
        "sf_id, customer_id, name, stage_name, amount, close_date, probability, owner_name, raw"
      )
      .eq("is_closed", false)
      .gte("close_date", start)
      .lte("close_date", end)
      .order("amount", { ascending: false })
      .limit(50),
    listCustomers().catch(() => []),
    // Pull every project's raw_columns so we can derive the FDE roster
    // per customer.  Cheap (~few hundred rows) and keeps the dashboard a
    // single round-trip.
    sb
      .from("monday_projects")
      .select("customer_id, raw_columns")
      .limit(2000)
      .then((r) => r, () => ({ data: null as null | unknown })),
  ]);

  const custById = new Map(customers.map((c) => [c.id, c]));

  // FDE-per-customer: union of TAM + Dev across every project that is
  // still in flight (i.e. not delivered).  Names are canonical-cased so
  // they match what we display elsewhere.
  type ProjRow = {
    customer_id: string;
    raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
  };
  const fdesByCustomer = new Map<string, Set<string>>();
  for (const p of (projects.data as ProjRow[] | null) ?? []) {
    const cols = p.raw_columns ?? {};
    const status = colText(cols, MONDAY_PROJECT_COLS.status);
    if (isDelivered(status)) continue;
    const merged = unionPeopleColumns(
      colText(cols, MONDAY_PROJECT_COLS.tam),
      colText(cols, MONDAY_PROJECT_COLS.dev),
    );
    if (!merged) continue;
    const set = fdesByCustomer.get(p.customer_id) ?? new Set<string>();
    for (const piece of merged.split(",")) {
      const name = formatPersonName(piece);
      if (name) set.add(name);
    }
    fdesByCustomer.set(p.customer_id, set);
  }

  const opportunities: PipelineOpportunity[] = ((opps.data as OppRow[] | null) ?? []).map((o) => {
    const cust = custById.get(o.customer_id);
    // SF `Type` lives only in the raw blob — we don't have a typed column
    // for it. Read the standard SF field name first; fall back to the
    // less-common variants some orgs use.
    const raw = o.raw ?? {};
    const typeStr =
      (raw["Type"] as string | undefined) ??
      (raw["Opportunity_Type__c"] as string | undefined) ??
      null;
    const { kind, raw: type_raw } = classifyOpportunityType(typeStr);
    // New-logo opportunities skip the FDE column — no team is assigned
    // yet, and showing one from an unrelated project would be misleading.
    const fdes =
      kind === "New" ? null : Array.from(fdesByCustomer.get(o.customer_id) ?? []).sort();
    return {
      sf_id: o.sf_id,
      name: o.name,
      stage_name: o.stage_name,
      amount: o.amount,
      close_date: o.close_date,
      probability: o.probability,
      owner_name: o.owner_name,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      kind,
      type_raw,
      fdes: fdes && fdes.length > 0 ? fdes : null,
    };
  });

  const total_amount = opportunities.reduce((s, o) => s + (o.amount ?? 0), 0);
  const by_kind: Record<PipelineKind, number> = {
    Renewal: 0,
    Expansion: 0,
    New: 0,
    Other: 0,
  };
  for (const o of opportunities) by_kind[o.kind]++;

  return {
    opportunities,
    total_amount,
    count: opportunities.length,
    quarter_label: label,
    by_kind,
  };
}
