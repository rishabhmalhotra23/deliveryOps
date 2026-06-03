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
import { loadV2Migrations, type V2Migration } from "@/lib/reports/v2-migrations";

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

// ─── Platform + value modelling ───────────────────────────────────────────────
// Live projects are bucketed by the Monday "Development Platform" column.
// Order matters: the "migrating"/"testing" labels contain the substrings
// "v1"/"v2", so they must be matched before the bare V1/V2 cases.
export type PlatformBucket = "v1" | "v2" | "testing_v2" | "migrating" | "custom" | "unknown";
export function platformBucket(raw: string | null | undefined): PlatformBucket {
  const t = (raw ?? "").toLowerCase().trim();
  if (!t) return "unknown";
  if (t.includes("migrat")) return "migrating";    // "Live in V1; Migrating to V2"
  if (t.includes("testing")) return "testing_v2";  // "Currently in V1; Testing in V2"
  if (t.includes("custom")) return "custom";       // "Custom Solution"
  if (t === "v2") return "v2";
  if (t === "v1") return "v1";
  return "unknown";
}

// Map a Monday "Current Phase" value to a coarse migration stage for the
// weekly report's V2 migration tracker.
export function migrationStage(phase: string | null | undefined): string {
  const p = (phase ?? "").toLowerCase();
  if (p.includes("m1") || p.includes("discovery") || p.includes("pre-kickoff")) return "Discovery";
  if (p.includes("m2") || p.includes("development")) return "Development";
  if (p.includes("m3") || p.includes("testing") || p.includes("uat") || p.includes("exception") || p.includes("support") || p.includes("production")) return "Testing";
  return "Development";
}

