// Analytics data loader. Pure aggregation queries over the existing cache
// tables — no new schema. Returns a single AnalyticsBundle that the
// /analytics page renders with Recharts.

import { requireAdmin } from "@/lib/supabase/server";

/** Slim project row used by the chart drill-down panels. */
export interface DrillDownProject {
  monday_item_id: string;
  name: string;
  customer_key: string | null;
  customer_display_name: string | null;
  fiscal_year: string | null;
  group_title: string | null;
  status: string | null;
  health: string | null;
  phase: string | null;
  platform: string | null;
  /** Combined FDE roster — union of every person Monday lists on the
   *  project's delivery columns, deduped.  Replaces the old separate
   *  TAM + Dev fields.  See "1 single flow" simplification. */
  fde: string[];
  go_live_date: string | null;
  kickoff_date: string | null;
}

/** Slim customer row used by the AE-workload drill-down panel. */
export interface DrillDownCustomer {
  id: string;
  key: string;
  display_name: string;
  partner: string | null;
  custom_category: string | null;
  lifecycle_group: string | null;
  arr: number;
  renewal_date: string | null;
}

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
  by_fde: Array<{ person: string; count: number }>; // FDE workload (union of Monday's delivery columns)
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
  /**
   * Per-bar drill-down items.  Keys mirror the chart's series keys exactly
   * so a click on a bar can look up the underlying rows in O(1).
   *
   *   by_fde_items[shortName]            → projects this FDE is on
   *   projects_by_lifecycle_items[group] → projects sitting in that stage
   *   by_ae_items[ae]                    → customers owned by that AE
   */
  drilldowns: {
    by_fde_items: Record<string, DrillDownProject[]>;
    projects_by_lifecycle_items: Record<string, DrillDownProject[]>;
    by_ae_items: Record<string, DrillDownCustomer[]>;
  };
}

interface ProfileRow {
  customer_id: string;
  arr: number | null;
  renewal_date: string | null;
}
interface CustomerRow {
  id: string;
  key: string;
  display_name: string;
  custom_category: string | null;
  lifecycle_group: string | null;
  ae_owner: string | null;
  partner: string | null;
}
interface ProjectRow {
  monday_item_id: string;
  name: string;
  customer_id: string;
  group_title: string | null;
  go_live_date: string | null;
  kickoff_date: string | null;
  ttv_days_text: string | null;
  fiscal_year: string | null;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
}
interface NpsRow {
  customer_id: string;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }> | null;
}
interface AccountRow {
  customer_id: string | null;
  annual_revenue: number | null;
}

// Column IDs + helpers come from the canonical taxonomy. See
// lib/delivery/taxonomy.ts — adding a new column ID here is a smell.
import { MONDAY_PROJECT_COLS, MONDAY_NPS_COLS, colText, peopleNames } from "@/lib/delivery/taxonomy";

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

