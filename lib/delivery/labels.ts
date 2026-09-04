// One place that turns an enum value into display text for the whole
// Delivery workspace.
//
// Before this existed the same value read three different ways depending on
// which surface you were looking at: the table showed "Needs Triage" (CSS
// `capitalize` over a de-underscored key), the detail panel showed "needs
// triage" (raw key), and migration stage showed "In development" (a real
// label map). Sentence case is the house style — it's what
// MIGRATION_STAGE_LABELS already used — so everything else is brought in
// line with it here rather than each component deciding for itself.
//
// Acronyms are spelled the way the team says them (UAT, V1/V2, TAM, FDE,
// ARR), which a generic capitalize() can't do.

import {
  MIGRATION_STAGE_LABELS,
  type MigrationStage,
  type ProcessBlockedOn,
  type ProcessHealth,
  type ProcessLifecycle,
  type ProcessPhase,
  type ProcessPlatform,
  type ProcessWorkMode,
} from "@/lib/supabase/types";

export const LIFECYCLE_LABELS: Record<ProcessLifecycle, string> = {
  backlog: "Backlog",
  upcoming: "Upcoming",
  discovery: "Discovery",
  in_development: "In development",
  uat: "UAT",
  live: "Live",
  on_hold: "On hold",
  needs_triage: "Needs triage",
  cancelled: "Cancelled",
  churned: "Churned",
  retired: "Retired",
};

export const HEALTH_LABELS: Record<ProcessHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

export const PHASE_LABELS: Record<ProcessPhase, string> = {
  pre_kickoff: "Pre-kickoff",
  m1_discovery: "M1 · Discovery",
  m2_development: "M2 · Development",
  m3_testing_uat: "M3 · Testing / UAT",
  m4_deployment: "M4 · Deployment",
  m5_exception_handling: "M5 · Exception handling",
};

export const BLOCKED_ON_LABELS: Record<ProcessBlockedOn, string> = {
  none: "Nothing",
  customer: "Customer",
  kognitos_engg: "Kognitos engineering",
  kognitos_delivery: "Kognitos delivery",
  partner: "Partner",
};

export const WORK_MODE_LABELS: Record<ProcessWorkMode, string> = {
  steady_state: "Steady state",
  exception_handling: "Exception handling",
  enhancement: "Enhancement",
  support: "Support",
};

export const PLATFORM_LABELS: Record<ProcessPlatform, string> = {
  v1: "V1",
  v2: "V2",
  custom: "Custom",
};

/** Shortened stage labels for board chips, where a card is 268px wide and
 *  "Migrated, pending commercial" wraps to three lines. */
export const MIGRATION_STAGE_SHORT: Record<MigrationStage, string> = {
  not_required: "Not required",
  in_development: "In development",
  engg_pending: "Engg pending",
  parity_testing: "Parity testing",
  customer_validation: "Cust. validation",
  live_on_v2: "Live on V2",
  v2_native: "V2 native",
  migrated_pending_commercial: "Migrated · commercial",
};

export { MIGRATION_STAGE_LABELS };

/** Last-resort formatter for a value with no explicit label (a future enum
 *  member, or free text like `complexity`). Sentence case, not Title Case,
 *  so it matches everything above. */
export function sentenceCase(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  if (!spaced) return "—";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function lifecycleLabel(v: ProcessLifecycle | null): string {
  return v ? LIFECYCLE_LABELS[v] ?? sentenceCase(v) : "—";
}
export function healthLabel(v: ProcessHealth | null): string {
  return v ? HEALTH_LABELS[v] ?? sentenceCase(v) : "—";
}
export function phaseLabel(v: ProcessPhase | null): string {
  return v ? PHASE_LABELS[v] ?? sentenceCase(v) : "—";
}
export function blockedOnLabel(v: ProcessBlockedOn | null): string {
  return v ? BLOCKED_ON_LABELS[v] ?? sentenceCase(v) : "—";
}
export function workModeLabel(v: ProcessWorkMode | null): string {
  return v ? WORK_MODE_LABELS[v] ?? sentenceCase(v) : "—";
}
export function platformLabel(v: ProcessPlatform | null): string {
  return v ? PLATFORM_LABELS[v] ?? sentenceCase(v) : "—";
}
export function stageLabel(v: MigrationStage | null, opts: { short?: boolean } = {}): string {
  if (!v) return "—";
  return (opts.short ? MIGRATION_STAGE_SHORT[v] : MIGRATION_STAGE_LABELS[v]) ?? sentenceCase(v);
}

// ─── Import-attention reasons ───────────────────────────────────────────────
// `processes.needs_attention_reason` was written by the Monday importer
// (lib/import/monday-taxonomy.ts) in Monday's vocabulary — "milestone",
// "Current Phase", "marked Live". Migration 0021 replaced all of that with
// lifecycle/phase, and 0024 dropped the Monday tables entirely, so the stored
// text now names fields that no longer exist: the banner told you a milestone
// was unrecoverable on a system that has no milestones.
//
// Rewritten at render time rather than with an UPDATE, so the original import
// record stays intact and re-reading an old row can't lose information. The
// patterns are matched loosely (substring/regex, not equality) because the
// importer joined several reasons with "; " and interpolated names into them.

const ATTENTION_REWRITES: { match: RegExp; rewrite: (m: RegExpMatchArray) => string }[] = [
  {
    match: /milestone unrecoverable/i,
    rewrite: () => "Imported from Monday without a phase — set Phase to clear this.",
  },
  {
    match: /marked Live but phase is "([^"]+)"/i,
    rewrite: (m) =>
      `Imported as Live while still at "${m[1]}" — confirm Lifecycle before this counts as delivered.`,
  },
  {
    match: /marked Inactive but this is a POV/i,
    rewrite: () => "Imported as inactive, but this is a POV awaiting a decision — check Lifecycle.",
  },
  {
    match: /customer inferred from the item name \("([^"]+)"\)/i,
    rewrite: (m) => `Customer was inferred from the process name ("${m[1]}") — confirm it's right.`,
  },
];

/** Turns a stored `needs_attention_reason` into one sentence per cause, in
 *  the vocabulary the app actually uses today. Anything unrecognised is
 *  passed through unchanged rather than swallowed. */
export function attentionReasons(raw: string | null): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      for (const { match, rewrite } of ATTENTION_REWRITES) {
        const m = part.match(match);
        if (m) return rewrite(m);
      }
      return part;
    });
}
