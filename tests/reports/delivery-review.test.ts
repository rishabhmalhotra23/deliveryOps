import { describe, it, expect } from "vitest";
import { buildDeliveryReview, statusForProcess } from "@/lib/reports/delivery-review";
import type { Process } from "@/lib/supabase/types";

function proc(overrides: Partial<Process>): Process {
  return {
    id: "p1", account: "Acme", customer_key: "acme", process_name: "Test Process",
    process_status: null, platform: "v1", migration_stage: "not_required",
    is_blocked: false, priority: null, fde_owner: null, engg_owner: null,
    date_parity_complete: null, date_customer_handover: null, date_customer_validation: null,
    go_live_date: null, completion_pct: null, effort_required: null, went_live_at: null,
    active_usage: null, customer_notified: null, customer_contact: null, blockers: null,
    notes: null, feature_delta: null, linear_ticket_ids: [], v2_workspace_url: null,
    arr: null, company_size: null, source_phase: null, source_board: null, updated_by: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
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
const PERIOD = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-07T23:59:59Z") };

describe("statusForProcess", () => {
  it("tags a process that went live within the period as done", () => {
    expect(statusForProcess(proc({ lifecycle: "live", go_live_date: "2026-08-03" }), PERIOD)).toBe("done");
  });

  it("tags an already-live process outside the period as live (steady state)", () => {
    expect(statusForProcess(proc({ lifecycle: "live", go_live_date: "2026-05-01" }), PERIOD)).toBe("live");
  });

  it("tags a blocked_on process as blocked regardless of lifecycle", () => {
    expect(statusForProcess(proc({ lifecycle: "in_development", blocked_on: "customer" }), PERIOD)).toBe("blocked");
  });

  it("tags an at-risk or off-track process as blocked", () => {
    expect(statusForProcess(proc({ health: "at_risk" }), PERIOD)).toBe("blocked");
    expect(statusForProcess(proc({ health: "off_track" }), PERIOD)).toBe("blocked");
  });

  it("tags active non-blocked work as coming_up", () => {
    expect(statusForProcess(proc({ lifecycle: "uat" }), PERIOD)).toBe("coming_up");
    expect(statusForProcess(proc({ lifecycle: "backlog" }), PERIOD)).toBe("coming_up");
  });

  it("does not tag needs_attention alone as blocked — it's an import-time classification-uncertainty flag, not an operational-blockage signal", () => {
    expect(
      statusForProcess(
        proc({ lifecycle: "backlog", needs_attention: true, blocked_on: "none", health: "on_track" }),
        PERIOD
      )
    ).toBe("coming_up");
    expect(
      statusForProcess(proc({ lifecycle: "backlog", needs_attention: true, blocked_on: "none", health: null }), PERIOD)
    ).toBe("coming_up");
  });

  it("returns null for archived work (cancelled/churned/retired) — excluded entirely", () => {
    expect(statusForProcess(proc({ lifecycle: "cancelled" }), PERIOD)).toBeNull();
    expect(statusForProcess(proc({ lifecycle: "churned" }), PERIOD)).toBeNull();
    expect(statusForProcess(proc({ lifecycle: "retired" }), PERIOD)).toBeNull();
  });

  // Important 2 — legacy is_blocked flag with real blocker text (Kort
  // Payments UAT, Conectiv POV, Ciena PO all have blocked_on: "none" but a
  // genuinely populated `blockers` string and must show as blocked).
  it("tags is_blocked with non-empty blockers text as blocked even when blocked_on is none", () => {
    expect(
      statusForProcess(
        proc({ is_blocked: true, blocked_on: "none", blockers: "Waiting on customer legal sign-off" }),
        PERIOD
      )
    ).toBe("blocked");
  });

  // The Century — Carrier Booking case: is_blocked is true but there's no
  // blocker text, and the process is genuinely live/on_track. OR'ing in
  // is_blocked unconditionally would falsely flip this to "blocked" — must
  // not regress.
  it("does not tag is_blocked alone (no blockers text) as blocked", () => {
    expect(
      statusForProcess(
        proc({
          is_blocked: true,
          blocked_on: "none",
          blockers: null,
          health: "on_track",
          lifecycle: "live",
          go_live_date: "2026-01-01",
        }),
        PERIOD
      )
    ).not.toBe("blocked");
    // Also verify whitespace-only blocker text doesn't count as "real" text.
    expect(
      statusForProcess(
        proc({ is_blocked: true, blocked_on: "none", blockers: "   ", health: "on_track", lifecycle: "backlog" }),
        PERIOD
      )
    ).not.toBe("blocked");
  });
});

describe("buildDeliveryReview", () => {
  const customers = [{ id: "c1", key: "acme", display_name: "Acme" }, { id: "c2", key: "beta", display_name: "Beta Corp" }];
  const arrByCustomer = new Map([
    ["c1", { arr: 94000, renewal_date: "2026-08-25" }], // 18 days out
    ["c2", { arr: 41000, renewal_date: null }],
  ]);

  it("groups processes by customer and sorts blocked-first, then by renewal proximity", () => {
    const processes = [
      proc({ id: "p1", customer_id: "c2", lifecycle: "uat" }),
      proc({ id: "p2", customer_id: "c1", blocked_on: "customer" }),
    ];
    const now = new Date("2026-08-07T00:00:00Z");
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, now);
    expect(result.customerGroups.map((g) => g.customerKey)).toEqual(["acme", "beta"]);
    expect(result.customerGroups[0].hasBlocked).toBe(true);
  });

  it("omits customers with no non-archived work in the tagged set", () => {
    const processes = [proc({ id: "p1", customer_id: "c1", lifecycle: "cancelled" })];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07"));
    expect(result.customerGroups).toEqual([]);
  });

  it("computes renewalInDays from the confirmed-ARR map, null when no renewal date", () => {
    const processes = [proc({ id: "p1", customer_id: "c1" }), proc({ id: "p2", customer_id: "c2" })];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07T00:00:00Z"));
    const acme = result.customerGroups.find((g) => g.customerKey === "acme");
    const beta = result.customerGroups.find((g) => g.customerKey === "beta");
    expect(acme?.renewalInDays).toBe(18);
    expect(beta?.renewalInDays).toBeNull();
  });

  it("computes renewalInDays independent of time-of-day (midnight-UTC normalization)", () => {
    // Same calendar dates as the test above (2026-08-07 -> 2026-08-25 = 18 days),
    // but `now` carries a late-day time-of-day. Diffing raw timestamps would let
    // the elapsed fraction of "today" erode the day count below 18.
    const processes = [proc({ id: "p1", customer_id: "c1" })];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07T23:00:00Z"));
    const acme = result.customerGroups.find((g) => g.customerKey === "acme");
    expect(acme?.renewalInDays).toBe(18);
  });

  it("flags the longest-untouched list — active, non-archived, updated 30+ days ago, oldest first", () => {
    const processes = [
      proc({ id: "p1", customer_id: "c1", process_name: "Old One", updated_at: "2026-06-01T00:00:00Z" }),
      proc({ id: "p2", customer_id: "c1", process_name: "Recent One", updated_at: "2026-08-05T00:00:00Z" }),
      proc({ id: "p3", customer_id: "c1", process_name: "Older One", lifecycle: "live", updated_at: "2026-05-01T00:00:00Z" }), // live — excluded, not "active" work
    ];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07T00:00:00Z"));
    expect(result.longestUntouched.map((i) => i.processName)).toEqual(["Old One"]);
  });

  // Important 2 — the note text from the legacy is_blocked + blockers path
  // must actually reach the rendered item, same as the blocked_on path.
  it("preserves the blocker note text on the item when is_blocked + blockers triggers blocked status", () => {
    const processes = [
      proc({
        id: "p1",
        customer_id: "c1",
        is_blocked: true,
        blocked_on: "none",
        blockers: "Waiting on customer legal sign-off",
      }),
    ];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07T00:00:00Z"));
    const acme = result.customerGroups.find((g) => g.customerKey === "acme");
    expect(acme?.processes[0].status).toBe("blocked");
    expect(acme?.processes[0].blockedNote).toBe("Waiting on customer legal sign-off");
  });

  // Important 3 — a real production tie exists today: two customer groups
  // sharing identical hasBlocked/renewalInDays must not fall through to
  // Map-insertion (DB row) order.
  it("breaks a hasBlocked/renewalInDays tie between customer groups alphabetically", () => {
    const tiedCustomers = [
      { id: "c2", key: "zeta", display_name: "Zeta Inc" },
      { id: "c1", key: "alpha", display_name: "Alpha Inc" },
    ];
    const tiedArr = new Map([
      ["c1", { arr: 10_000, renewal_date: "2026-09-01" }],
      ["c2", { arr: 20_000, renewal_date: "2026-09-01" }], // identical renewal date -> tie
    ]);
    const processes = [
      proc({ id: "p1", customer_id: "c2", lifecycle: "uat" }),
      proc({ id: "p2", customer_id: "c1", lifecycle: "uat" }),
    ];
    const result = buildDeliveryReview(processes, tiedCustomers, tiedArr, PERIOD, new Date("2026-08-07T00:00:00Z"));
    expect(result.customerGroups.map((g) => g.customerName)).toEqual(["Alpha Inc", "Zeta Inc"]);
  });

  // Important 4 — no confirmed ARR source (no Closed-Won opp on file, e.g.
  // iHeartRadio, SSD/SKP, TSM Law, Wipro FSS) must surface as null, not a
  // fabricated $0.
  it("surfaces a null arr, not 0, when the customer has no confirmed ARR source", () => {
    const noArrCustomers = [{ id: "c1", key: "acme", display_name: "Acme" }];
    const noArr = new Map([["c1", { arr: null, renewal_date: null }]]);
    const processes = [proc({ id: "p1", customer_id: "c1", lifecycle: "uat" })];
    const result = buildDeliveryReview(processes, noArrCustomers, noArr, PERIOD, new Date("2026-08-07T00:00:00Z"));
    expect(result.customerGroups[0].arr).toBeNull();
  });
});
