// Derivation from Monday's blended columns into the native orthogonal taxonomy.
//
// Pure functions, no I/O — the importer script (scripts/import-monday-backup.ts)
// does the reading and writing. Kept separate so the mapping is unit-testable
// against the real archive counts; see tests/import/monday-taxonomy.test.ts.
//
// Why any of this exists: Monday's `Current Phase` is a single status column that
// mixed milestones, terminal states and waiting states across 15 values, and
// `Health` was 91-of-146 "Finished", which is a lifecycle value, not a health
// value. Migration 0021 split those into lifecycle / phase / health / blocked_on
// / work_mode. This module encodes the split.
//
// Source of the mapping and the row counts: docs/PROCESSES-SCHEMA-PROPOSAL.md,
// derived from monday-backup-2026-08-03 (6 report boards, 146 rows).

import type {
  ProcessBlockedOn,
  ProcessHealth,
  ProcessLifecycle,
  ProcessPhase,
  ProcessPlatform,
  ProcessWorkMode,
  MigrationStage,
} from "@/lib/supabase/types";

/** What a single Monday row contributes to the native columns. */
export interface DerivedState {
  lifecycle: ProcessLifecycle;
  phase: ProcessPhase | null;
  health: ProcessHealth | null;
  blocked_on: ProcessBlockedOn;
  work_mode: ProcessWorkMode | null;
  /** Only set when the Monday phase implies it; otherwise left alone. */
  migration_stage: MigrationStage | null;
  /** True when a human has to look at this row before it can be trusted. */
  needs_attention: boolean;
  needs_attention_reason: string | null;
}

export interface MondayRowInput {
  project_status: string | null;
  current_phase: string | null;
  health: string | null;
}

const norm = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// ─── platform ────────────────────────────────────────────────────────────────
// Across the full 146 report rows: V1 103, V2 39, Custom Solution 3, and one
// compound value — "Currently in V1; Testing in V2" (Scan Health Enhancements
// Phase 2, status Live).
//
// That last one is not a dirty value, it is a real mid-migration state: the
// process runs on V1 in production while V2 is under test. Platform therefore
// records where it RUNS (v1) and the migration progress goes where it belongs, in
// `migration_stage`. Coercing it to v2 would overstate the V2 estate by one row
// in the all-hands report; dropping it would lose the fact that it is in testing.
//
// Returns null on anything else, so the caller flags rather than guesses.
//
// Note: 0021's SQL guard rejects unmapped platform values outright. It did not
// fire during local validation because the 0020 seed holds only 75 rows and three
// values. The importer meets all four.

const PLATFORM_MAP: Record<string, ProcessPlatform> = {
  v1: "v1",
  v2: "v2",
  custom: "custom",
  "custom solution": "custom",
  "currently in v1; testing in v2": "v1",
};

export function derivePlatform(raw: string | null): ProcessPlatform | null {
  return PLATFORM_MAP[norm(raw)] ?? null;
}

/**
 * Migration progress implied by the platform label itself, for the compound
 * values. Null when the label says nothing about migration state, in which case
 * the phase-derived stage from `deriveState` stands.
 */
export function migrationStageFromPlatform(raw: string | null): MigrationStage | null {
  return norm(raw) === "currently in v1; testing in v2" ? "parity_testing" : null;
}

// ─── health ──────────────────────────────────────────────────────────────────
// "Finished" (91 rows), "Inactive" (20) and "On Hold" (4) carry no health signal
// and become null. Health is only meaningful for in-flight work; pretending 91
// finished rows are healthy is what made the old report's health mix meaningless.
//
// Note for whoever reads the first report off this: "At Risk" was never used in
// Monday at all, and only 1 of the 18 active rows was Off Track. This column
// starts out carrying almost no signal.

export function deriveHealth(raw: string | null): ProcessHealth | null {
  switch (norm(raw)) {
    case "on track":
    case "positive":
      return "on_track";
    case "at risk":
      return "at_risk";
    case "off track":
      return "off_track";
    default:
      return null; // Finished / Inactive / On Hold / blank
  }
}

