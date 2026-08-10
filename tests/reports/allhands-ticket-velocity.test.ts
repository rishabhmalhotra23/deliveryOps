import { describe, it, expect } from "vitest";
import { computeTicketVelocity } from "@/lib/reports/allhands-ticket-velocity";
import type { TicketRow } from "@/lib/tickets/types";

function ticket(overrides: Partial<TicketRow>): TicketRow {
  return {
    id: "ENG-1", title: "Something broke", url: "https://linear.app/x", team: null, project: null,
    source: "v2 Migration Blockers", priority: "High", linear_status: "Triage", status_type: "triage",
    linear_created_at: "2026-06-01T00:00:00Z", closed_at: null, in_scope: true,
    classification: "hard_blocker", confidence: "certain", rationale: null, domain: null,
    classified_at: "2026-06-01T00:00:00Z", manual_override: false, last_synced_at: "2026-08-07T00:00:00Z",
    created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
  };
}

describe("computeTicketVelocity", () => {
  it("returns an empty array for no tickets", () => {
    expect(computeTicketVelocity([], new Date("2026-08-10T00:00:00Z"))).toEqual([]);
  });

  it("accumulates created and closed counts week over week, monotonically non-decreasing", () => {
    const tickets = [
      ticket({ id: "A", linear_created_at: "2026-06-01T00:00:00Z", closed_at: null }),
      ticket({ id: "B", linear_created_at: "2026-06-09T00:00:00Z", closed_at: "2026-06-16T00:00:00Z" }),
      ticket({ id: "C", linear_created_at: "2026-06-20T00:00:00Z", closed_at: null }),
    ];
    const points = computeTicketVelocity(tickets, new Date("2026-06-23T00:00:00Z"));

    // Monotonic non-decreasing on both series.
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeCreated).toBeGreaterThanOrEqual(points[i - 1].cumulativeCreated);
      expect(points[i].cumulativeClosed).toBeGreaterThanOrEqual(points[i - 1].cumulativeClosed);
    }

    const last = points[points.length - 1];
    expect(last.cumulativeCreated).toBe(3);
    expect(last.cumulativeClosed).toBe(1);
  });

  it("never lets cumulativeClosed exceed cumulativeCreated at any point", () => {
    const tickets = [
      ticket({ id: "A", linear_created_at: "2026-06-01T00:00:00Z", closed_at: "2026-06-02T00:00:00Z" }),
      ticket({ id: "B", linear_created_at: "2026-06-15T00:00:00Z", closed_at: null }),
    ];
    const points = computeTicketVelocity(tickets, new Date("2026-06-20T00:00:00Z"));
    for (const p of points) {
      expect(p.cumulativeClosed).toBeLessThanOrEqual(p.cumulativeCreated);
    }
  });

  it("starts from the first Monday at or after the earliest ticket's creation date", () => {
    const tickets = [ticket({ id: "A", linear_created_at: "2026-06-03T00:00:00Z" })]; // a Wednesday
    const points = computeTicketVelocity(tickets, new Date("2026-06-10T00:00:00Z"));
    expect(points[0].weekStart).toBe("2026-06-08"); // next Monday
  });
});
