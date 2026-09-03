import { describe, it, expect } from "vitest";
import { computeMigrationProgramStart, computeMigratedToV2Progress } from "@/lib/reports/migration-progress";
import type { Process } from "@/lib/supabase/types";

function proc(overrides: Partial<Process>): Process {
  return {
    id: "p1", account: "Acme", customer_key: "acme", process_name: "Test",
    process_status: null, platform: "v1", migration_stage: "not_required",
    is_blocked: false, priority: null, fde_owner: null, engg_owner: null,
    date_parity_complete: null, date_customer_handover: null, date_customer_validation: null,
    go_live_date: null, completion_pct: null, effort_required: null, went_live_at: null,
    active_usage: null, customer_notified: null, customer_contact: null, blockers: null,
    notes: null, feature_delta: null, linear_ticket_ids: [], v2_workspace_url: null,
    arr: null, company_size: null, source_phase: null, source_board: null, updated_by: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    lifecycle: "in_development", phase: null, health: null, blocked_on: "none", work_mode: null,
    complexity: null, customer_id: "c1", k2_process_id: null, k2_workspace_id: null,
    kickoff_date: null, ttv_days: null, tam_owner: null, partner: null,
    total_effort_hours: null, value_minutes_saved_per_run: null, value_basis: null,
    value_confirmed_by: null, value_confirmed_at: null, reviewed_at: null, reviewed_by: null,
    field_provenance: {}, source_system: null, source_item_id: null, source_raw: {},
    needs_attention: false, needs_attention_reason: null,
    deleted_at: null, deleted_by: null,
    ...overrides,
  };
}

describe("computeMigrationProgramStart", () => {
  it("takes the earliest per-process migration-progress date among processes with real V2 evidence", () => {
    const processes = [
      proc({ kickoff_date: "2026-03-01", linear_ticket_ids: ["ENG-1"] }), // no milestone yet — falls back to kickoff_date
      proc({ kickoff_date: "2026-01-15", date_parity_complete: "2026-02-01" }), // milestone present — parity date wins over kickoff_date
      proc({ kickoff_date: "2020-01-01" }), // no V2 evidence — excluded
    ];
    // Minimum of 2026-03-01 (p1's kickoff fallback) and 2026-02-01 (p2's parity date), not p2's earlier kickoff_date.
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-02-01"));
  });

  it("uses date_parity_complete instead of a much-older kickoff_date when both are present (the production bug)", () => {
    // Reproduces the real production symptom: a process whose v1 automation kicked off years
    // before any V2 migration work started on it. Using kickoff_date here produced a program
    // start of 2022-12-26 and a ~3-year flat chart lead-in before the actual migration ramp-up.
    const processes = [
      proc({ kickoff_date: "2022-12-26", date_parity_complete: "2026-06-15", linear_ticket_ids: ["ENG-9"] }),
    ];
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-06-15"));
  });

  it("falls back to kickoff_date for a process with V2 evidence but no migration milestone yet", () => {
    // Only a linear ticket as evidence — actively being migrated, but nothing has landed,
    // so there's no parity/handover/validation/live date to prefer.
    const processes = [proc({ kickoff_date: "2026-04-01", linear_ticket_ids: ["ENG-42"] })];
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-04-01"));
  });

  it("clamps a far-older kickoff_date fallback up to the earliest real milestone date", () => {
    // The structural version of the production bug: attaching a Linear ticket to an
    // old v1 process (the normal first step of starting its migration) must not drag
    // the program start back to when that process's *v1* automation kicked off.
    const processes = [
      proc({ id: "old", kickoff_date: "2020-01-01", linear_ticket_ids: ["ENG-1"] }), // evidence, no milestone
      proc({ id: "real", kickoff_date: "2026-01-01", date_parity_complete: "2026-05-01" }),
    ];
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-05-01"));
  });

  it("still uses the plain minimum kickoff_date when NO process has any milestone date", () => {
    // Nothing to clamp against — an early-program state where work has started but
    // nothing has landed yet.
    const processes = [
      proc({ id: "a", kickoff_date: "2026-04-01", linear_ticket_ids: ["ENG-42"] }),
      proc({ id: "b", kickoff_date: "2026-02-10", linear_ticket_ids: ["ENG-43"] }),
    ];
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-02-10"));
  });

  it("returns null when no process has any V2 evidence", () => {
    expect(computeMigrationProgramStart([proc({})])).toBeNull();
  });
});

describe("computeMigratedToV2Progress", () => {
  it("counts a process from the week its migration_stage is live_on_v2, using went_live_at", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-22T00:00:00Z"); // 3 full weeks
    const processes = [
      proc({ migration_stage: "live_on_v2", went_live_at: "2026-01-05" }), // week 1
      proc({ migration_stage: "migrated_pending_commercial", date_parity_complete: "2026-01-12" }), // week 2
      proc({ migration_stage: "customer_validation", date_parity_complete: "2026-01-06" }), // NOT done — excluded even though it has a parity date
    ];
    const points = computeMigratedToV2Progress(processes, programStart, asOf);
    expect(points.map((p) => p.cumulativeMigratedToV2)).toEqual([1, 2, 2]);
  });

  it("prefers went_live_at over date_parity_complete when a live_on_v2 process has both", () => {
    const programStart = new Date("2026-01-05T00:00:00Z"); // a Monday
    const asOf = new Date("2026-01-15T00:00:00Z"); // within week 2, before its Monday boundary
    const processes = [
      proc({ migration_stage: "live_on_v2", date_parity_complete: "2026-01-06", went_live_at: "2026-01-13" }),
    ];
    const points = computeMigratedToV2Progress(processes, programStart, asOf);
    // Counted in week 2 (went_live_at, Jan 13), not week 1 (date_parity_complete, Jan 6) — went_live_at wins.
    expect(points.map((p) => p.cumulativeMigratedToV2)).toEqual([0, 1]);
  });

  it("falls back to date_parity_complete for migrated_pending_commercial, which never gets went_live_at", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-08T00:00:00Z");
    const processes = [proc({ migration_stage: "migrated_pending_commercial", date_parity_complete: "2026-01-03" })];
    const points = computeMigratedToV2Progress(processes, programStart, asOf);
    expect(points.map((p) => p.cumulativeMigratedToV2)).toEqual([1]);
  });

  it("excludes a done process with no usable date at all", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-08T00:00:00Z");
    const processes = [proc({ migration_stage: "live_on_v2" })]; // no went_live_at, no date_parity_complete
    const points = computeMigratedToV2Progress(processes, programStart, asOf);
    expect(points.map((p) => p.cumulativeMigratedToV2)).toEqual([0]);
  });

  it("never decreases week over week even with a quiet week in between", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-29T00:00:00Z"); // 4 weeks
    const processes = [
      proc({ migration_stage: "migrated_pending_commercial", date_parity_complete: "2026-01-03" }),
      proc({ migration_stage: "live_on_v2", went_live_at: "2026-01-24" }),
    ];
    const points = computeMigratedToV2Progress(processes, programStart, asOf);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeMigratedToV2).toBeGreaterThanOrEqual(points[i - 1].cumulativeMigratedToV2);
    }
  });
});
