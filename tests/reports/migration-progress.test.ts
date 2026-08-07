import { describe, it, expect } from "vitest";
import { computeMigrationProgramStart, computeCumulativeProgress } from "@/lib/reports/migration-progress";
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
    ...overrides,
  };
}

describe("computeMigrationProgramStart", () => {
  it("returns the earliest kickoff_date among processes with real V2 evidence", () => {
    const processes = [
      proc({ kickoff_date: "2026-03-01", linear_ticket_ids: ["ENG-1"] }),
      proc({ kickoff_date: "2026-01-15", date_parity_complete: "2026-02-01" }),
      proc({ kickoff_date: "2020-01-01" }), // no V2 evidence — excluded
    ];
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-01-15"));
  });

  it("returns null when no process has any V2 evidence", () => {
    expect(computeMigrationProgramStart([proc({})])).toBeNull();
  });
});

describe("computeCumulativeProgress", () => {
  it("counts a process from the week it first reaches any parity-or-later milestone", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-22T00:00:00Z"); // 3 full weeks
    const processes = [
      proc({ date_parity_complete: "2026-01-05" }), // week 1
      proc({ date_customer_handover: "2026-01-12" }), // week 2 (handover implies parity already passed)
      proc({}), // never reached parity — not counted at all
    ];
    const points = computeCumulativeProgress(processes, programStart, asOf);
    expect(points.map((p) => p.cumulativeAtOrPastParity)).toEqual([1, 2, 2]);
  });

  it("never decreases week over week even with a quiet week in between", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-29T00:00:00Z"); // 4 weeks
    const processes = [proc({ date_parity_complete: "2026-01-03" }), proc({ went_live_at: "2026-01-24" })];
    const points = computeCumulativeProgress(processes, programStart, asOf);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeAtOrPastParity).toBeGreaterThanOrEqual(points[i - 1].cumulativeAtOrPastParity);
    }
  });
});