// ─── complexity ──────────────────────────────────────────────────────────────

export function deriveComplexity(raw: string | null): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (n.startsWith("low")) return "Low";
  if (n.startsWith("med")) return "Medium";
  if (n.startsWith("high")) return "High";
  return null;
}

// ─── phase / blocked_on / work_mode, from Monday's `Current Phase` ───────────
// The table below is the mapping in docs/PROCESSES-SCHEMA-PROPOSAL.md with the
// archive's row counts in comments. `phaseUnrecoverable` marks the one case where
// Monday destroyed information we cannot get back.

interface PhaseMapping {
  phase: ProcessPhase | null;
  blocked_on: ProcessBlockedOn;
  work_mode: ProcessWorkMode | null;
  /** lifecycle this phase forces, regardless of Project Status */
  lifecycleOverride?: ProcessLifecycle;
  migration_stage?: MigrationStage;
  /**
   * True when the milestone is genuinely gone. `Current Phase` is one status
   * column, so a row set to a waiting state had its milestone OVERWRITTEN —
   * there is no prior phase to keep. 7 of the active rows are in this state.
   */
  phaseUnrecoverable?: boolean;
}

const PHASE_MAP: Record<string, PhaseMapping> = {
  // milestones
  "m1 - discovery": { phase: "m1_discovery", blocked_on: "none", work_mode: null }, // 1
  "m2 - development": { phase: "m2_development", blocked_on: "none", work_mode: null }, // 1
  "m3 - testing/uat": { phase: "m3_testing_uat", blocked_on: "none", work_mode: null }, // 10
  "pre-kickoff": { phase: "pre_kickoff", blocked_on: "none", work_mode: null }, // 12

  // live work modes
  "m5 - exception handling": {
    phase: "m5_exception_handling",
    blocked_on: "none",
    work_mode: "exception_handling",
  }, // 37
  "customer handling exceptions": {
    phase: "m5_exception_handling",
    blocked_on: "customer",
    work_mode: "exception_handling",
  }, // 11
  support: { phase: null, blocked_on: "none", work_mode: "support" }, // 8
  enhancement: { phase: null, blocked_on: "none", work_mode: "enhancement" }, // 6

  // already on v2
  "live in v2": {
    phase: null,
    blocked_on: "none",
    work_mode: "steady_state",
    migration_stage: "live_on_v2",
  }, // 4
  "migrated to v2": {
    phase: null,
    blocked_on: "none",
    work_mode: "steady_state",
    migration_stage: "live_on_v2",
  }, // 1

  // POV states
  "pov complete": { phase: "m1_discovery", blocked_on: "none", work_mode: null }, // 1
  "pov complete, waiting for next steps": {
    phase: "m1_discovery",
    blocked_on: "customer",
    work_mode: null,
  }, // 4

  // terminal states — these are lifecycle, not phase
  cancelled: { phase: null, blocked_on: "none", work_mode: null, lifecycleOverride: "cancelled" }, // 29
  churned: { phase: null, blocked_on: "none", work_mode: null, lifecycleOverride: "churned" }, // 12

  // the lossy one
  "waiting for customer": {
    phase: null,
    blocked_on: "customer",
    work_mode: null,
    phaseUnrecoverable: true,
  }, // 9
};

// ─── lifecycle, from Monday's `Project Status` ───────────────────────────────
// Archive: Live 71, Inactive 45, In Progress 14, Backlog 10, On Hold 4,
// Upcoming 2. "Inactive" is ambiguous on its own and is disambiguated by phase
// (Cancelled 29 / Churned 12), falling back to `retired`.

function baseLifecycle(projectStatus: string | null): ProcessLifecycle | null {
  switch (norm(projectStatus)) {
    case "live":
      return "live";
    case "in progress":
      return "in_development";
    case "backlog":
      return "backlog";
    case "on hold":
      return "on_hold";
    case "upcoming":
      return "upcoming";
    case "inactive":
      return "retired"; // refined by phase below
    default:
      return null;
  }
}

