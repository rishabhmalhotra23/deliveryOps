// buildCustomerRollup is the pure aggregation core of the V2 Migration
// tab's per-customer "3 of 5 processes migrated" rollup (lib/processes/
// loader.ts) — tested directly over already-shaped rows rather than
// through a live Supabase load.

import { describe, it, expect } from "vitest";
import { buildCustomerRollup, type V2ProcessRow } from "@/lib/processes/loader";
import type { Process, MigrationStage } from "@/lib/supabase/types";

function row(overrides: Partial<V2ProcessRow> & { migration_stage: MigrationStage }): V2ProcessRow {
  const base: Process = {
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
  };
  return {
    ...base,
    customer_display_name: "Acme",
    open_suggestion_count: 0,
    needs_classification: false,
    confirmed_arr: null,
    ...overrides,
  };
}

describe("buildCustomerRollup", () => {
  it("counts migrated vs total per customer", () => {
    const rows = [
      row({ customer_id: "c1", customer_display_name: "Acme", migration_stage: "live_on_v2" }),
      row({ customer_id: "c1", customer_display_name: "Acme", migration_stage: "in_development" }),
      row({ customer_id: "c1", customer_display_name: "Acme", migration_stage: "migrated_pending_commercial" }),
    ];
    expect(buildCustomerRollup(rows)).toEqual([
      { customer_id: "c1", customer_display_name: "Acme", migrated: 2, total: 3 },
    ]);
  });

  it("does not count v2_native as migrated — it means never migrated", () => {
    const rows = [row({ customer_id: "c1", migration_stage: "v2_native" })];
    expect(buildCustomerRollup(rows)).toEqual([
      { customer_id: "c1", customer_display_name: "Acme", migrated: 0, total: 1 },
    ]);
  });

  it("skips rows with no matched customer", () => {
    const rows = [row({ customer_id: null, migration_stage: "live_on_v2" })];
    expect(buildCustomerRollup(rows)).toEqual([]);
  });

  it("sorts customers by total descending", () => {
    const rows = [
      row({ customer_id: "c1", customer_display_name: "Small", migration_stage: "in_development" }),
      row({ customer_id: "c2", customer_display_name: "Big", migration_stage: "in_development" }),
      row({ customer_id: "c2", customer_display_name: "Big", migration_stage: "live_on_v2" }),
    ];
    expect(buildCustomerRollup(rows).map((r) => r.customer_display_name)).toEqual(["Big", "Small"]);
  });
});
