// Weekly Delivery Update — data loader.
// All taxonomy (column IDs, phase classification, isDelivered/isAtRisk,
// group buckets, FY quarter math, people parsing) lives in lib/delivery/taxonomy.

import { requireAdmin } from "@/lib/supabase/server";
import { categoryFromCustomer } from "@/app/_components/brand";
import {
  MONDAY_PROJECT_COLS as PCOLS, MONDAY_NPS_COLS as NCOLS,
  colText, type RawCols,
  isDelivered, isAtRisk, isActiveBoard, flightGroup,
  phaseGroup, type PhaseGroup,
  peopleNames, ttvDays,
  kognitosFYQuarter, previousKognitosFYQuarter,
} from "@/lib/delivery/taxonomy";

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mondayLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function currentNpsQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${q}Q${String(now.getUTCFullYear()).slice(2)}`;
}

// ─── Public types ─────────────────────────────────────────────────────────────

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
  in_progress: number;
  pipeline: number;
  on_hold: number;
  backlog: number;
}

export interface WeeklyBundle {
  week_label: string;
  generated_at: string;
  shipped_last_week: WeeklyProject[];
  in_uat: WeeklyProject[];
  active_projects: WeeklyProject[];   // "in_progress" group only
  all_active_board: WeeklyProject[];  // all non-delivered active board rows
  at_risk: WeeklyProject[];
  flight_breakdown: FlightBreakdown;
  by_phase: Record<PhaseGroup, number>;
  wow_trend: Array<{ week: string; count: number }>;
  in_prod: {
    projects: number;
    customers: number;
    this_quarter: number;
    this_q_label: string;
    last_quarter: number;
    last_q_label: string;
  };
  workload_tam: Array<{ person: string; active: number }>;
  workload_dev: Array<{ person: string; active: number }>;
  nps_this_quarter: { quarter: string; average: number; count: number } | null;
  totals: {
    shipped_last_week: number;
    in_flight_active: number;
    in_flight_total: number;
    at_risk: number;
    in_uat: number;
    delivered_all_time: number;
  };
  last_sync: string | null;
}

export async function loadWeeklyBundle(): Promise<WeeklyBundle> {
  const sb = requireAdmin();
  const now = new Date();

  // Rolling 7-day window (not calendar week).
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
    latest_update: string | null; raw_columns: RawCols;
  };

  const custMap = new Map<string, CustomerRow>();
  for (const c of (customersRes.data as CustomerRow[] | null) ?? []) custMap.set(c.id, c);

  const projects: WeeklyProject[] = [];
  for (const p of (projectsRes.data as ProjectRow[] | null) ?? []) {
    const cust = custMap.get(p.customer_id);
    if (!cust) continue;
    const cols = p.raw_columns;
    const status = colText(cols, PCOLS.status);
    const phase  = colText(cols, PCOLS.phase);
    const go = p.go_live_date ?? colText(cols, PCOLS.go_live_date);
    projects.push({
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_display_name: cust.display_name,
      customer_category: categoryFromCustomer({ custom_category: cust.custom_category, lifecycle_group: cust.lifecycle_group }),
      status, phase,
      phase_group: phaseGroup(phase, status),
      health: colText(cols, PCOLS.health),
      go_live_date: go,
      kickoff_date: p.kickoff_date,
      latest_update: p.latest_update,
      ttv_days: ttvDays(p.kickoff_date, go),
      tam: peopleNames(colText(cols, PCOLS.tam)),
      dev: peopleNames(colText(cols, PCOLS.dev)),
      fiscal_year: p.fiscal_year,
      group_title: p.group_title,
    });
  }

  // ── Active board subset ───────────────────────────────────────────────────
  const allActiveBoardProjects = projects.filter((p) =>
    isActiveBoard({ fiscal_year: p.fiscal_year, status: p.status, group_title: p.group_title })
  );
  const activeGroupProjects = allActiveBoardProjects.filter(
    (p) => flightGroup(p.group_title) === "in_progress"
  );

  // ── Shipped last 7 days ───────────────────────────────────────────────────
  const shippedLastWeek = projects
    .filter((p) => {
      if (!isDelivered(p.status, p.group_title)) return false;
      const d = parseDate(p.go_live_date);
      return d !== null && d >= sevenDaysAgo && d <= now;
    })
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  // ── UAT (active group, UAT phase) ─────────────────────────────────────────
  const inUat = activeGroupProjects
    .filter((p) => p.phase_group === "uat")
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  // ── At risk (any active board project) ────────────────────────────────────
  const atRisk = allActiveBoardProjects.filter((p) => isAtRisk(p.health));

  // ── Flight group breakdown ────────────────────────────────────────────────
  const flight_breakdown: FlightBreakdown = { in_progress: 0, pipeline: 0, on_hold: 0, backlog: 0 };
  for (const p of allActiveBoardProjects) flight_breakdown[flightGroup(p.group_title)]++;

  // ── Phase breakdown (active group only) ───────────────────────────────────
  const by_phase: Record<PhaseGroup, number> = { discovery: 0, dev: 0, uat: 0, waiting: 0, support: 0, live: 0, other: 0 };
  for (const p of activeGroupProjects) by_phase[p.phase_group]++;

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
    if (!isDelivered(p.status, p.group_title)) continue;
    const d = parseDate(p.go_live_date);
    if (!d || d < tenWeeksAgo) continue;
    const key = mondayLabel(d);
    weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
  }
  const wow_trend = Array.from(weekMap.entries()).map(([week, count]) => ({ week, count }));

  // ── In-production stats (Kognitos FY quarters) ────────────────────────────
  const thisQ = kognitosFYQuarter(now);
  const lastQ = previousKognitosFYQuarter(thisQ);
  const deliveredAll = projects.filter((p) => isDelivered(p.status, p.group_title));
  const prodCustomers = new Set(deliveredAll.map((p) => p.customer_display_name));
  const thisQCount = deliveredAll.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= thisQ.start && d <= thisQ.end;
  }).length;
  const lastQCount = deliveredAll.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= lastQ.start && d <= lastQ.end;
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

  // ── NPS this quarter ──────────────────────────────────────────────────────
  type NpsRow = { raw_columns: RawCols };
  const currQ = currentNpsQuarterLabel();
  const npsScores: number[] = [];
  for (const n of (npsRes.data as NpsRow[] | null) ?? []) {
    if ((n.raw_columns?.[NCOLS.quarter]?.text ?? "").trim() !== currQ) continue;
    const s = Number(n.raw_columns?.[NCOLS.score]?.text ?? "");
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
    in_prod: {
      projects: deliveredAll.length,
      customers: prodCustomers.size,
      this_quarter: thisQCount, this_q_label: thisQ.label,
      last_quarter: lastQCount, last_q_label: lastQ.label,
    },
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

export type { PhaseGroup };
