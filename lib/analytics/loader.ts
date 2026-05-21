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
  by_tam: Array<{ person: string; count: number }>; // TAM / FDE workload
  by_dev: Array<{ person: string; count: number }>; // SE / Dev workload
  ttv_distribution: Array<{ bucket: string; count: number }>; // TTV in days buckets
  ttv_avg_by_quarter: Array<{ quarter: string; avg_days: number; count: number }>;
  projects_by_group: Array<{ group: string; count: number }>;
  projects_by_lifecycle: Array<{ group: string; count: number }>; // active groups only
  projects_by_status: Array<{ status: string; count: number }>;
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
  go_live_date: string | null;
  kickoff_date: string | null;
  ttv_days_text: string | null;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
}
interface NpsRow {
  customer_id: string;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
}
interface AccountRow {
  annual_revenue: number | null;
}

// Column IDs + helpers come from the canonical taxonomy. See
// lib/delivery/taxonomy.ts — adding a new column ID here is a smell.
import { MONDAY_PROJECT_COLS, MONDAY_NPS_COLS, colText } from "@/lib/delivery/taxonomy";

const PROJECT_COL_STATUS = MONDAY_PROJECT_COLS.status;
const PROJECT_COL_PHASE  = MONDAY_PROJECT_COLS.phase;
const PROJECT_COL_GOLIVE = MONDAY_PROJECT_COLS.go_live_date;
const PROJECT_COL_TAM    = MONDAY_PROJECT_COLS.tam;
const PROJECT_COL_DEV    = MONDAY_PROJECT_COLS.dev;
const NPS_COL_SCORE      = MONDAY_NPS_COLS.score;
const NPS_COL_CATEGORY   = MONDAY_NPS_COLS.category;
const NPS_COL_QUARTER    = MONDAY_NPS_COLS.quarter;

