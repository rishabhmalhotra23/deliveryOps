// Weekly Delivery Update — data loader.

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
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function isDelivered(status: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "live" || s === "delivered";
}

// ── Kognitos phase classification ─────────────────────────────────────────────
// Actual phase values from Monday (from live data inspection):
//   "Pre-Kickoff", "M1 - Discovery", "M2 - Development",
//   "M3 - Testing/UAT", "M5 - Exception Handling",
//   "Customer Handling exceptions", "Waiting for Customer",
//   "POV complete, Waiting for next steps", "Support", "Enhancement"
export type PhaseGroup = "discovery" | "dev" | "uat" | "waiting" | "support" | "live" | "other";

export function phaseGroup(phase: string | null, status: string | null): PhaseGroup {
  if (isDelivered(status)) return "live";
  const p = (phase ?? "").toLowerCase();
  if (p.includes("m1") || p.includes("discovery") || p.includes("pre-kickoff") || p.includes("pre kickoff")) return "discovery";
  if (p.includes("m2") || p.includes("development") || p.includes("develop")) return "dev";
  if (p.includes("m3") || p.includes("m4") || p.includes("m5") || p.includes("uat") || p.includes("testing") || p.includes("exception")) return "uat";
  if (p.includes("waiting") || p.includes("pov complete") || p.includes("customer handling")) return "waiting";
  if (p.includes("support") || p.includes("enhancement")) return "support";
  return "other";
}

// ── Kognitos FY quarters ──────────────────────────────────────────────────────
// FY starts February 1: Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan
function kognitosFYQuarters(now: Date): {
  thisStart: Date; thisEnd: Date; thisLabel: string;
  prevStart: Date; prevEnd: Date; prevLabel: string;
} {
  const m = now.getUTCMonth(); // 0-11
  const y = now.getUTCFullYear();

  let qNum: number, qStart: Date, qEnd: Date, fyYear: number;
  if (m === 0) {                 // January → Q4
    qNum = 4; fyYear = y - 1;
    qStart = new Date(Date.UTC(y - 1, 10, 1));
    qEnd   = new Date(Date.UTC(y, 0, 31, 23, 59, 59));
  } else if (m <= 3) {           // Feb–Apr → Q1
    qNum = 1; fyYear = y;
    qStart = new Date(Date.UTC(y, 1, 1));
    qEnd   = new Date(Date.UTC(y, 3, 30, 23, 59, 59));
  } else if (m <= 6) {           // May–Jul → Q2
    qNum = 2; fyYear = y;
    qStart = new Date(Date.UTC(y, 4, 1));
    qEnd   = new Date(Date.UTC(y, 6, 31, 23, 59, 59));
  } else if (m <= 9) {           // Aug–Oct → Q3
    qNum = 3; fyYear = y;
    qStart = new Date(Date.UTC(y, 7, 1));
    qEnd   = new Date(Date.UTC(y, 9, 31, 23, 59, 59));
  } else {                       // Nov–Dec → Q4
    qNum = 4; fyYear = y;
    qStart = new Date(Date.UTC(y, 10, 1));
    qEnd   = new Date(Date.UTC(y + 1, 0, 31, 23, 59, 59));
  }
  const thisLabel = `Q${qNum} FY${String(fyYear).slice(2)}`;

  // Previous quarter
  let prevStart: Date, prevEnd: Date, prevQNum: number, prevFyYear: number;
  if (qNum === 1) {
    prevQNum = 4; prevFyYear = fyYear - 1;
    prevStart = new Date(Date.UTC(fyYear - 1, 10, 1));
    prevEnd   = new Date(Date.UTC(fyYear, 0, 31, 23, 59, 59));
  } else if (qNum === 2) {
    prevQNum = 1; prevFyYear = fyYear;
    prevStart = new Date(Date.UTC(fyYear, 1, 1));
    prevEnd   = new Date(Date.UTC(fyYear, 3, 30, 23, 59, 59));
  } else if (qNum === 3) {
    prevQNum = 2; prevFyYear = fyYear;
    prevStart = new Date(Date.UTC(fyYear, 4, 1));
    prevEnd   = new Date(Date.UTC(fyYear, 6, 31, 23, 59, 59));
  } else {
    prevQNum = 3; prevFyYear = fyYear;
    prevStart = new Date(Date.UTC(fyYear, 7, 1));
    prevEnd   = new Date(Date.UTC(fyYear, 9, 31, 23, 59, 59));
  }
  const prevLabel = `Q${prevQNum} FY${String(prevFyYear).slice(2)}`;

  return { thisStart: qStart, thisEnd: qEnd, thisLabel, prevStart, prevEnd, prevLabel };
}

