// Weekly Delivery Update — data loader.
//
// All data comes from monday_projects + monday_nps_responses + customers.
// No new schema required.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer } from "@/app/_components/brand";

const PROJECT_COL_STATUS  = "color_mkzj8fw8";
const PROJECT_COL_HEALTH  = "color_mm01ft4";
const PROJECT_COL_PHASE   = "color_mm06sdrj";
const PROJECT_COL_GOLIVE  = "date_mm01dz3b";
const PROJECT_COL_TAM     = "multiple_person_mkzrppyd";
const PROJECT_COL_DEV     = "multiple_person_mkzrgk3b";
const NPS_COL_SCORE       = "numeric_mm0aqvk3";
const NPS_COL_QUARTER     = "dropdown_mm0ahec7";

type RawCols = Record<string, { type: string; text: string | null; value: string | null }>;
function col(cols: RawCols | null, id: string): string | null {
  return cols?.[id]?.text?.trim() || null;
}

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ttvDays(kickoff: string | null, golive: string | null): number | null {
  const k = parseDate(kickoff);
  const g = parseDate(golive);
  if (!k || !g || g < k) return null;
  return Math.round((g.getTime() - k.getTime()) / 86_400_000);
}

function peopleName(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw.split(",").flatMap((s) => {
    const t = s.trim();
    if (!t) return [];
    if (t.includes("@")) {
      const local = t.split("@")[0].replace(/[._]/g, " ");
      const parts = local.split(" ").filter(Boolean);
      return parts.length >= 2
        ? [`${cap(parts[0])} ${parts[parts.length - 1][0]?.toUpperCase()}.`]
        : [cap(parts[0] ?? t)];
    }
    return [t];
  });
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isDelivered(status: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "live" || s === "delivered";
}

// Classify phase from Monday phase column text.
export type PhaseGroup = "discovery" | "dev" | "uat" | "live" | "other";
function phaseGroup(phase: string | null, status: string | null): PhaseGroup {
  const p = (phase ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (isDelivered(status)) return "live";
  if (p.includes("uat") || p.includes("test") || p.includes("qa")) return "uat";
  if (p.includes("dev") || p.includes("build") || p.includes("implement")) return "dev";
  if (p.includes("discover") || p.includes("plan") || p.includes("design") || p.includes("scoping")) return "discovery";
  // Fall back to status keywords
  if (s.includes("discover") || s.includes("plan")) return "discovery";
  if (s.includes("dev") || s.includes("build")) return "dev";
  if (s.includes("uat") || s.includes("test")) return "uat";
  return "other";
}

// ISO week label for WoW trend: "W20 (May 12)"
function isoWeekLabel(date: Date): string {
  // Simple week-of-year using the Monday-start convention
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const monOfWeek = new Date(date);
  monOfWeek.setUTCDate(date.getUTCDate() - (date.getUTCDay() || 7) + 1);
  const label = monOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `W${weekNo} (${label})`;
}

// "Last week" = the calendar Mon–Sun block that just completed.
function lastWeekWindow(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Sunday = 0; shift so Monday = 0
  const dayOfWeek = (todayUTC.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  const thisMon = new Date(todayUTC);
  thisMon.setUTCDate(todayUTC.getUTCDate() - dayOfWeek);
  const lastMon = new Date(thisMon);
  lastMon.setUTCDate(thisMon.getUTCDate() - 7);
  const lastSun = new Date(thisMon);
  lastSun.setUTCDate(thisMon.getUTCDate() - 1);
  lastSun.setUTCHours(23, 59, 59, 999);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const label = `${fmt(lastMon)} – ${fmt(lastSun)}, ${lastSun.getUTCFullYear()}`;
  return { start: lastMon, end: lastSun, label };
}

function currentQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${q}Q${String(now.getUTCFullYear()).slice(2)}`;
}

export interface WeeklyProject {
  monday_item_id: string;
  name: string;
  customer_display_name: string;
  customer_category: string;
  status: string | null;
  health: string | null;
  phase: string | null;
  phase_group: PhaseGroup;
  go_live_date: string | null;
  kickoff_date: string | null;
  latest_update: string | null;
  ttv_days: number | null;
  tam: string[];
  dev: string[];
  fiscal_year: string | null;
}

export interface WeeklyBundle {
  week_label: string;
  generated_at: string;
  // Delivery
  shipped_last_week: WeeklyProject[];
  in_uat: WeeklyProject[];         // replaces "upcoming 14d"
  in_flight: WeeklyProject[];      // all active (non-delivered) projects
  at_risk: WeeklyProject[];
  // Phase breakdown — counts of active (non-delivered) projects by phase
  by_phase: { discovery: number; dev: number; uat: number; other: number };
  // Week-on-week trend — last 10 weeks of go-lives
  wow_trend: Array<{ week: string; count: number }>;
  // In-production stats
  in_prod: {
    projects: number;             // all-time delivered
    customers: number;            // unique customers with ≥1 delivered project
    this_quarter: number;         // delivered in the current calendar quarter
    last_quarter: number;         // delivered in the previous calendar quarter
  };
  // Team workload (active)
  workload_tam: Array<{ person: string; active: number }>;
  workload_dev: Array<{ person: string; active: number }>;
  // NPS
  nps_this_quarter: { quarter: string; average: number; count: number } | null;
  totals: {
    shipped_last_week: number;
    in_flight: number;
    at_risk: number;
    in_uat: number;
    delivered_all_time: number;
  };
  last_sync: string | null;
}

export async function loadWeeklyBundle(): Promise<WeeklyBundle> {
  const sb = requireAdmin();

  const { start: weekStart, end: weekEnd, label: weekLabel } = lastWeekWindow();

  const [projectsRes, customersRes, npsRes, lastSyncRes] = await Promise.all([
    sb
      .from("monday_projects")
      .select(
        "monday_item_id, name, group_title, customer_id, fiscal_year, " +
        "go_live_date, kickoff_date, latest_update, raw_columns"
      )
      .limit(2000),
    sb
      .from("customers")
      .select("id, key, display_name, custom_category, lifecycle_group")
      .is("deleted_at", null),
    sb
      .from("monday_nps_responses")
      .select("raw_columns"),
    sb
      .from("sync_runs")
      .select("finished_at")
      .eq("source", "monday")
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  type CustomerRow = { id: string; key: string; display_name: string; custom_category: string | null; lifecycle_group: string | null };
  type ProjectRow = {
    monday_item_id: string; name: string; group_title: string | null; customer_id: string;
    fiscal_year: string | null; go_live_date: string | null; kickoff_date: string | null;
    latest_update: string | null; raw_columns: RawCols | null;
  };

  const custMap = new Map<string, CustomerRow>();
  for (const c of (customersRes.data as CustomerRow[] | null) ?? []) custMap.set(c.id, c);

  const projects: WeeklyProject[] = [];
  for (const p of (projectsRes.data as ProjectRow[] | null) ?? []) {
    const cust = custMap.get(p.customer_id);
    if (!cust) continue;
    const cols = p.raw_columns;
    const status = col(cols, PROJECT_COL_STATUS);
    const phase  = col(cols, PROJECT_COL_PHASE);
    const go = p.go_live_date ?? col(cols, PROJECT_COL_GOLIVE);
    projects.push({
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_display_name: cust.display_name,
      customer_category: categoryFromCustomer({ custom_category: cust.custom_category, lifecycle_group: cust.lifecycle_group }),
      status,
      health: col(cols, PROJECT_COL_HEALTH),
      phase,
      phase_group: phaseGroup(phase, status),
      go_live_date: go,
      kickoff_date: p.kickoff_date,
      latest_update: p.latest_update,
      ttv_days: ttvDays(p.kickoff_date, go),
      tam: peopleName(col(cols, PROJECT_COL_TAM)),
      dev: peopleName(col(cols, PROJECT_COL_DEV)),
      fiscal_year: p.fiscal_year,
    });
  }

  // ── Active project set ────────────────────────────────────────────────────
  const activeProjects = projects.filter((p) => {
    if (isDelivered(p.status)) return false;
    const fy = (p.fiscal_year ?? "").toLowerCase();
    const s  = (p.status ?? "").toLowerCase();
    return fy === "active" || s === "in progress" || s === "in-progress";
  });

  // ── Buckets ───────────────────────────────────────────────────────────────

  const shippedLastWeek = projects
    .filter((p) => {
      if (!isDelivered(p.status)) return false;
      const d = parseDate(p.go_live_date);
      return d !== null && d >= weekStart && d <= weekEnd;
    })
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  const inUat = activeProjects
    .filter((p) => p.phase_group === "uat")
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  const atRisk = activeProjects.filter((p) => {
    const h = (p.health ?? "").toLowerCase();
    return h.includes("risk") || h === "off track" || h === "stuck";
  });

  // ── Phase breakdown ───────────────────────────────────────────────────────
  const by_phase = { discovery: 0, dev: 0, uat: 0, other: 0 };
  for (const p of activeProjects) {
    const g = p.phase_group;
    if (g === "discovery") by_phase.discovery++;
    else if (g === "dev") by_phase.dev++;
    else if (g === "uat") by_phase.uat++;
    else by_phase.other++;
  }

  // ── Week-on-week trend (last 10 full weeks of go-lives) ───────────────────
  const now = new Date();
  const tenWeeksAgo = new Date(now);
  tenWeeksAgo.setDate(now.getDate() - 70);

  const weekMap = new Map<string, number>();
  // Pre-seed last 10 weeks so weeks with 0 deliveries still appear
  for (let i = 9; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i * 7);
    weekMap.set(isoWeekLabel(d), 0);
  }
  for (const p of projects) {
    if (!isDelivered(p.status)) continue;
    const d = parseDate(p.go_live_date);
    if (!d || d < tenWeeksAgo) continue;
    const key = isoWeekLabel(d);
    weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
  }
  const wow_trend = Array.from(weekMap.entries()).map(([week, count]) => ({ week, count }));

  // ── In-production stats ───────────────────────────────────────────────────
  const deliveredProjects = projects.filter((p) => isDelivered(p.status));
  const prodCustomers = new Set(deliveredProjects.map((p) => p.customer_display_name));

  // Current calendar quarter window
  const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const prevQStart = new Date(qStart);
  prevQStart.setUTCMonth(prevQStart.getUTCMonth() - 3);

  const thisQCount = deliveredProjects.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= qStart;
  }).length;
  const prevQCount = deliveredProjects.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= prevQStart && d < qStart;
  }).length;

  // ── Team workload ─────────────────────────────────────────────────────────
  const tamAgg = new Map<string, number>();
  const devAgg = new Map<string, number>();
  for (const p of activeProjects) {
    for (const name of p.tam) tamAgg.set(name, (tamAgg.get(name) ?? 0) + 1);
    for (const name of p.dev) devAgg.set(name, (devAgg.get(name) ?? 0) + 1);
  }
  const workload_tam = [...tamAgg.entries()].map(([person, active]) => ({ person, active })).sort((a, b) => b.active - a.active);
  const workload_dev = [...devAgg.entries()].map(([person, active]) => ({ person, active })).sort((a, b) => b.active - a.active);

  // ── NPS this quarter ──────────────────────────────────────────────────────
  type NpsRow = { raw_columns: RawCols | null };
  const currQ = currentQuarterLabel();
  const npsScores: number[] = [];
  for (const n of (npsRes.data as NpsRow[] | null) ?? []) {
    if ((n.raw_columns?.[NPS_COL_QUARTER]?.text ?? "").trim() !== currQ) continue;
    const s = Number(n.raw_columns?.[NPS_COL_SCORE]?.text ?? "");
    if (Number.isFinite(s)) npsScores.push(s);
  }
  const nps_this_quarter = npsScores.length > 0
    ? { quarter: currQ, average: Math.round((npsScores.reduce((a, b) => a + b, 0) / npsScores.length) * 10) / 10, count: npsScores.length }
    : null;

  return {
    week_label: weekLabel,
    generated_at: now.toISOString(),
    shipped_last_week: shippedLastWeek,
    in_uat: inUat,
    in_flight: activeProjects.sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1)),
    at_risk: atRisk,
    by_phase,
    wow_trend,
    in_prod: { projects: deliveredProjects.length, customers: prodCustomers.size, this_quarter: thisQCount, last_quarter: prevQCount },
    workload_tam,
    workload_dev,
    nps_this_quarter,
    totals: {
      shipped_last_week: shippedLastWeek.length,
      in_flight: activeProjects.length,
      at_risk: atRisk.length,
      in_uat: inUat.length,
      delivered_all_time: deliveredProjects.length,
    },
    last_sync: (lastSyncRes.data as { finished_at: string } | null)?.finished_at ?? null,
  };
}