// Use the canonical helper from brand.tsx so the dynamic rules (90-day
// renewal → Upcoming Renewals, revenue>$20M → Strategic Growth, etc.)
// stay in one place. brand.tsx is server-component-safe.
import { categoryFromCustomer as brandCategoryFromCustomer } from "@/app/_components/brand";

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
      .select("id, key, display_name, custom_category, lifecycle_group, ae_owner, partner")
      .is("deleted_at", null),
    sb.from("profiles").select("customer_id, arr, renewal_date"),
    sb
      .from("monday_projects")
      .select(
        "monday_item_id, name, customer_id, group_title, raw_columns, " +
          "go_live_date, ttv_days_text, kickoff_date, fiscal_year"
      ),
    sb.from("monday_nps_responses").select("customer_id, raw_columns"),
    sb.from("sf_accounts").select("customer_id, annual_revenue"),
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
  // Exclude Account Overview + Projects Portfolio rows — they're aggregate
  // duplicates of the FY-board rows.  Same rule as lib/delivery/loader.ts.
  const PORTFOLIO_DUPE_FYS = new Set(["account_overview", "portfolio"]);
  // Cast through unknown — Supabase's row-typing union (GenericStringError[]
  // | null) doesn't unify cleanly with our wider ProjectRow shape.
  const projectList = ((projects.data as unknown as ProjectRow[]) ?? [])
    .filter((p) => {
      if (p.fiscal_year && PORTFOLIO_DUPE_FYS.has(p.fiscal_year)) return false;
      const g = (p.group_title ?? "").toLowerCase();
      return !g.startsWith("subitem") && g !== "unknown";
    });
  const npsList = ((nps.data as NpsRow[]) ?? []);
  const accountList = ((accounts.data as AccountRow[]) ?? []);

  const profileByC = new Map(
    profileList.map((p) => [p.customer_id, { arr: p.arr ?? 0, renewal_date: p.renewal_date }])
  );
  const revenueByC = new Map<string, number | null>();
  for (const a of accountList) {
    if (a.customer_id) revenueByC.set(a.customer_id, a.annual_revenue);
  }
  const customerById = new Map(customerList.map((c) => [c.id, c]));
  // Dynamic category — feeds renewal_date + annual_revenue so the 90-day
  // renewal rule and the $20M Strategic Growth rule both fire here.
  const categoryByC = new Map<string, string>();
  for (const c of customerList) {
    const profile = profileByC.get(c.id);
    categoryByC.set(
      c.id,
      brandCategoryFromCustomer(c, {
        renewal_date: profile?.renewal_date ?? null,
        annual_revenue: revenueByC.get(c.id) ?? null,
      })
    );
  }

  // ─── Totals ─────────────────────────────────────────────────────────
  // Active-book totals: exclude past-state customers (Churned / Dropped /
  // Past). Their ARR is zero and their headcount inflates the "active
  // customers" number on the dashboard.
  const PAST_FOR_TOTALS = new Set(["Churned", "Dropped", "Past"]);
  const activeCustomerIds = new Set(
    customerList
      .filter((c) => !PAST_FOR_TOTALS.has(categoryByC.get(c.id) ?? ""))
      .map((c) => c.id)
  );
  const totalArr = profileList
    .filter((p) => activeCustomerIds.has(p.customer_id))
    .reduce((s, p) => s + (p.arr ?? 0), 0);
  const totalCompanyRevenue = accountList
    .filter((a) => a.customer_id && activeCustomerIds.has(a.customer_id))
    .reduce((s, a) => s + (a.annual_revenue ?? 0), 0);
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

  // Helper — pull the ARR component for a given customer.  Returns 0 when
  // no profile row exists, matching the legacy behaviour.
  const arrFor = (id: string) => profileByC.get(id)?.arr ?? 0;

  // Past-state customers are excluded from "active book" aggregates (AE
  // workload, partner workload, ARR-by-category, totals).  They're still
  // counted in historical trends below (deliveries-over-time, NPS by
  // quarter, TTV) because those visualise events that *happened* and
  // shouldn't be revised when a customer churns later.
  const PAST_STATE_CATEGORIES = new Set(["Churned", "Dropped", "Past"]);
  const isActiveBook = (customerId: string) =>
    !PAST_STATE_CATEGORIES.has(categoryByC.get(customerId) ?? "");
  const activeCustomerList = customerList.filter((c) => isActiveBook(c.id));

  // ─── By category ────────────────────────────────────────────────────
  // Past customers are kept in this aggregate because the chart's job is
  // to show the *whole* portfolio composition (including the past-state
  // tail).  The other active-book aggregates below drop them.
  const byCategoryAgg = new Map<string, { count: number; arr: number }>();
  for (const c of customerList) {
    const cat = categoryByC.get(c.id) ?? "Active";
    const prev = byCategoryAgg.get(cat) ?? { count: 0, arr: 0 };
    prev.count++;
    prev.arr += arrFor(c.id);
    byCategoryAgg.set(cat, prev);
  }
  const by_category = [...byCategoryAgg.entries()].map(([category, v]) => ({ category, ...v }));

  // ─── By AE ──────────────────────────────────────────────────────────
  // Build the aggregate + the drill-down list in one pass.  Drill-down rows
  // are slim DrillDownCustomer objects keyed by AE name; the panel renders
  // an inline-edit dropdown to reassign the AE.  Past-state customers are
  // excluded — a churned customer doesn't add to anyone's workload.
  const byAeAgg = new Map<string, { count: number; arr: number }>();
  const by_ae_items: Record<string, DrillDownCustomer[]> = {};
  for (const c of activeCustomerList) {
    const ae = c.ae_owner ?? "(unassigned)";
    const prev = byAeAgg.get(ae) ?? { count: 0, arr: 0 };
    prev.count++;
    prev.arr += arrFor(c.id);
    byAeAgg.set(ae, prev);

    const profile = profileByC.get(c.id);
    (by_ae_items[ae] ??= []).push({
      id: c.id,
      key: c.key,
      display_name: c.display_name,
      partner: c.partner,
      custom_category: c.custom_category,
      lifecycle_group: c.lifecycle_group,
      arr: profile?.arr ?? 0,
      renewal_date: profile?.renewal_date ?? null,
    });
  }
  for (const list of Object.values(by_ae_items)) {
    list.sort((a, b) => b.arr - a.arr);
  }
  const by_ae = [...byAeAgg.entries()]
    .map(([ae, v]) => ({ ae, ...v }))
    .sort((a, b) => b.count - a.count);

  // ─── By partner ─────────────────────────────────────────────────────
  // Same filter — partner workload is an active-book metric.
  const byPartnerAgg = new Map<string, { count: number; arr: number }>();
  for (const c of activeCustomerList) {
    const p = c.partner ?? "Direct";
    const prev = byPartnerAgg.get(p) ?? { count: 0, arr: 0 };
    prev.count++;
    prev.arr += arrFor(c.id);
    byPartnerAgg.set(p, prev);
  }
  const by_partner = [...byPartnerAgg.entries()]
    .map(([partner, v]) => ({ partner, ...v }))
    .sort((a, b) => b.count - a.count);

  // ─── Projects by group / status / phase ─────────────────────────────
  const projGroupAgg = new Map<string, number>();
  const projStatusAgg = new Map<string, number>();
  const projPhaseAgg = new Map<string, number>();
  // Single FDE workload aggregate — Monday still surfaces two columns
  // (delivery + engineering), but for "1 single flow" we merge both into
  // one roster and count each unique person once per project.
  const fdeAgg = new Map<string, number>();
  const ttvBuckets = new Map<string, number>();
  const ttvByQtrAgg = new Map<string, { sum: number; count: number }>();

  // Drill-down item maps populated in the same loop as the aggregates.
  // Keys mirror the chart's bar labels exactly so a click can look up
  // the underlying rows in O(1).
  const by_fde_items: Record<string, DrillDownProject[]> = {};
  const projects_by_lifecycle_items: Record<string, DrillDownProject[]> = {};

  // Dedupe two comma-separated people strings into one sorted list.
  function unionPeople(...sources: Array<string | null>): string[] {
    const seen = new Set<string>();
    for (const src of sources) {
      for (const name of peopleNames(src)) seen.add(name);
    }
    return Array.from(seen);
  }

  function toDrillDownProject(p: ProjectRow): DrillDownProject {
    const cust = customerById.get(p.customer_id);
    return {
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
      fiscal_year: p.fiscal_year,
      group_title: p.group_title,
      status: txt(p.raw_columns, PROJECT_COL_STATUS),
      health: txt(p.raw_columns, MONDAY_PROJECT_COLS.health),
      phase: txt(p.raw_columns, PROJECT_COL_PHASE),
      platform: txt(p.raw_columns, MONDAY_PROJECT_COLS.platform),
      fde: unionPeople(
        txt(p.raw_columns, PROJECT_COL_TAM),
        txt(p.raw_columns, PROJECT_COL_DEV),
      ),
      go_live_date: p.go_live_date ?? txt(p.raw_columns, PROJECT_COL_GOLIVE),
      kickoff_date: p.kickoff_date ?? txt(p.raw_columns, MONDAY_PROJECT_COLS.kickoff_date),
    };
  }

  // People-extraction + placeholder filtering live in lib/delivery/taxonomy.ts
  // so the analytics loader, weekly report, and operations chat all read
  // from the same canonical rule.  See `peopleNames` / `isPlaceholderName`.

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

  // Placeholder filter happens inside peopleNames() — see taxonomy.ts.
  function cleanWorkloadNames(raw: string | null): string[] {
    return peopleNames(raw);
  }

  for (const p of projectList) {
    const g = p.group_title ?? "(other)";
    projGroupAgg.set(g, (projGroupAgg.get(g) ?? 0) + 1);
    const s = txt(p.raw_columns, PROJECT_COL_STATUS) ?? "(unset)";
    projStatusAgg.set(s, (projStatusAgg.get(s) ?? 0) + 1);
    const ph = txt(p.raw_columns, PROJECT_COL_PHASE) ?? "(unset)";
    projPhaseAgg.set(ph, (projPhaseAgg.get(ph) ?? 0) + 1);

    // Stage drill-down: every project gets a slot under its group_title so
    // the "Projects by stage" chart click yields the matching project list.
    (projects_by_lifecycle_items[g] ??= []).push(toDrillDownProject(p));

    // FDE workload — counted on active projects only, deduped so a person
    // who's on both the delivery and engineering Monday columns for the
    // same project counts once (not twice).
    if (isActiveProject(p)) {
      const ddProject = toDrillDownProject(p);
      const tamNames = cleanWorkloadNames(txt(p.raw_columns, PROJECT_COL_TAM));
      const devNames = cleanWorkloadNames(txt(p.raw_columns, PROJECT_COL_DEV));
      const fdeNames = new Set<string>([...tamNames, ...devNames]);
      for (const name of fdeNames) {
        fdeAgg.set(name, (fdeAgg.get(name) ?? 0) + 1);
        (by_fde_items[name] ??= []).push(ddProject);
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

  const by_fde = [...fdeAgg.entries()]
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
      // Active-book count — excludes Churned / Dropped / Past so the
      // dashboard headline isn't inflated by historical accounts.
      customers: activeCustomerIds.size,
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
    by_fde,
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
    drilldowns: {
      by_fde_items,
      projects_by_lifecycle_items,
      by_ae_items,
    },
    last_sync: {
      salesforce: (lastSf.data as { finished_at: string } | null)?.finished_at ?? null,
      monday: (lastMon.data as { finished_at: string } | null)?.finished_at ?? null,
    },
  };
}
