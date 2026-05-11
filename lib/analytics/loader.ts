// Analytics data loader. Pure aggregation queries over the existing cache
// tables — no new schema. Returns a single AnalyticsBundle that the
// /analytics page renders with Recharts.

import { requireAdmin } from "@/lib/supabase/server";

export interface AnalyticsBundle {
  generated_at: string;
  totals: {
    customers: number;
    total_arr: number;
    total_company_revenue: number;
    projects_total: number;
    projects_in_progress: number;
    projects_delivered: number;
    nps_average: number | null;
    nps_responses: number;
    open_opportunities: number;
    open_cases: number;
  };
  by_category: Array<{ category: string; count: number; arr: number }>;
  by_ae: Array<{ ae: string; count: number; arr: number }>;
  by_partner: Array<{ partner: string; count: number; arr: number }>;
  projects_by_group: Array<{ group: string; count: number }>; // Active / Pipeline / On Hold / Backlog
  projects_by_status: Array<{ status: string; count: number }>; // In Progress / Delivered / etc.
  projects_by_phase: Array<{ phase: string; count: number }>;
  nps_distribution: Array<{ category: string; count: number }>; // Promoter / Passive / Detractor
  nps_by_quarter: Array<{ quarter: string; average: number; count: number; promoter: number; passive: number; detractor: number }>;
  nps_by_customer_category: Array<{ category: string; average: number; responses: number }>;
  deliveries_over_time: Array<{ month: string; count: number }>; // YYYY-MM
  last_sync: { salesforce: string | null; monday: string | null };
}

interface ProfileRow {
  customer_id: string;
  arr: number | null;
}
interface CustomerRow {
  id: string;
  custom_category: string | null;
  lifecycle_group: string | null;
  ae_owner: string | null;
  partner: string | null;
}
interface ProjectRow {
  customer_id: string;
  group_title: string | null;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
}
interface NpsRow {
  customer_id: string;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
}
interface AccountRow {
  annual_revenue: number | null;
}

const PROJECT_COL_STATUS = "color_mkzj8fw8";
const PROJECT_COL_PHASE = "color_mm06sdrj";
const PROJECT_COL_GOLIVE = "date_mm01dz3b";
const NPS_COL_SCORE = "numeric_mm0aqvk3";
const NPS_COL_CATEGORY = "color_mm0af90g";
const NPS_COL_QUARTER = "dropdown_mm0ahec7";

function txt(cols: ProjectRow["raw_columns"], id: string): string | null {
  return cols?.[id]?.text?.trim() || null;
}

function categoryFromCustomer(c: { custom_category: string | null; lifecycle_group: string | null }): string {
  if (c.custom_category?.trim()) return c.custom_category.trim();
  // Mirror brand.tsx LIFECYCLE_TO_CATEGORY for any straggler.
  const map: Record<string, string> = {
    "High Risk": "At Risk",
    "Upcoming Renewal": "Upcoming Renewals",
    "Growth / Focus": "Strategic Growth",
    "Tier 2 - Secondary Priority": "Active",
    "Partner Managed": "Partner Managed",
    POV: "POV",
    "To be Dropped": "To Drop",
    "Churned/Dropped": "Churned",
  };
  return (c.lifecycle_group && map[c.lifecycle_group]) ?? "Active";
}