// ── Week label: "May 12" = Monday of the week containing `date` ───────────────
function mondayLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // 1=Mon…7=Sun
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function currentQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${q}Q${String(now.getUTCFullYear()).slice(2)}`;
}

// ── Public types ──────────────────────────────────────────────────────────────

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
  group_title: string | null;
}

export interface FlightBreakdown {
  in_progress: number;   // "Active" group on the active board
  pipeline: number;      // "Pipeline" group
  on_hold: number;       // "On Hold" group
  backlog: number;       // "Backlog" group
}

export interface WeeklyBundle {
  week_label: string;
  generated_at: string;
  shipped_last_week: WeeklyProject[];     // go-live in last 7 days
  in_uat: WeeklyProject[];               // phase = uat on active board
  active_projects: WeeklyProject[];      // "Active" group only (truly in-progress)
  all_active_board: WeeklyProject[];     // all non-delivered active board rows
  at_risk: WeeklyProject[];
  flight_breakdown: FlightBreakdown;
  by_phase: Record<PhaseGroup, number>;  // phase breakdown for active group only
  wow_trend: Array<{ week: string; count: number }>;  // last 10 weeks
  in_prod: {
    projects: number;
    customers: number;
    this_quarter: number;
    this_q_label: string;   // "Q2 FY26"
    last_quarter: number;
    last_q_label: string;   // "Q1 FY26"
  };
  workload_tam: Array<{ person: string; active: number }>;
  workload_dev: Array<{ person: string; active: number }>;
  nps_this_quarter: { quarter: string; average: number; count: number } | null;
  totals: {
    shipped_last_week: number;
    in_flight_active: number;  // "Active" group only
    in_flight_total: number;   // entire active board
    at_risk: number;
    in_uat: number;
    delivered_all_time: number;
  };
  last_sync: string | null;
}

export async function loadWeeklyBundle(): Promise<WeeklyBundle> {
  const sb = requireAdmin();
  const now = new Date();

  // Rolling 7-day window (not calendar week) — captures work done in
  // the last 7 days regardless of where the calendar-week boundary falls.
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const weekLabel = (() => {
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${fmt(sevenDaysAgo)} – ${fmt(now)}, ${now.getUTCFullYear()}`;
  })();

  const [projectsRes, customersRes, npsRes, lastSyncRes] = await Promise.all([
    sb.from("monday_projects")
      .select("monday_item_id, name, group_title, customer_id, fiscal_year, go_live_date, kickoff_date, latest_update, raw_columns")
      .limit(2000),
    sb.from("customers").select("id, key, display_name, custom_category, lifecycle_group").is("deleted_at", null),
    sb.from("monday_nps_responses").select("raw_columns"),
    sb.from("sync_runs").select("finished_at").eq("source", "monday").eq("status", "ok")
      .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
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
      status, phase,
      phase_group: phaseGroup(phase, status),
      health: col(cols, PROJECT_COL_HEALTH),
      go_live_date: go,
      kickoff_date: p.kickoff_date,
      latest_update: p.latest_update,
      ttv_days: ttvDays(p.kickoff_date, go),
      tam: peopleName(col(cols, PROJECT_COL_TAM)),
      dev: peopleName(col(cols, PROJECT_COL_DEV)),
      fiscal_year: p.fiscal_year,
      group_title: p.group_title,
    });
  }

  // ── Active board subset ────────────────────────────────────────────────────
  // "active" fiscal_year = the live project tracking board (not historical FY boards)
  const allActiveBoardProjects = projects.filter(
    (p) => p.fiscal_year === "active" && !isDelivered(p.status)
  );
  // "Active" group within the active board = truly in-progress work
  const activeGroupProjects = allActiveBoardProjects.filter(
    (p) => (p.group_title ?? "").toLowerCase() === "active"
  );

  // ── Shipped last 7 days ────────────────────────────────────────────────────
  const shippedLastWeek = projects
    .filter((p) => {
      if (!isDelivered(p.status)) return false;
      const d = parseDate(p.go_live_date);
      return d !== null && d >= sevenDaysAgo && d <= now;
    })
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  // ── UAT (from active board Active group only) ─────────────────────────────
  const inUat = activeGroupProjects
    .filter((p) => p.phase_group === "uat")
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  // ── At risk (across all active board) ────────────────────────────────────
  const atRisk = allActiveBoardProjects.filter((p) => {
    const h = (p.health ?? "").toLowerCase();
    return h.includes("risk") || h === "off track" || h === "stuck";
  });

  // ── Flight breakdown by group ─────────────────────────────────────────────
  const flight_breakdown: FlightBreakdown = { in_progress: 0, pipeline: 0, on_hold: 0, backlog: 0 };
  for (const p of allActiveBoardProjects) {
    const g = (p.group_title ?? "").toLowerCase();
    if (g === "active") flight_breakdown.in_progress++;
    else if (g.includes("pipeline")) flight_breakdown.pipeline++;
    else if (g.includes("on hold") || g === "hold") flight_breakdown.on_hold++;
    else if (g.includes("backlog")) flight_breakdown.backlog++;
    else flight_breakdown.in_progress++; // default
  }

  // ── Phase breakdown (active group projects only) ──────────────────────────
  const by_phase: Record<PhaseGroup, number> = { discovery: 0, dev: 0, uat: 0, waiting: 0, support: 0, live: 0, other: 0 };
  for (const p of activeGroupProjects) {
    by_phase[p.phase_group]++;
  }

  // ── WoW trend — last 10 weeks ─────────────────────────────────────────────
  const weekMap = new Map<string, number>();
  for (let i = 9; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i * 7);
    weekMap.set(mondayLabel(d), 0);
  }
  const tenWeeksAgo = new Date(now);
  tenWeeksAgo.setDate(now.getDate() - 70);
  for (const p of projects) {
    if (!isDelivered(p.status)) continue;
    const d = parseDate(p.go_live_date);
    if (!d || d < tenWeeksAgo) continue;
    const key = mondayLabel(d);
    weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
  }
  const wow_trend = Array.from(weekMap.entries()).map(([week, count]) => ({ week, count }));

  // ── In-production stats (Kognitos FY quarters) ────────────────────────────
  const fy = kognitosFYQuarters(now);
  const deliveredAll = projects.filter((p) => isDelivered(p.status));
  const prodCustomers = new Set(deliveredAll.map((p) => p.customer_display_name));
  const thisQCount = deliveredAll.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= fy.thisStart && d <= fy.thisEnd;
  }).length;
  const lastQCount = deliveredAll.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= fy.prevStart && d <= fy.prevEnd;
  }).length;

  // ── Team workload (Active group only) ─────────────────────────────────────
  const tamAgg = new Map<string, number>();
  const devAgg = new Map<string, number>();
  for (const p of activeGroupProjects) {
    for (const name of p.tam) tamAgg.set(name, (tamAgg.get(name) ?? 0) + 1);
    for (const name of p.dev) devAgg.set(name, (devAgg.get(name) ?? 0) + 1);
  }
  const workload_tam = [...tamAgg.entries()].map(([person, active]) => ({ person, active })).sort((a, b) => b.active - a.active);
  const workload_dev = [...devAgg.entries()].map(([person, active]) => ({ person, active })).sort((a, b) => b.active - a.active);

  // ── NPS ───────────────────────────────────────────────────────────────────
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
    active_projects: activeGroupProjects.sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1)),
    all_active_board: allActiveBoardProjects.sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1)),
    at_risk: atRisk,
    flight_breakdown,
    by_phase,
    wow_trend,
    in_prod: { projects: deliveredAll.length, customers: prodCustomers.size, this_quarter: thisQCount, this_q_label: fy.thisLabel, last_quarter: lastQCount, last_q_label: fy.prevLabel },
    workload_tam,
    workload_dev,
    nps_this_quarter,
    totals: {
      shipped_last_week: shippedLastWeek.length,
      in_flight_active: activeGroupProjects.length,
      in_flight_total: allActiveBoardProjects.length,
      at_risk: atRisk.length,
      in_uat: inUat.length,
      delivered_all_time: deliveredAll.length,
    },
    last_sync: (lastSyncRes.data as { finished_at: string } | null)?.finished_at ?? null,
  };
}
