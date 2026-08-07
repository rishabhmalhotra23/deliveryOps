import { describe, it, expect } from "vitest";
import { resolveBlockers } from "@/lib/reports/allhands-blockers";
import type { TeamAsk, TicketRow } from "@/lib/tickets/types";

function ask(overrides: Partial<TeamAsk>): TeamAsk {
  return {
    id: "a1", ask_text: "Fix it", requester: "Rishabh", priority_tier: "now", status: "open",
    notes: null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    tickets: [], ...overrides,
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

describe("resolveBlockers", () => {
  it("prefers open team_asks tagged 'now', tagged as team_ask source", () => {
    const asks = [ask({ ask_text: "Kort needs a decision", tickets: [{ id: "ENG-4444", title: "x" }] })];
    const result = resolveBlockers(asks, [ticket({})]);
    expect(result).toEqual([
      { title: "Kort needs a decision", priorityLabel: "NOW", linkedTicketIds: ["ENG-4444"], source: "team_ask" },
    ]);
  });

  it("includes 'soon' asks after all 'now' asks, still from team_asks", () => {
    const asks = [ask({ id: "a1", ask_text: "later thing", priority_tier: "soon" }), ask({ id: "a2", ask_text: "now thing", priority_tier: "now" })];
    const result = resolveBlockers(asks, []);
    expect(result.map((b) => b.title)).toEqual(["now thing", "later thing"]);
  });

  it("ignores closed/done team_asks", () => {
    const asks = [ask({ status: "done" })];
    expect(resolveBlockers(asks, [])).toEqual([]);
  });

  it("falls back to open hard-blocker tickets when no open team_asks exist", () => {
    const tickets = [
      ticket({ id: "ENG-1", title: "Blocker one", classification: "hard_blocker", closed_at: null }),
      ticket({ id: "ENG-2", title: "Not a blocker", classification: "just_a_bug", closed_at: null }),
      ticket({ id: "ENG-3", title: "Closed blocker", classification: "hard_blocker", closed_at: "2026-08-05T00:00:00Z" }),
    ];
    const result = resolveBlockers([], tickets);
    expect(result).toEqual([{ title: "Blocker one", priorityLabel: "NOW", linkedTicketIds: ["ENG-1"], source: "ticket_fallback" }]);
  });

  it("caps the fallback list at `max`", () => {
    const tickets = Array.from({ length: 10 }, (_, i) =>
      ticket({ id: `ENG-${i}`, title: `Blocker ${i}`, classification: "hard_blocker" })
    );
    expect(resolveBlockers([], tickets, 3)).toHaveLength(3);
  });
});
