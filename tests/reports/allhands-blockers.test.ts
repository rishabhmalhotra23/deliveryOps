import { describe, it, expect } from "vitest";
import { resolveBlockers } from "@/lib/reports/allhands-blockers";
import type { TeamAsk } from "@/lib/tickets/types";

function ask(overrides: Partial<TeamAsk>): TeamAsk {
  return {
    id: "a1", ask_text: "Fix it", requester: "Rishabh", priority_tier: "now", status: "open",
    notes: null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    tickets: [], ...overrides,
  };
}

describe("resolveBlockers", () => {
  it("prefers open team_asks tagged 'now', tagged as team_ask source", () => {
    const asks = [ask({ ask_text: "Kort needs a decision", tickets: [{ id: "ENG-4444", title: "x" }] })];
    const result = resolveBlockers(asks);
    expect(result).toEqual([
      { title: "Kort needs a decision", priorityLabel: "NOW", linkedTicketIds: ["ENG-4444"], source: "team_ask" },
    ]);
  });

  it("includes 'soon' asks after all 'now' asks, still from team_asks", () => {
    const asks = [ask({ id: "a1", ask_text: "later thing", priority_tier: "soon" }), ask({ id: "a2", ask_text: "now thing", priority_tier: "now" })];
    const result = resolveBlockers(asks);
    expect(result.map((b) => b.title)).toEqual(["now thing", "later thing"]);
  });

  it("ignores closed/done team_asks", () => {
    const asks = [ask({ status: "done" })];
    expect(resolveBlockers(asks)).toEqual([]);
  });

  it("returns an empty list when no open team_asks exist", () => {
    expect(resolveBlockers([])).toEqual([]);
  });

  it("caps the list at `max`", () => {
    const asks = Array.from({ length: 10 }, (_, i) => ask({ id: `a${i}`, ask_text: `Ask ${i}` }));
    expect(resolveBlockers(asks, 3)).toHaveLength(3);
  });
});
