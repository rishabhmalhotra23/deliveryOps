// Delivery Report — data loader.
//
// Accepts an arbitrary date range. Sections are split into:
//   - Range-bound: shipped_in_range, delivery_trend (uses the selected range)
//   - Snapshot:    in_flight / in_uat / at_risk (always "right now" — these
//                  represent the current state, not historical)
//   - Quarter:     in_prod (Kognitos FY quarter math, range-independent)
//
// All taxonomy (column IDs, phase classification, classifiers, FY math,
// people parsing) lives in lib/delivery/taxonomy.ts.

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

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Monday at 00:00 UTC of the week containing the given date.
function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

// Calendar month start at 00:00 UTC.
function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function currentNpsQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${q}Q${String(now.getUTCFullYear()).slice(2)}`;
}

// ─── Range presets ────────────────────────────────────────────────────────────

export type RangePreset = "week" | "month" | "quarter" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
  preset: RangePreset;
  label: string;       // "May 9 – May 15, 2026"
  cadenceLabel: string; // "Weekly" | "Monthly" | "Quarterly" | "Custom"
}

export interface RangeRequest {
  preset?: RangePreset;
  from?: string; // ISO date
  to?: string;
}

// Snap a date to midnight UTC so go-live dates (which Monday stores as
// date-only and parse to 00:00 UTC) are always >= the range start.
function startOfDayUTC(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function resolveRange(req: RangeRequest = {}, now: Date = new Date()): DateRange {
  // Custom range: needs both from + to to be valid.
  if (req.preset === "custom" && req.from && req.to) {
    const start = startOfDayUTC(new Date(req.from));
    const end = new Date(req.to);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      end.setUTCHours(23, 59, 59, 999);
      return { start, end, preset: "custom", label: `${fmtShort(start)} – ${fmtShort(end)}, ${end.getUTCFullYear()}`, cadenceLabel: "Custom" };
    }
  }

  if (req.preset === "month") {
    const start = startOfDayUTC(new Date(now));
    start.setUTCDate(start.getUTCDate() - 30);
    return { start, end: now, preset: "month", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Monthly" };
  }

  if (req.preset === "quarter") {
    const start = startOfDayUTC(new Date(now));
    start.setUTCDate(start.getUTCDate() - 90);
    return { start, end: now, preset: "quarter", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Quarterly" };
  }

  // Default: rolling last 7 days, start snapped to midnight so a go-live
  // on the start day isn't excluded due to time-of-day mismatch.
  // Example: now = May 18 14:30 → start = May 11 00:00, so a project
  // with go_live_date "2026-05-11" (parses to May 11 00:00) is included.
  const start = startOfDayUTC(new Date(now));
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end: now, preset: "week", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Weekly" };
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
  dev: string[];   // FDE / engineering
  fiscal_year: string | null;
  group_title: string | null;
}

export interface FlightBreakdown {
  in_progress: number;
  pipeline: number;
  on_hold: number;
  backlog: number;
}

export interface DeliveryTrendBucket {
  bucket_label: string;   // "May 4" or "May" depending on bucket
  count: number;
}

// QoQ history — one entry per Kognitos FY quarter from the earliest
// go-live on record through the current quarter.
export interface QoQBucket {
  label: string;       // "Q4 FY25", "Q1 FY26" etc.
  delivered: number;
  avg_ttv_days: number | null;   // null when < 3 data points (too noisy)
  cumulative: number;  // running total of all go-lives
}

export interface WeeklyBundle {
  range: DateRange;
  generated_at: string;

  // Range-bound
  shipped_in_range: WeeklyProject[];
  delivery_trend: {
    bucket_kind: "weekly" | "monthly";
    data: DeliveryTrendBucket[];
  };

  // All-time QoQ chart + pipeline funnel
  qoq_history: QoQBucket[];
  pipeline_funnel: {
    discovery: number;
    dev: number;
    uat: number;
    waiting: number;
    delivered_all_time: number;   // running total for context
    unique_customers_served: number;
  };

  // Snapshots ("now")
  in_uat: WeeklyProject[];
  active_projects: WeeklyProject[];
  all_active_board: WeeklyProject[];
  at_risk: WeeklyProject[];
  flight_breakdown: FlightBreakdown;
  by_phase: Record<PhaseGroup, number>;

  // Quarter
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
    shipped_in_range: number;
    in_flight_active: number;
    in_flight_total: number;
    at_risk: number;
    in_uat: number;
    delivered_all_time: number;
  };
  last_sync: string | null;
}

export async function loadWeeklyBundle(req: RangeRequest = {}): Promise<WeeklyBundle> {
  const sb = requireAdmin();
  const now = new Date();
  const range = resolveRange(req, now);

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

  // ── Active board subsets ──────────────────────────────────────────────────
  const allActiveBoardProjects = projects.filter((p) =>
    isActiveBoard({ fiscal_year: p.fiscal_year, status: p.status, group_title: p.group_title })
  );
  const activeGroupProjects = allActiveBoardProjects.filter(
    (p) => flightGroup(p.group_title) === "in_progress"
  );

  // ── Shipped in range ──────────────────────────────────────────────────────
  const shippedInRange = projects
    .filter((p) => {
      if (!isDelivered(p.status, p.group_title)) return false;
      const d = parseDate(p.go_live_date);
      return d !== null && d >= range.start && d <= range.end;
    })
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  // ── UAT (snapshot) ────────────────────────────────────────────────────────
  const inUat = activeGroupProjects
    .filter((p) => p.phase_group === "uat")
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  // ── At risk (snapshot) ────────────────────────────────────────────────────
  const atRisk = allActiveBoardProjects.filter((p) => isAtRisk(p.health));

  // ── Flight breakdown (snapshot) ───────────────────────────────────────────
  const flight_breakdown: FlightBreakdown = { in_progress: 0, pipeline: 0, on_hold: 0, backlog: 0 };
  for (const p of allActiveBoardProjects) flight_breakdown[flightGroup(p.group_title)]++;

  // ── Phase breakdown (snapshot) ────────────────────────────────────────────
  const by_phase: Record<PhaseGroup, number> = { discovery: 0, dev: 0, uat: 0, waiting: 0, support: 0, live: 0, other: 0 };
  for (const p of activeGroupProjects) by_phase[p.phase_group]++;

  // ── Delivery trend ────────────────────────────────────────────────────────
  // Bucket size: weekly when range ≤ 90 days, monthly when > 90.
  // Trend window: ~3× the range, capped at 12 buckets, anchored to range.end.
  const rangeDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000));
  const useMonthly = rangeDays > 90;
  const bucketCount = 12;

  const trend: DeliveryTrendBucket[] = [];
  if (useMonthly) {
    // Last 12 calendar months ending in range.end
    const end = startOfMonth(range.end);
    end.setUTCMonth(end.getUTCMonth() + 1);
    for (let i = bucketCount - 1; i >= 0; i--) {
      const bStart = new Date(end);
      bStart.setUTCMonth(end.getUTCMonth() - i - 1);
      const bEnd = new Date(end);
      bEnd.setUTCMonth(end.getUTCMonth() - i);
      const count = projects.filter((p) => {
        if (!isDelivered(p.status, p.group_title)) return false;
        const d = parseDate(p.go_live_date);
        return d !== null && d >= bStart && d < bEnd;
      }).length;
      trend.push({
        bucket_label: bStart.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
        count,
      });
    }
  } else {
    // Last 12 weeks (Monday-aligned) ending in the week of range.end
    const lastMon = startOfIsoWeek(range.end);
    for (let i = bucketCount - 1; i >= 0; i--) {
      const bStart = new Date(lastMon);
      bStart.setUTCDate(lastMon.getUTCDate() - i * 7);
      const bEnd = new Date(bStart);
      bEnd.setUTCDate(bStart.getUTCDate() + 7);
      const count = projects.filter((p) => {
        if (!isDelivered(p.status, p.group_title)) return false;
        const d = parseDate(p.go_live_date);
        return d !== null && d >= bStart && d < bEnd;
      }).length;
      trend.push({
        bucket_label: fmtShort(bStart),
        count,
      });
    }
  }

  // ── In-production stats (Kognitos FY quarters, range-independent) ────────
  const thisQ = kognitosFYQuarter(now);
  const lastQ = previousKognitosFYQuarter(thisQ);
  const deliveredAll = projects.filter((p) => isDelivered(p.status, p.group_title));
  const prodCustomers = new Set(deliveredAll.map((p) => p.customer_display_name));

  // ── QoQ history ───────────────────────────────────────────────────────────
  // Build one entry per Kognitos FY quarter from the earliest go-live date
  // through the current quarter. Includes delivered count, avg TTV, and
  // a running cumulative total — tells the story of velocity over time.
  const qoq_history: QoQBucket[] = (() => {
    // Helper: Kognitos FY quarter label for a date
    function qLabel(d: Date): string {
      const m = d.getUTCMonth();
      const y = d.getUTCFullYear();
      if (m === 0)         return `Q4 FY${String(y - 1).slice(2)}`;
      if (m <= 3)          return `Q1 FY${String(y).slice(2)}`;
      if (m <= 6)          return `Q2 FY${String(y).slice(2)}`;
      if (m <= 9)          return `Q3 FY${String(y).slice(2)}`;
                           return `Q4 FY${String(y).slice(2)}`;
    }
    // Sort key for a label like "Q2 FY26" → numeric for ordering
    function qSortKey(label: string): number {
      const m = label.match(/Q(\d) FY(\d{2})/);
      if (!m) return 0;
      return Number(m[2]) * 4 + Number(m[1]);
    }

    // Aggregate delivered projects by quarter
    const byQ = new Map<string, { delivered: number; ttvDays: number[] }>();
    for (const p of deliveredAll) {
      const d = parseDate(p.go_live_date);
      if (!d) continue;
      const key = qLabel(d);
      const prev = byQ.get(key) ?? { delivered: 0, ttvDays: [] };
      prev.delivered++;
      if (p.ttv_days !== null && p.ttv_days > 0) prev.ttvDays.push(p.ttv_days);
      byQ.set(key, prev);
    }

    // Also include the current quarter even if 0 deliveries so it shows on chart
    const currentQLabel = qLabel(now);
    if (!byQ.has(currentQLabel)) byQ.set(currentQLabel, { delivered: 0, ttvDays: [] });

    const sorted = [...byQ.entries()].sort((a, b) => qSortKey(a[0]) - qSortKey(b[0]));

    let cumulative = 0;
    return sorted.map(([label, { delivered, ttvDays: ttvArr }]) => {
      cumulative += delivered;
      const avg_ttv_days = ttvArr.length >= 3
        ? Math.round(ttvArr.reduce((s, v) => s + v, 0) / ttvArr.length)
        : null;
      return { label, delivered, avg_ttv_days, cumulative };
    });
  })();

  // ── Pipeline funnel ───────────────────────────────────────────────────────
  // All active-board projects (snapshot), broken out by phase group, plus
  // the all-time delivered count and unique customers served for context.
  const pipeline_funnel = {
    discovery:  allActiveBoardProjects.filter((p) => p.phase_group === "discovery").length,
    dev:        allActiveBoardProjects.filter((p) => p.phase_group === "dev").length,
    uat:        allActiveBoardProjects.filter((p) => p.phase_group === "uat").length,
    waiting:    allActiveBoardProjects.filter((p) => p.phase_group === "waiting").length,
    delivered_all_time: deliveredAll.length,
    unique_customers_served: prodCustomers.size,
  };
  const thisQCount = deliveredAll.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= thisQ.start && d <= thisQ.end;
  }).length;
  const lastQCount = deliveredAll.filter((p) => {
    const d = parseDate(p.go_live_date);
    return d !== null && d >= lastQ.start && d <= lastQ.end;
  }).length;

  // ── Team workload (snapshot, in-progress group only) ─────────────────────
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
    range,
    generated_at: now.toISOString(),
    shipped_in_range: shippedInRange,
    delivery_trend: { bucket_kind: useMonthly ? "monthly" : "weekly", data: trend },
    qoq_history,
    pipeline_funnel,
    in_uat: inUat,
    active_projects: activeGroupProjects.sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1)),
    all_active_board: allActiveBoardProjects.sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1)),
    at_risk: atRisk,
    flight_breakdown,
    by_phase,
    in_prod: {
      projects: deliveredAll.length, customers: prodCustomers.size,
      this_quarter: thisQCount, this_q_label: thisQ.label,
      last_quarter: lastQCount, last_q_label: lastQ.label,
    },
    workload_tam,
    workload_dev,
    nps_this_quarter,
    totals: {
      shipped_in_range: shippedInRange.length,
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
