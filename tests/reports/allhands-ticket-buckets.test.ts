import { describe, it, expect } from "vitest";
import { computeCustomerTicketConcentration } from "@/lib/reports/allhands-ticket-buckets";
import type { Process } from "@/lib/supabase/types";
import type { TicketRow } from "@/lib/tickets/types";

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

function ticket(overrides: Partial<TicketRow>): TicketRow {
  return {
    id: "ENG-1", title: "Something broke", url: "https://linear.app/x", team: null, project: null,
    source: "v2 Migration Blockers", priority: "High", linear_status: "Triage", status_type: "triage",
    linear_created_at: "2026-08-01T00:00:00Z", closed_at: null, in_scope: true,
    classification: "hard_blocker", confidence: "certain", rationale: null, domain: null,
    classified_at: "2026-08-01T00:00:00Z", manual_override: false, last_synced_at: "2026-08-07T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", ...overrides,
  };
}

describe("computeCustomerTicketConcentration", () => {
  it("counts distinct open tickets linked via a customer's processes", () => {
    const customers = [{ id: "c1", display_name: "Conectiv" }];
    const processesByCustomer = new Map([
      [
        "c1",
        [
          proc({ customer_id: "c1", process_name: "Conectiv POV", linear_ticket_ids: ["ENG-1", "ENG-2"] }),
          proc({ customer_id: "c1", process_name: "Conectiv POV (dup ref)", linear_ticket_ids: ["ENG-2", "ENG-3"] }),
        ],
      ],
    ]);
    const openTicketsById = new Map([
      ["ENG-1", ticket({ id: "ENG-1", title: "Blocker one", classification: "hard_blocker" })],
      ["ENG-2", ticket({ id: "ENG-2", title: "Blocker two", classification: "workaround_exists" })],
      ["ENG-3", ticket({ id: "ENG-3", title: "Blocker three", classification: "hard_blocker" })],
    ]);

    const result = computeCustomerTicketConcentration(customers, processesByCustomer, openTicketsById);

    expect(result).toEqual([
      {
        customerName: "Conectiv",
        openTicketCount: 3, // ENG-2 referenced by two processes counts once, not twice
        hardBlockerCount: 2,
        sampleTitles: ["Blocker one", "Blocker two", "Blocker three"],
      },
    ]);
  });

  it("omits customers with no open tickets among their linked ids", () => {
    const customers = [{ id: "c1", display_name: "Quiet Co" }];
    const processesByCustomer = new Map([
      ["c1", [proc({ customer_id: "c1", linear_ticket_ids: ["ENG-CLOSED"] })]],
    ]);
    // ENG-CLOSED isn't in openTicketsById at all (it's closed, so loadTicketsBundle
    // wouldn't include it in the open map) — must not appear as a phantom entry.
    const result = computeCustomerTicketConcentration(customers, processesByCustomer, new Map());
    expect(result).toEqual([]);
  });

  it("sorts customers by open ticket count, descending", () => {
    const customers = [
      { id: "c1", display_name: "Small" },
      { id: "c2", display_name: "Big" },
    ];
    const processesByCustomer = new Map([
      ["c1", [proc({ customer_id: "c1", linear_ticket_ids: ["ENG-1"] })]],
      ["c2", [proc({ customer_id: "c2", linear_ticket_ids: ["ENG-2", "ENG-3"] })]],
    ]);
    const openTicketsById = new Map([
      ["ENG-1", ticket({ id: "ENG-1" })],
      ["ENG-2", ticket({ id: "ENG-2" })],
      ["ENG-3", ticket({ id: "ENG-3" })],
    ]);
    const result = computeCustomerTicketConcentration(customers, processesByCustomer, openTicketsById);
    expect(result.map((r) => r.customerName)).toEqual(["Big", "Small"]);
  });

  it("caps sampleTitles at 3 even when more open tickets exist", () => {
    const customers = [{ id: "c1", display_name: "Conectiv" }];
    const processesByCustomer = new Map([
      ["c1", [proc({ customer_id: "c1", linear_ticket_ids: ["ENG-1", "ENG-2", "ENG-3", "ENG-4"] })]],
    ]);
    const openTicketsById = new Map([
      ["ENG-1", ticket({ id: "ENG-1", title: "One" })],
      ["ENG-2", ticket({ id: "ENG-2", title: "Two" })],
      ["ENG-3", ticket({ id: "ENG-3", title: "Three" })],
      ["ENG-4", ticket({ id: "ENG-4", title: "Four" })],
    ]);
    const result = computeCustomerTicketConcentration(customers, processesByCustomer, openTicketsById);
    expect(result[0].openTicketCount).toBe(4);
    expect(result[0].sampleTitles).toHaveLength(3);
  });
});