// Modelled value assumptions. Annual hours saved per live automation by
// complexity tier, anchored below the deck's modal 3,300 hr figure so the
// estimate stays conservative. Blended loaded labour rate back-solved from
// customer-reported $/hour figures. These are ESTIMATES — clearly labelled in
// the UI — and get replaced once Kognitos platform run data is connected.
const TIER_HOURS: Record<string, number> = { low: 1200, medium: 2600, high: 5200 };
const RATE_LOW = 30, RATE_MID = 35, RATE_HIGH = 45;
const HOURS_PER_FTE = 2080;
function tierHours(complexity: string | null | undefined): number {
  return TIER_HOURS[(complexity ?? "").toLowerCase()] ?? TIER_HOURS.medium;
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
  /** Monday "Development Platform" raw text (V1 / V2 / migrating / testing / custom). */
  platform: string | null;
  /** Monday "Migration" status: "v2" / "Migrating to v2" / "Upcoming Migration". */
  migration: string | null;
  /** Monday "Complexity" dropdown (Low / Medium / High) — drives modelled value. */
  complexity: string | null;
  go_live_date: string | null;
  kickoff_date: string | null;
  latest_update: string | null;
  ttv_days: number | null;
  /** Combined FDE roster — union of Monday's delivery + engineering columns,
   *  deduped.  Was previously `tam` + `dev`; collapsed into one list as part
   *  of the "1 single flow" simplification. */
  fde: string[];
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

export interface WorkloadEntry {
  person: string;
  /** Total active projects assigned to this person (sum of the three below). */
  active: number;
  on_track: number;
  at_risk: number;
  /** Projects where Health is empty / unset — surfaced separately so the
   *  chart doesn't quietly classify "no data" as "on track". */
  other: number;
  /** Slim project list for the tooltip — name + customer + health each. */
  projects: Array<{
    name: string;
    customer: string;
    health: string | null;
  }>;
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
    /** Live projects split by Monday Development Platform column. */
    platform: Record<PlatformBucket, number>;
    /** Modelled value of the live portfolio (estimate — see TIER_HOURS notes). */
    value: {
      annual_hours: number;
      fte: number;
      value_low: number;
      value_mid: number;
      value_high: number;
    };
    /** V2 transition snapshot from the active board's Migration column.
     *  Placeholder for the fuller week-on-week migration tracker coming later. */
    v2_progress: {
      live: number;       // already live on V2 (from platform mix)
      in_dev: number;     // active, built natively on V2 (migration = "v2")
      migrating: number;  // active, migrating v1 → v2 (migration = "Migrating to v2")
      upcoming: number;   // queued for migration (migration = "Upcoming Migration")
    };
  };
  /** Per-FDE workload — active in-flight projects with a health
   *  breakdown so the chart can stack On Track / At Risk / Other.
   *  Each person counts once per project even if Monday lists them on
   *  both the delivery and engineering columns. */
  workload_fde: WorkloadEntry[];
  nps_this_quarter: { quarter: string; average: number; count: number } | null;
  /** Active customer-process migrations from Kognitos v1 → v2.  Curated
   *  list today (see lib/reports/v2-migrations.ts); will move to a
   *  Monday column once Rishabh adds it to the Customers board. */
  v2_migrations: V2Migration[];

  /** Processes currently migrating v1 → v2 (the weekly report's focus list). */
  v2_migration_list: Array<{ customer: string; process: string; stage: string; fde: string[] }>;
  /** Full portfolio waterfall over every project card (see loader rules). */
  portfolio: {
    total_cards: number;
    live: { v1: number; v2: number; total: number };
    in_dev: { v1: number; v2: number; custom: number; total: number };
    migrating: number;
    upcoming: number;
    on_hold: number;
    backlog: number;
    not_in_prod: { cancelled: number; churned: number; retired: number; pov: number; total: number };
    enhancements: number;
  };

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

  const [projectsRes, customersRes, npsRes, lastSyncRes, v2Migrations] = await Promise.all([
    sb.from("monday_projects")
      .select("monday_item_id, name, group_title, customer_id, fiscal_year, go_live_date, kickoff_date, latest_update, raw_columns")
      .limit(2000),
    sb.from("customers").select("id, key, display_name, custom_category, lifecycle_group").is("deleted_at", null),
    sb.from("monday_nps_responses").select("raw_columns"),
    sb.from("sync_runs").select("finished_at").eq("source", "monday").eq("status", "ok")
      .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    loadV2Migrations().catch(() => [] as V2Migration[]),
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
    const fdeSeen = new Set<string>();
    for (const name of peopleNames(colText(cols, PCOLS.tam))) fdeSeen.add(name);
    for (const name of peopleNames(colText(cols, PCOLS.dev))) fdeSeen.add(name);
    projects.push({
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_display_name: cust.display_name,
      customer_category: categoryFromCustomer({ custom_category: cust.custom_category, lifecycle_group: cust.lifecycle_group }),
      status, phase,
      phase_group: phaseGroup(phase, status),
      platform: colText(cols, PCOLS.platform),
      migration: colText(cols, PCOLS.migration),
      complexity: colText(cols, PCOLS.complexity),
      health: colText(cols, PCOLS.health),
      go_live_date: go,
      kickoff_date: p.kickoff_date,
      latest_update: p.latest_update,
      ttv_days: ttvDays(p.kickoff_date, go),
      fde: Array.from(fdeSeen),
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

  // Platform mix + modelled value of the live portfolio.
  const platformMix: Record<PlatformBucket, number> = {
    v1: 0, v2: 0, testing_v2: 0, migrating: 0, custom: 0, unknown: 0,
  };
  let liveHours = 0;
  for (const p of deliveredAll) {
    // Exclude enhancements so the platform mix and modelled value line up with
    // the portfolio "live" count (enhancements are effort, not live processes).
    const isEnh = p.name.toLowerCase().includes("enhancement") || (p.phase ?? "").toLowerCase() === "enhancement";
    if (isEnh) continue;
    platformMix[platformBucket(p.platform)]++;
    liveHours += tierHours(p.complexity);
  }
  const liveValue = {
    annual_hours: liveHours,
    fte: Math.round(liveHours / HOURS_PER_FTE),
    value_low: Math.round(liveHours * RATE_LOW),
    value_mid: Math.round(liveHours * RATE_MID),
    value_high: Math.round(liveHours * RATE_HIGH),
  };

  // V2 transition snapshot. "Live" comes from the platform mix above; the
  // in-flight counts come from the active board's Migration column.
  const v2Progress = { live: platformMix.v2, in_dev: 0, migrating: 0, upcoming: 0 };
  for (const p of allActiveBoardProjects) {
    const m = (p.migration ?? "").toLowerCase();
    if (m === "v2") v2Progress.in_dev++;
    else if (m.includes("migrating")) v2Progress.migrating++;
    else if (m.includes("upcoming")) v2Progress.upcoming++;
  }
  const v2_migration_list = allActiveBoardProjects
    .filter((p) => (p.migration ?? "").toLowerCase().includes("migrating"))
    .map((p) => ({ customer: p.customer_display_name, process: p.name, stage: migrationStage(p.phase), fde: p.fde }))
    .sort((a, b) => a.customer.localeCompare(b.customer));

  // ── Portfolio overview — the full waterfall over every project card ───────
  // Rules (signed off 2026-06): enhancements/CRs are pulled OUT of the project
  // count and reported separately; v1 and v2 versions are counted as separate
  // projects (a v2 migration is a new build); cancelled / churned / retired /
  // lapsed POVs collapse into one "not in production" bucket.
  const portfolio = {
    total_cards: 0,                                   // excludes enhancements
    live: { v1: 0, v2: 0, total: 0 },
    in_dev: { v1: 0, v2: 0, custom: 0, total: 0 },
    migrating: 0,
    upcoming: 0,
    on_hold: 0,
    backlog: 0,
    not_in_prod: { cancelled: 0, churned: 0, retired: 0, pov: 0, total: 0 },
    enhancements: 0,                                  // shown separately
  };
  for (const p of projects) {
    const nm = p.name.toLowerCase();
    const ph = (p.phase ?? "").toLowerCase();
    const mig = (p.migration ?? "").toLowerCase();
    if (nm.includes("enhancement") || ph === "enhancement") { portfolio.enhancements++; continue; }
    portfolio.total_cards++;
    if (isDelivered(p.status, p.group_title)) {
      if (platformBucket(p.platform) === "v2") portfolio.live.v2++; else portfolio.live.v1++;
      portfolio.live.total++;
      continue;
    }
    if (isActiveBoard({ fiscal_year: p.fiscal_year, status: p.status, group_title: p.group_title })) {
      if (mig.includes("migrating")) { portfolio.migrating++; continue; }
      if (mig.includes("upcoming")) { portfolio.upcoming++; continue; }
      const fg = flightGroup(p.group_title);
      if (fg === "in_progress") {
        const pl = platformBucket(p.platform);
        if (pl === "v2") portfolio.in_dev.v2++;
        else if ((p.platform ?? "").toLowerCase().includes("custom")) portfolio.in_dev.custom++;
        else portfolio.in_dev.v1++;
        portfolio.in_dev.total++;
      } else if (fg === "on_hold") portfolio.on_hold++;
      else portfolio.backlog++;
      continue;
    }
    // Not in production (discontinued)
    portfolio.not_in_prod.total++;
    if (ph.includes("churn")) portfolio.not_in_prod.churned++;
    else if (ph.includes("cancel") || (p.status ?? "").toLowerCase() === "cancelled") portfolio.not_in_prod.cancelled++;
    else if (ph.includes("pov")) portfolio.not_in_prod.pov++;
    else portfolio.not_in_prod.retired++;
  }

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

  // ── FDE workload (snapshot, in-progress group only) ──────────────────────
  // Aggregates per-person with a health breakdown so the chart can show
  // stacked bars (On Track / At Risk / Other). Also captures the project
  // list per person — the chart tooltip surfaces the actual names so the
  // "who's overloaded" question is followed naturally by "with what?".
  type WorkloadAgg = {
    on_track: number;
    at_risk: number;
    other: number;
    projects: WorkloadEntry["projects"];
  };
  const blankAgg = (): WorkloadAgg => ({ on_track: 0, at_risk: 0, other: 0, projects: [] });
  const fdeAggMap = new Map<string, WorkloadAgg>();

  function addToWorkload(map: Map<string, WorkloadAgg>, name: string, p: WeeklyProject) {
    const agg = map.get(name) ?? blankAgg();
    const h = (p.health ?? "").toLowerCase();
    if (h === "on track" || h === "healthy") agg.on_track++;
    else if (isAtRisk(p.health)) agg.at_risk++;
    else agg.other++;
    agg.projects.push({
      name: p.name,
      customer: p.customer_display_name,
      health: p.health,
    });
    map.set(name, agg);
  }

  for (const p of activeGroupProjects) {
    for (const name of p.fde) addToWorkload(fdeAggMap, name, p);
  }

  const workload_fde: WorkloadEntry[] = [...fdeAggMap.entries()]
    .map(([person, agg]) => ({
      person,
      active: agg.on_track + agg.at_risk + agg.other,
      on_track: agg.on_track,
      at_risk: agg.at_risk,
      other: agg.other,
      projects: agg.projects,
    }))
    .sort((a, b) => {
      // Primary sort: most loaded first.  Secondary sort: more at-risk
      // work bubbles up among ties so the urgent column is visible.
      if (b.active !== a.active) return b.active - a.active;
      return b.at_risk - a.at_risk;
    });

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
    // In-flight ordering: In progress → Pipeline → On hold → Backlog,
    // then alphabetical within each group.  The team scans the active work
    // top-down — burying it under alphabetical sort hid it.
    all_active_board: allActiveBoardProjects.slice().sort((a, b) => {
      const order = { in_progress: 0, pipeline: 1, on_hold: 2, backlog: 3 } as const;
      const aRank = order[flightGroup(a.group_title)];
      const bRank = order[flightGroup(b.group_title)];
      if (aRank !== bRank) return aRank - bRank;
      return a.customer_display_name < b.customer_display_name ? -1 : 1;
    }),
    at_risk: atRisk,
    flight_breakdown,
    by_phase,
    in_prod: {
      projects: deliveredAll.length, customers: prodCustomers.size,
      this_quarter: thisQCount, this_q_label: thisQ.label,
      last_quarter: lastQCount, last_q_label: lastQ.label,
      platform: platformMix,
      value: liveValue,
      v2_progress: v2Progress,
    },
    v2_migration_list,
    portfolio,
    workload_fde,
    nps_this_quarter,
    v2_migrations: v2Migrations,
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
