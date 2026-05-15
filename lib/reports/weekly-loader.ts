// Weekly Delivery Update — data loader.
// Aggregates what shipped, what's in flight, what's at risk, and what's due
// in the next 14 days. Intended for the Friday All Hands snapshot.
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

function daysFromNow(iso: string | null): number | null {
  const d = parseDate(iso);
  if (!d) return null;
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
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

// Current quarter label (e.g. "1Q26") for NPS filtering.
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
  go_live_date: string | null;
  kickoff_date: string | null;
  latest_update: string | null;
  ttv_days: number | null;
  days_until_live: number | null;
  tam: string[];
  dev: string[];
  fiscal_year: string | null;
}

export interface WeeklyBundle {
  week_label: string;           // "May 12 – May 18, 2026"
  generated_at: string;
  shipped_this_week: WeeklyProject[];
  in_flight: WeeklyProject[];
  at_risk: WeeklyProject[];
  upcoming_14d: WeeklyProject[];
  workload_tam: Array<{ person: string; active: number }>;
  workload_dev: Array<{ person: string; active: number }>;
  nps_this_quarter: { quarter: string; average: number; count: number } | null;
  totals: {
    shipped_this_week: number;
    in_flight: number;
    at_risk: number;
    upcoming_14d: number;
    delivered_all_time: number;
  };
  last_sync: string | null;
}

export async function loadWeeklyBundle(): Promise<WeeklyBundle> {
  const sb = requireAdmin();

  const now = new Date();

  // Week window: last 7 days and next 14 days.
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const in14d = new Date(now);
  in14d.setDate(in14d.getDate() + 14);

  const weekLabel = (() => {
    const start = new Date(weekAgo);
    const end = new Date(now);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${fmt(start)} – ${fmt(end)}, ${end.getUTCFullYear()}`;
  })();

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
  for (const c of (customersRes.data as CustomerRow[] | null) ?? []) {
    custMap.set(c.id, c);
  }

  const projects: WeeklyProject[] = [];
  for (const p of (projectsRes.data as ProjectRow[] | null) ?? []) {
    const cust = custMap.get(p.customer_id);
    if (!cust) continue;
    const cols = p.raw_columns;
    const status = col(cols, PROJECT_COL_STATUS);
    const health = col(cols, PROJECT_COL_HEALTH);
    const go = p.go_live_date ?? col(cols, PROJECT_COL_GOLIVE);
    projects.push({
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_display_name: cust.display_name,
      customer_category: categoryFromCustomer({ custom_category: cust.custom_category, lifecycle_group: cust.lifecycle_group }),
      status,
      health,
      phase: col(cols, PROJECT_COL_PHASE),
      go_live_date: go,
      kickoff_date: p.kickoff_date,
      latest_update: p.latest_update,
      ttv_days: ttvDays(p.kickoff_date, go),
      days_until_live: daysFromNow(go),
      tam: peopleName(col(cols, PROJECT_COL_TAM)),
      dev: peopleName(col(cols, PROJECT_COL_DEV)),
      fiscal_year: p.fiscal_year,
    });
  }

  // ── Buckets ──────────────────────────────────────────────────────────────

  const shippedThisWeek = projects
    .filter((p) => {
      if (!isDelivered(p.status)) return false;
      const d = parseDate(p.go_live_date);
      return d !== null && d >= weekAgo && d <= now;
    })
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  const inFlight = projects
    .filter((p) => {
      const s = (p.status ?? "").toLowerCase();
      const g = (p.fiscal_year ?? "").toLowerCase();
      const isActive = s === "in progress" || g === "active";
      return isActive && !isDelivered(p.status);
    })
    .sort((a, b) => (a.customer_display_name < b.customer_display_name ? -1 : 1));

  const atRisk = projects.filter((p) => {
    const h = (p.health ?? "").toLowerCase();
    return h.includes("risk") || h === "off track" || h === "stuck";
  });

  const upcoming14d = projects
    .filter((p) => {
      const days = p.days_until_live;
      return days !== null && days >= 0 && days <= 14 && !isDelivered(p.status);
    })
    .sort((a, b) => (a.days_until_live ?? 999) - (b.days_until_live ?? 999));

  // ── Team workload (active projects only) ────────────────────────────────

  const tamAgg = new Map<string, number>();
  const devAgg = new Map<string, number>();
  for (const p of inFlight) {
    for (const name of p.tam) tamAgg.set(name, (tamAgg.get(name) ?? 0) + 1);
    for (const name of p.dev) devAgg.set(name, (devAgg.get(name) ?? 0) + 1);
  }
  const workload_tam = [...tamAgg.entries()]
    .map(([person, active]) => ({ person, active }))
    .sort((a, b) => b.active - a.active);
  const workload_dev = [...devAgg.entries()]
    .map(([person, active]) => ({ person, active }))
    .sort((a, b) => b.active - a.active);

  // ── NPS this quarter ────────────────────────────────────────────────────

  type NpsRow = { raw_columns: RawCols | null };
  const currQ = currentQuarterLabel();
  const npsScores: number[] = [];
  for (const n of (npsRes.data as NpsRow[] | null) ?? []) {
    const q = (n.raw_columns?.[NPS_COL_QUARTER]?.text ?? "").trim();
    if (q !== currQ) continue;
    const s = Number(n.raw_columns?.[NPS_COL_SCORE]?.text ?? "");
    if (Number.isFinite(s)) npsScores.push(s);
  }
  const nps_this_quarter =
    npsScores.length > 0
      ? {
          quarter: currQ,
          average: Math.round((npsScores.reduce((a, b) => a + b, 0) / npsScores.length) * 10) / 10,
          count: npsScores.length,
        }
      : null;

  const deliveredAllTime = projects.filter((p) => isDelivered(p.status)).length;

  return {
    week_label: weekLabel,
    generated_at: now.toISOString(),
    shipped_this_week: shippedThisWeek,
    in_flight: inFlight,
    at_risk: atRisk,
    upcoming_14d: upcoming14d,
    workload_tam,
    workload_dev,
    nps_this_quarter,
    totals: {
      shipped_this_week: shippedThisWeek.length,
      in_flight: inFlight.length,
      at_risk: atRisk.length,
      upcoming_14d: upcoming14d.length,
      delivered_all_time: deliveredAllTime,
    },
    last_sync: (lastSyncRes.data as { finished_at: string } | null)?.finished_at ?? null,
  };
}
