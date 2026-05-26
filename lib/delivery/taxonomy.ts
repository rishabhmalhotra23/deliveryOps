// Single source of truth for project taxonomy across DeliveryOps.
//
// What lives here:
//   1. Monday column IDs    — every page/loader must read columns through this.
//   2. Phase classification — Pre-Kickoff, M1 Discovery, … exception handling.
//   3. Status classifiers   — isDelivered / isActive / isStalled / isCancelled.
//   4. Group-title buckets  — Active board groups: in_progress, pipeline,
//                              on_hold, backlog.
//   5. Health classification — at-risk / on-track and pill colors.
//   6. Display metadata     — labels + colors used in charts.
//
// Why one place:
//   Before this module, the same constants and functions were redefined
//   across 6 loaders + 2 pages + scripts. The weekly report classified
//   phases differently from the customer page; the analytics page used a
//   different set of column IDs. This file is the contract — every consumer
//   imports from here, no exceptions.
//
// To change a Monday column ID, a phase mapping, or the at-risk rule:
//   change it ONCE here. Do not re-derive in a consumer.

// ─── Monday column IDs (board-stable) ─────────────────────────────────────────

export const MONDAY_PROJECT_COLS = {
  status:       "color_mkzj8fw8",  // "Project Status": Live, In Progress, Stuck, …
  health:       "color_mm01ft4",   // "Health": On Track, At Risk, Off Track, …
  phase:        "color_mm06sdrj",  // "Current Phase": M1 Discovery, M2 Development, …
  platform:     "color_mm0698sb",  // V1 / V2 / Custom
  complexity:   "dropdown_mm06r92k",
  kickoff_date: "date_mm011n1f",
  go_live_date: "date_mm01dz3b",
  ttv:          "formula_mm01p18k",
  tam:          "multiple_person_mkzrppyd",
  dev:          "multiple_person_mkzrgk3b",
  partner:      "dropdown_mm06hne3",
} as const;

export const MONDAY_NPS_COLS = {
  score:    "numeric_mm0aqvk3",
  category: "color_mm0af90g",
  quarter:  "dropdown_mm0ahec7",
} as const;

// Convenience reader: trimmed text from a Monday raw_columns blob.
export type RawCols = Record<string, { type: string; text: string | null; value: string | null }> | null | undefined;
export function colText(cols: RawCols, id: string): string | null {
  return cols?.[id]?.text?.trim() || null;
}

// ─── Status classifiers ───────────────────────────────────────────────────────

const DELIVERED_STATUSES = new Set(["live", "delivered", "finished"]);
const STALLED_STATUSES   = new Set(["stuck", "stalled"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "inactive"]);

export function isDelivered(status: string | null | undefined, group?: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  if (DELIVERED_STATUSES.has(s)) return true;
  // Account-overview "Completed Projects" group counts as delivered even if
  // the per-project status field is empty (legacy data).
  return (group ?? "").toLowerCase() === "completed projects";
}

export function isStalled(status: string | null | undefined, group?: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  if (STALLED_STATUSES.has(s)) return true;
  return (group ?? "").toLowerCase() === "stalled projects";
}

export function isCancelledOrInactive(
  status: string | null | undefined,
  group: string | null | undefined,
  fiscalYear: string | null | undefined
): boolean {
  const s = (status ?? "").toLowerCase();
  const g = (group ?? "").toLowerCase();
  if (fiscalYear === "inactive") return true;
  if (CANCELLED_STATUSES.has(s)) return true;
  if (g.includes("cancel")) return true;
  return false;
}

// ─── Active board group classification ────────────────────────────────────────
// On the "active" tracking board, projects are split across four groups.
// Treat anything that isn't recognised as 'in_progress' so nothing is lost.

export type FlightGroup = "in_progress" | "pipeline" | "on_hold" | "backlog";

export function flightGroup(groupTitle: string | null | undefined): FlightGroup {
  const g = (groupTitle ?? "").toLowerCase();
  if (g.includes("pipeline")) return "pipeline";
  if (g.includes("on hold") || g === "hold") return "on_hold";
  if (g.includes("backlog")) return "backlog";
  return "in_progress"; // "Active" + anything else
}