/** Phases that contradict a `Live` status — the 4 rows marked live that are not. */
const NOT_ACTUALLY_LIVE = new Set([
  "pre-kickoff",
  "pov complete",
  "waiting for customer",
]);

export function deriveState(row: MondayRowInput): DerivedState {
  const phaseKey = norm(row.current_phase);
  const mapping = PHASE_MAP[phaseKey];
  const base = baseLifecycle(row.project_status);

  let lifecycle: ProcessLifecycle = mapping?.lifecycleOverride ?? base ?? "discovery";
  let phase = mapping?.phase ?? null;
  const blocked_on = mapping?.blocked_on ?? "none";
  const work_mode = mapping?.work_mode ?? null;
  const migration_stage = mapping?.migration_stage ?? null;

  const reasons: string[] = [];

  // Unknown Project Status — do not guess silently.
  if (base === null) {
    reasons.push(`unrecognised Project Status "${row.project_status ?? ""}"`);
  }

  // Unknown Current Phase — same.
  if (phaseKey && !mapping) {
    reasons.push(`unrecognised Current Phase "${row.current_phase ?? ""}"`);
  }

  // The lossy case: milestone overwritten by a waiting state.
  if (mapping?.phaseUnrecoverable) {
    phase = null;
    reasons.push("milestone unrecoverable — Monday overwrote it with a waiting state");
  }

  // In Progress carries no milestone of its own, so prefer the phase when it is
  // more specific. Without this, the 10 rows sitting in M3 land in the Building
  // lane instead of Validating and the board misrepresents where work actually is.
  if (lifecycle === "in_development") {
    if (phase === "m3_testing_uat") lifecycle = "uat";
    else if (phase === "m1_discovery" || phase === "pre_kickoff") lifecycle = "discovery";
  }

  // Data defect 1: marked Live but the phase says otherwise (4 rows). Trust
  // neither — flag it. Overstating delivered count is the failure mode here.
  if (base === "live" && NOT_ACTUALLY_LIVE.has(phaseKey)) {
    reasons.push(
      `marked Live but phase is "${row.current_phase ?? ""}" — delivered count would be overstated`
    );
  }

  // Data defect 2: marked Inactive but it is a POV awaiting a decision (4 rows).
  // That is live pipeline, not archive. Flag rather than silently reclassify,
  // per the surface-both-values rule.
  if (base === "retired" && phaseKey === "pov complete, waiting for next steps") {
    reasons.push("marked Inactive but this is a POV awaiting a decision, not archived work");
  }

  // Health only survives on in-flight work.
  const inFlight = lifecycle !== "live" && !["cancelled", "churned", "retired"].includes(lifecycle);
  const health = inFlight ? deriveHealth(row.health) : null;

  return {
    lifecycle,
    phase: lifecycle === "live" ? null : phase,
    health,
    blocked_on,
    work_mode,
    migration_stage,
    needs_attention: reasons.length > 0,
    needs_attention_reason: reasons.length ? reasons.join("; ") : null,
  };
}

// ─── the three board views ───────────────────────────────────────────────────
// Kept here so the importer can report the resulting split and the numbers can be
// compared against the archive before anything is trusted.

export function viewForLifecycle(l: ProcessLifecycle): "active" | "delivered" | "archive" {
  if (l === "live") return "delivered";
  if (l === "cancelled" || l === "churned" || l === "retired" || l === "needs_triage") return "archive";
  return "active";
}

/** The four Active-work lanes approved at step 1.5. */
export type ActiveLane = "pipeline" | "building" | "validating" | "stuck";

export function laneFor(l: ProcessLifecycle, blockedOn: ProcessBlockedOn): ActiveLane | null {
  if (viewForLifecycle(l) !== "active") return null;
  if (l === "on_hold" || blockedOn !== "none") return "stuck";
  if (l === "backlog" || l === "upcoming") return "pipeline";
  if (l === "uat") return "validating";
  return "building"; // discovery, in_development
}