export async function loadAnalytics(): Promise<AnalyticsBundle> {
  const sb = requireAdmin();

  const [
    customers,
    profiles,
    projects,
    nps,
    accounts,
    openOpps,
    openCases,
    lastSf,
    lastMon,
  ] = await Promise.all([
    sb
      .from("customers")
      .select("id, custom_category, lifecycle_group, ae_owner, partner")
      .is("deleted_at", null),
    sb.from("profiles").select("customer_id, arr"),
    sb.from("monday_projects").select("customer_id, group_title, raw_columns"),
    sb.from("monday_nps_responses").select("customer_id, raw_columns"),
    sb.from("sf_accounts").select("annual_revenue"),
    sb
      .from("sf_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("is_closed", false),
    sb.from("sf_cases").select("id", { count: "exact", head: true }).eq("is_closed", false),
    sb
      .from("sync_runs")
      .select("finished_at")
      .eq("source", "salesforce")
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("sync_runs")
      .select("finished_at")
      .eq("source", "monday")
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const customerList = ((customers.data as CustomerRow[]) ?? []);
  const profileList = ((profiles.data as ProfileRow[]) ?? []);
  const projectList = ((projects.data as ProjectRow[]) ?? []);
  const npsList = ((nps.data as NpsRow[]) ?? []);
  const accountList = ((accounts.data as AccountRow[]) ?? []);

  const profileByC = new Map(profileList.map((p) => [p.customer_id, p.arr ?? 0]));
  const categoryByC = new Map<string, string>();
  for (const c of customerList) categoryByC.set(c.id, categoryFromCustomer(c));

  // ─── Totals ─────────────────────────────────────────────────────────
  const totalArr = profileList.reduce((s, p) => s + (p.arr ?? 0), 0);
  const totalCompanyRevenue = accountList.reduce((s, a) => s + (a.annual_revenue ?? 0), 0);
  const projectsTotal = projectList.length;

  const projectsInProgress = projectList.filter(
    (p) => txt(p.raw_columns, PROJECT_COL_STATUS) === "In Progress"
  ).length;
  const projectsDelivered = projectList.filter((p) => {
    const status = txt(p.raw_columns, PROJECT_COL_STATUS);
    return status === "Delivered" || status === "Live" || !!txt(p.raw_columns, PROJECT_COL_GOLIVE);
  }).length;

  const npsScores: number[] = [];
  for (const n of npsList) {
    const s = Number(txt(n.raw_columns, NPS_COL_SCORE) ?? "");
    if (Number.isFinite(s)) npsScores.push(s);
  }
  const npsAverage = npsScores.length
    ? Math.round((npsScores.reduce((a, b) => a + b, 0) / npsScores.length) * 10) / 10
    : null;

  // ─── By category ────────────────────────────────────────────────────
  const byCategoryAgg = new Map<string, { count: number; arr: number }>();
  for (const c of customerList) {
    const cat = categoryByC.get(c.id) ?? "Active";
    const prev = byCategoryAgg.get(cat) ?? { count: 0, arr: 0 };
    prev.count++;
    prev.arr += profileByC.get(c.id) ?? 0;
    byCategoryAgg.set(cat, prev);
  }
  const by_category = [...byCategoryAgg.entries()].map(([category, v]) => ({ category, ...v }));

  // ─── By AE ──────────────────────────────────────────────────────────
  const byAeAgg = new Map<string, { count: number; arr: number }>();
  for (const c of customerList) {
    const ae = c.ae_owner ?? "(unassigned)";
    const prev = byAeAgg.get(ae) ?? { count: 0, arr: 0 };
    prev.count++;
    prev.arr += profileByC.get(c.id) ?? 0;
    byAeAgg.set(ae, prev);
  }
  const by_ae = [...byAeAgg.entries()]
    .map(([ae, v]) => ({ ae, ...v }))
    .sort((a, b) => b.count - a.count);

  // ─── By partner ─────────────────────────────────────────────────────
  const byPartnerAgg = new Map<string, { count: number; arr: number }>();
  for (const c of customerList) {
    const p = c.partner ?? "Direct";
    const prev = byPartnerAgg.get(p) ?? { count: 0, arr: 0 };
    prev.count++;
    prev.arr += profileByC.get(c.id) ?? 0;
    byPartnerAgg.set(p, prev);
  }
  const by_partner = [...byPartnerAgg.entries()]
    .map(([partner, v]) => ({ partner, ...v }))
    .sort((a, b) => b.count - a.count);

  // ─── Projects by group / status / phase ─────────────────────────────
  const projGroupAgg = new Map<string, number>();
  const projStatusAgg = new Map<string, number>();
  const projPhaseAgg = new Map<string, number>();
  for (const p of projectList) {
    const g = p.group_title ?? "(other)";
    projGroupAgg.set(g, (projGroupAgg.get(g) ?? 0) + 1);
    const s = txt(p.raw_columns, PROJECT_COL_STATUS) ?? "(unset)";
    projStatusAgg.set(s, (projStatusAgg.get(s) ?? 0) + 1);
    const ph = txt(p.raw_columns, PROJECT_COL_PHASE) ?? "(unset)";
    projPhaseAgg.set(ph, (projPhaseAgg.get(ph) ?? 0) + 1);
  }
  const PROJECT_GROUP_ORDER = ["Active", "Pipeline", "On Hold", "Backlog"];
  const projects_by_group = [...projGroupAgg.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => {
      const ai = PROJECT_GROUP_ORDER.indexOf(a.group);
      const bi = PROJECT_GROUP_ORDER.indexOf(b.group);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  const projects_by_status = [...projStatusAgg.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  const projects_by_phase = [...projPhaseAgg.entries()]
    .map(([phase, count]) => ({ phase, count }))
    .sort((a, b) => b.count - a.count);

  // ─── NPS distribution + by quarter ──────────────────────────────────
  const NPS_CAT_ORDER = ["Promoter", "Passive", "Detractor"];
  const npsDistAgg = new Map<string, number>();
  const npsByQuarterAgg = new Map<
    string,
    { sum: number; count: number; promoter: number; passive: number; detractor: number }
  >();
  for (const n of npsList) {
    const cat = txt(n.raw_columns, NPS_COL_CATEGORY);
    if (cat) npsDistAgg.set(cat, (npsDistAgg.get(cat) ?? 0) + 1);

    const quarter = txt(n.raw_columns, NPS_COL_QUARTER);
    const score = Number(txt(n.raw_columns, NPS_COL_SCORE) ?? "");
    if (quarter && Number.isFinite(score)) {
      const prev = npsByQuarterAgg.get(quarter) ?? { sum: 0, count: 0, promoter: 0, passive: 0, detractor: 0 };
      prev.sum += score;
      prev.count++;
      if (cat === "Promoter") prev.promoter++;
      else if (cat === "Passive") prev.passive++;
      else if (cat === "Detractor") prev.detractor++;
      npsByQuarterAgg.set(quarter, prev);
    }
  }
  const nps_distribution = NPS_CAT_ORDER.map((cat) => ({
    category: cat,
    count: npsDistAgg.get(cat) ?? 0,
  })).filter((d) => d.count > 0);

  // Sort quarters chronologically (e.g. "2Q24", "3Q24", "4Q24", "1Q25"…).
  const nps_by_quarter = [...npsByQuarterAgg.entries()]
    .map(([quarter, v]) => ({
      quarter,
      average: Math.round((v.sum / v.count) * 10) / 10,
      count: v.count,
      promoter: v.promoter,
      passive: v.passive,
      detractor: v.detractor,
    }))
    .sort((a, b) => {
      // "4Q25" → year=25, q=4; "1Q26" → year=26, q=1
      const parse = (s: string) => {
        const m = /^(\d)Q(\d{2})$/.exec(s);
        return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
      };
      return parse(a.quarter) - parse(b.quarter);
    });

  // ─── NPS by customer category ───────────────────────────────────────
  const npsCustCatAgg = new Map<string, { sum: number; count: number }>();
  for (const n of npsList) {
    const cat = categoryByC.get(n.customer_id) ?? "Active";
    const score = Number(txt(n.raw_columns, NPS_COL_SCORE) ?? "");
    if (Number.isFinite(score)) {
      const prev = npsCustCatAgg.get(cat) ?? { sum: 0, count: 0 };
      prev.sum += score;
      prev.count++;
      npsCustCatAgg.set(cat, prev);
    }
  }
  const nps_by_customer_category = [...npsCustCatAgg.entries()]
    .map(([category, v]) => ({
      category,
      average: Math.round((v.sum / v.count) * 10) / 10,
      responses: v.count,
    }))
    .sort((a, b) => b.average - a.average);

  // ─── Deliveries over time (by go-live month) ────────────────────────
  const deliveryAgg = new Map<string, number>();
  for (const p of projectList) {
    const go = txt(p.raw_columns, PROJECT_COL_GOLIVE);
    if (go && go.length >= 7) {
      const month = go.slice(0, 7); // YYYY-MM
      deliveryAgg.set(month, (deliveryAgg.get(month) ?? 0) + 1);
    }
  }
  const deliveries_over_time = [...deliveryAgg.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  return {
    generated_at: new Date().toISOString(),
    totals: {
      customers: customerList.length,
      total_arr: totalArr,
      total_company_revenue: totalCompanyRevenue,
      projects_total: projectsTotal,
      projects_in_progress: projectsInProgress,
      projects_delivered: projectsDelivered,
      nps_average: npsAverage,
      nps_responses: npsList.length,
      open_opportunities: openOpps.count ?? 0,
      open_cases: openCases.count ?? 0,
    },
    by_category: by_category.sort((a, b) => b.arr - a.arr),
    by_ae,
    by_partner,
    projects_by_group,
    projects_by_status,
    projects_by_phase,
    nps_distribution,
    nps_by_quarter,
    nps_by_customer_category,
    deliveries_over_time,
    last_sync: {
      salesforce: (lastSf.data as { finished_at: string } | null)?.finished_at ?? null,
      monday: (lastMon.data as { finished_at: string } | null)?.finished_at ?? null,
    },
  };
}