export const FLIGHT_GROUP_META: Record<FlightGroup, { label: string; pillCls: string }> = {
  in_progress: { label: "In progress", pillCls: "text-indigo-700 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
  pipeline:    { label: "Pipeline",    pillCls: "text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/20" },
  on_hold:     { label: "On Hold",     pillCls: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/20" },
  backlog:     { label: "Backlog",     pillCls: "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
};

// "Active" predicate used by every consumer:
//  - Project must be on the active board (`fiscal_year === "active"`).
//  - Project must not be delivered.
//  - We DO NOT exclude on_hold/pipeline/backlog here — they're still active
//    work commitments. Consumers that want only the "in_progress" subset
//    should filter via flightGroup(p.group_title) === "in_progress".
export function isActiveBoard(p: {
  fiscal_year?: string | null;
  status?: string | null;
  group_title?: string | null;
}): boolean {
  if (p.fiscal_year !== "active") return false;
  return !isDelivered(p.status, p.group_title);
}

// ─── Health classification (the at-risk gate) ─────────────────────────────────

export function isAtRisk(health: string | null | undefined): boolean {
  const h = (health ?? "").toLowerCase();
  return h.includes("risk") || h === "off track" || h === "stuck";
}

// Pill styling for the Health column. Keep this list in sync with the
// values Monday's "Health" column produces.
export const HEALTH_PILL_CLS: Record<string, string> = {
  "On Track":  "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  "Healthy":   "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  "At Risk":   "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Off Track": "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Stuck":     "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Finished":  "bg-blue-500/12 text-blue-700 dark:text-blue-400 border-blue-500/25",
};

// ─── Phase classification ─────────────────────────────────────────────────────
// Real Kognitos phase values from Monday (verified live 2026-05-15):
//   "Pre-Kickoff", "M1 - Discovery", "M2 - Development",
//   "M3 - Testing/UAT", "M5 - Exception Handling" (no M4),
//   "Customer Handling exceptions", "Waiting for Customer",
//   "POV complete, Waiting for next steps", "Support", "Enhancement"
// New phases added on Monday should be added to PhaseClassifier below;
// unknown phases fall into "other".

export type PhaseGroup =
  | "discovery"     // Pre-Kickoff, M1
  | "dev"           // M2
  | "uat"           // M3, M4 (none yet), M5 / exception handling
  | "waiting"       // Waiting for Customer, POV complete
  | "support"       // Support, Enhancement
  | "live"          // overrides all others when status indicates delivered
  | "other";

export function phaseGroup(phase: string | null | undefined, status: string | null | undefined): PhaseGroup {
  if (isDelivered(status)) return "live";
  const p = (phase ?? "").toLowerCase();
  if (p.includes("m1") || p.includes("discovery") || p.includes("pre-kickoff") || p.includes("pre kickoff")) return "discovery";
  if (p.includes("m2") || p.includes("development") || p.includes("develop")) return "dev";
  if (p.includes("m3") || p.includes("m4") || p.includes("m5") || p.includes("uat") || p.includes("testing") || p.includes("exception")) return "uat";
  if (p.includes("waiting") || p.includes("pov complete") || p.includes("customer handling")) return "waiting";
  if (p.includes("support") || p.includes("enhancement")) return "support";
  return "other";
}

export const PHASE_GROUP_META: Record<PhaseGroup, { label: string; color: string }> = {
  discovery: { label: "Pre-Kickoff / M1",         color: "#818cf8" },
  dev:       { label: "M2 Development",           color: "#6366f1" },
  uat:       { label: "M3–M5 UAT",                color: "#f59e0b" },
  waiting:   { label: "Waiting on customer",      color: "#f97316" },
  support:   { label: "Support / Enhancement",    color: "#71717a" },
  live:      { label: "Live",                     color: "#10b981" },
  other:     { label: "Other",                    color: "#a1a1aa" },
};

// Phases that count as "active project work" (excludes live, support,
// enhancement). Used for headcount / workload calculations and the phase
// breakdown chart on the weekly report.
export const ACTIVE_WORK_PHASES: PhaseGroup[] = ["discovery", "dev", "uat", "waiting"];

// ─── People-name normaliser ───────────────────────────────────────────────────
// Monday "people" columns return either "First Last" or "first.last@kognitos.com".
// Normalise to "First L." for display.

export function peopleNames(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .filter((s) => !isPlaceholderName(s))
    .map((s) => formatPersonName(s))
    .filter(Boolean);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ─── Canonical person-name formatter ─────────────────────────────────────────
// Single source of truth for how a name is rendered across DeliveryOps.
// Handles three things every UI needed locally before:
//   1. "first.last@kognitos.com"   → "First L."
//   2. "rishabh malhotra"           → "Rishabh M."   (case-normalised)
//   3. Role suffixes for non-FDE team members           (Shyam → "(PM)")
//
// If you add a new helper that renders a person's name, route it through
// here.  Local copies invariably drift on case + role rendering.

/** Role suffixes — appended after the short-formatted name.  Keys are
 *  first names matched case-insensitively. */
const ROLE_SUFFIX_BY_FIRST_NAME: Record<string, string> = {
  shyam: "(PM)",
};

/** Format a single person string in DeliveryOps's canonical form. */
export function formatPersonName(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Email → strip domain, normalise separators.
  const source = trimmed.includes("@")
    ? trimmed.split("@")[0].replace(/[._]/g, " ")
    : trimmed;
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const firstWord = parts[0];
  const first = cap(firstWord);
  const lastInitial = parts.length > 1
    ? `${(parts[parts.length - 1][0] ?? "").toUpperCase()}.`
    : "";
  const base = lastInitial ? `${first} ${lastInitial}` : first;
  const suffix = ROLE_SUFFIX_BY_FIRST_NAME[firstWord.toLowerCase()];
  return suffix ? `${base} ${suffix}` : base;
}

/** Format a comma-separated list of people compactly:
 *   1 name  → "Rishabh M."
 *   2 names → "Rishabh M., Shyam P. (PM)"
 *   3+      → "Rishabh M., Shyam P. (PM) +1"
 *  Set `expand: true` to render every name instead of collapsing the tail. */
export function formatPeopleList(
  raw: string | string[] | null | undefined,
  opts: { expand?: boolean; max?: number } = {}
): string {
  if (!raw) return "";
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const names = Array.from(
    new Set(parts.map((p) => formatPersonName(p)).filter(Boolean))
  );
  if (names.length === 0) return "";
  const max = opts.max ?? 2;
  if (opts.expand || names.length <= max) return names.join(", ");
  const shown = names.slice(0, max);
  const extra = names.length - max;
  return `${shown.join(", ")} +${extra}`;
}

/** Placeholder strings Monday users sometimes drop into the delivery /
 *  engineering people-columns when no real person has been assigned yet.
 *  None of these are FDEs and they pollute workload charts + filters.
 *  Match is case-insensitive; first-name and full-name forms both hit. */
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

/** True when a raw Monday people-column entry is a placeholder rather
 *  than a real person. */
export function isPlaceholderName(raw: string | null | undefined): boolean {
  if (!raw) return true;
  return PLACEHOLDER_NAMES.has(raw.trim().toLowerCase());
}

// Merge two Monday people-columns (delivery + engineering) into a single
// comma-separated FDE roster, deduped + trimmed.  Placeholder names
// ("Customer Implementing", "TBD", …) are dropped so they don't pollute
// downstream charts and filters.  Returns null when both columns are
// empty / only contained placeholders.  Used everywhere that "FDE" is a
// single concept (delivery table, customer projects card, dashboard
// drill-downs).
export function unionPeopleColumns(a: string | null, b: string | null): string | null {
  const seen = new Set<string>();
  for (const raw of [a, b]) {
    if (!raw) continue;
    for (const piece of raw.split(",")) {
      const name = piece.trim();
      if (!name || isPlaceholderName(name)) continue;
      seen.add(name);
    }
  }
  return seen.size === 0 ? null : Array.from(seen).join(", ");
}

// ─── TTV ──────────────────────────────────────────────────────────────────────

export function ttvDays(kickoffIso: string | null | undefined, goliveIso: string | null | undefined): number | null {
  if (!kickoffIso || !goliveIso) return null;
  const k = new Date(kickoffIso);
  const g = new Date(goliveIso);
  if (Number.isNaN(k.getTime()) || Number.isNaN(g.getTime()) || g < k) return null;
  return Math.round((g.getTime() - k.getTime()) / 86_400_000);
}

// ─── Kognitos FY quarter math ─────────────────────────────────────────────────
// FY starts Feb 1: Q1=Feb–Apr, Q2=May–Jul, Q3=Aug–Oct, Q4=Nov–Jan.

export interface KognitosQuarter {
  start: Date;
  end: Date;
  label: string;        // "Q2 FY26"
  fyYear: number;       // 26
  qNum: 1 | 2 | 3 | 4;
}

export function kognitosFYQuarter(date: Date): KognitosQuarter {
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  if (m === 0)         return mk(4, y - 1, new Date(Date.UTC(y - 1, 10, 1)), new Date(Date.UTC(y, 0, 31, 23, 59, 59)));
  if (m <= 3)          return mk(1, y,     new Date(Date.UTC(y, 1, 1)),     new Date(Date.UTC(y, 3, 30, 23, 59, 59)));
  if (m <= 6)          return mk(2, y,     new Date(Date.UTC(y, 4, 1)),     new Date(Date.UTC(y, 6, 31, 23, 59, 59)));
  if (m <= 9)          return mk(3, y,     new Date(Date.UTC(y, 7, 1)),     new Date(Date.UTC(y, 9, 31, 23, 59, 59)));
                       return mk(4, y,     new Date(Date.UTC(y, 10, 1)),    new Date(Date.UTC(y + 1, 0, 31, 23, 59, 59)));
}

export function previousKognitosFYQuarter(q: KognitosQuarter): KognitosQuarter {
  // Move the start back by one day, then look up the quarter.
  const refDate = new Date(q.start);
  refDate.setUTCDate(refDate.getUTCDate() - 1);
  return kognitosFYQuarter(refDate);
}

function mk(qNum: 1 | 2 | 3 | 4, fy: number, start: Date, end: Date): KognitosQuarter {
  return { start, end, qNum, fyYear: fy, label: `Q${qNum} FY${String(fy).slice(2)}` };
}