function txt(cols: ProjectRow["raw_columns"], id: string): string | null {
  return colText(cols, id);
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
    sb.from("monday_projects").select("customer_id, group_title, raw_columns, go_live_date, ttv_days_text, kickoff_date"),
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
  const projectList = ((projects.data as ProjectRow[]) ?? [])
    // Filter out subitems and non-canonical group entries so they don't
    // pollute the charts.
    .filter((p) => {
      const g = (p.group_title ?? "").toLowerCase();
      return !g.startsWith("subitem") && g !== "unknown";
    });
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
  const tamAgg = new Map<string, number>();
  const devAgg = new Map<string, number>();
  const ttvBuckets = new Map<string, number>();
  const ttvByQtrAgg = new Map<string, { sum: number; count: number }>();

  // Helper: extract people from a comma-separated text column.
  // Monday returns "First Last, Other Person" or "first.last@kognitos.com".
  function peopleName(raw: string | null): string[] {
    if (!raw || !raw.trim()) return [];
    return raw.split(",").flatMap((s) => {
      const t = s.trim();
      if (!t) return [];
      if (t.includes("@")) {
        const local = t.split("@")[0].replace(/[._]/g, " ");
        const parts = local.split(" ").filter(Boolean);
        if (parts.length >= 2) {
          return [`${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`];
        }
        return [parts[0] ?? t];
      }
      return [t];
    });
  }

  // Placeholder strings Monday users sometimes put in the TAM / Dev columns.
  // None of these are real people; they pollute the workload charts.
  const PLACEHOLDER_NAMES = new Set([
    "customer implementing",
    "tbd",
    "unassigned",
    "n/a",
    "na",
    "tba",
    "—",
    "-",
    "?",
    "open",
    "kognitos",
    "partner",
  ]);

  // Workload aggregation: only count people on actively in-flight work. A
  // historical project that someone on the team handed off two quarters
  // ago shouldn't count against them now, and ex-teammates whose names
  // still sit in Monday columns shouldn't show up at all once their
  // projects ship or are reassigned. The active-status filter handles both.
  const ACTIVE_PROJECT_STATUSES = new Set([
    "In Progress",
    "Active",
    "Not Started",
    "Paused",
    "Pending",
  ]);
  const ACTIVE_PROJECT_GROUPS = new Set([
    "Active",
    "Pipeline",
    "On Hold",
    "Backlog",
    "Active Projects",
    "Upcoming Projects",
  ]);

  function isActiveProject(p: ProjectRow): boolean {
    const status = txt(p.raw_columns, PROJECT_COL_STATUS);
    // If Monday has a status that explicitly says active, trust it.
    if (status && ACTIVE_PROJECT_STATUSES.has(status)) return true;
    // Otherwise fall back to the group label.
    if (status && (status === "Delivered" || status === "Live" || status === "Cancelled")) {
      return false;
    }
    return ACTIVE_PROJECT_GROUPS.has(p.group_title ?? "");
  }

  function cleanWorkloadNames(raw: string | null): string[] {
    return peopleName(raw).filter((n) => !PLACEHOLDER_NAMES.has(n.toLowerCase().trim()));
  }

  for (const p of projectList) {
    const g = p.group_title ?? "(other)";
    projGroupAgg.set(g, (projGroupAgg.get(g) ?? 0) + 1);
    const s = txt(p.raw_columns, PROJECT_COL_STATUS) ?? "(unset)";
    projStatusAgg.set(s, (projStatusAgg.get(s) ?? 0) + 1);
    const ph = txt(p.raw_columns, PROJECT_COL_PHASE) ?? "(unset)";
    projPhaseAgg.set(ph, (projPhaseAgg.get(ph) ?? 0) + 1);

    // TAM / FDE + SE / Dev workload — counted on active projects only.
    if (isActiveProject(p)) {
      for (const name of cleanWorkloadNames(txt(p.raw_columns, PROJECT_COL_TAM))) {
        tamAgg.set(name, (tamAgg.get(name) ?? 0) + 1);
      }
      for (const name of cleanWorkloadNames(txt(p.raw_columns, PROJECT_COL_DEV))) {
        devAgg.set(name, (devAgg.get(name) ?? 0) + 1);
      }
    }

    // TTV distribution
    const ttvDays = p.ttv_days_text ? Number(p.ttv_days_text) : null;
    if (ttvDays != null && Number.isFinite(ttvDays) && ttvDays > 0) {
      const bucket =
        ttvDays <= 30 ? "0–30d" :
        ttvDays <= 60 ? "31–60d" :
        ttvDays <= 90 ? "61–90d" :
        ttvDays <= 180 ? "91–180d" : "180d+";
      ttvBuckets.set(bucket, (ttvBuckets.get(bucket) ?? 0) + 1);

      // TTV avg by quarter (use go_live_date for quarter bucketing)
      const qDate = p.go_live_date;
      if (qDate && qDate.length >= 7) {
        const d = new Date(qDate);
        const qLabel = `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
        const prev = ttvByQtrAgg.get(qLabel) ?? { sum: 0, count: 0 };
        prev.sum += ttvDays;
        prev.count++;
        ttvByQtrAgg.set(qLabel, prev);
      }
    }
  }

  // Projects by group — use a canonical sort:
  // 1. Active lifecycle groups (Active, Pipeline, On Hold, Backlog)
  // 2. Delivery status groups (Active Projects, Completed, Stalled, Cancelled)
  // 3. FY quarter groups in reverse chronological order
  // 4. Anything else
  const LIFECYCLE_ORDER = ["Active", "Pipeline", "On Hold", "Backlog"];
  const ACCOUNT_OVERVIEW_ORDER = ["Active Projects", "Upcoming Projects", "Completed Projects", "Stalled Projects", "Cancelled Projects"];
  const TERMINAL_ORDER = ["Churned", "Cancelled", "Inactive"];
  function groupSortKey(g: string): number {
    const li = LIFECYCLE_ORDER.indexOf(g);
    if (li >= 0) return li;
    const ai = ACCOUNT_OVERVIEW_ORDER.indexOf(g);
    if (ai >= 0) return 100 + ai;
    const ti = TERMINAL_ORDER.indexOf(g);
    if (ti >= 0) return 900 + ti;
    // FY quarter groups: "Q1'26", "Q2'25" etc. — sort by encoded date desc
    const m = /^Q(\d)'(\d{2})$/.exec(g);
    if (m) {
      const year = Number(m[2]);
      const q = Number(m[1]);
      // Higher = more recent = should appear first → negate
      return 200 + (100 - year * 4 - q);
    }
    // "Projects" (portfolio), others
    if (g === "Projects") return 500;
    return 400;
  }
  const projects_by_group = [...projGroupAgg.entries()]
    .map(([group, count]) => ({ group, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => groupSortKey(a.group) - groupSortKey(b.group));

  // Split `projects_by_group` into:
  //   (a) active lifecycle groups only (for the "stage" chart)
  //   (b) all groups (for detailed breakdown if needed)
  const ACTIVE_LIFECYCLE_GROUPS = new Set([
    "Active", "Pipeline", "On Hold", "Backlog",
    "Active Projects", "Upcoming Projects",
  ]);
  const projects_by_lifecycle = projects_by_group
    .filter((p) => ACTIVE_LIFECYCLE_GROUPS.has(p.group))
    .sort((a, b) => groupSortKey(a.group) - groupSortKey(b.group));
  const projects_by_phase = [...projPhaseAgg.entries()]
    .map(([phase, count]) => ({ phase, count }))
    .sort((a, b) => b.count - a.count);

  const by_tam = [...tamAgg.entries()]
    .map(([person, count]) => ({ person, count }))
    .sort((a, b) => b.count - a.count);
  const by_dev = [...devAgg.entries()]
    .map(([person, count]) => ({ person, count }))
    .sort((a, b) => b.count - a.count);

  const TTV_BUCKET_ORDER = ["0–30d", "31–60d", "61–90d", "91–180d", "180d+"];
  const ttv_distribution = TTV_BUCKET_ORDER
    .map((bucket) => ({ bucket, count: ttvBuckets.get(bucket) ?? 0 }))
    .filter((d) => d.count > 0);

  const ttv_avg_by_quarter = [...ttvByQtrAgg.entries()]
    .map(([quarter, v]) => ({
      quarter,
      avg_days: Math.round(v.sum / v.count),
      count: v.count,
    }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));

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
    // Use the stored go_live_date column first; fall back to raw_columns.
    const go = p.go_live_date ?? txt(p.raw_columns, PROJECT_COL_GOLIVE);
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
    by_tam,
    by_dev,
    ttv_distribution,
    ttv_avg_by_quarter,
    projects_by_group,
    projects_by_lifecycle,
    projects_by_status: [],
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
