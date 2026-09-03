// planReorder decides which rows get a new board_position when a card is
// dropped on the board. Two real bugs came out of reviewing the first
// version, and both are pinned here:
//
//   1. The slot index the UI produces counts the dragged card itself, so
//      every downward drag landed one position too low — the drop marker
//      promised one gap and the write chose the next one down.
//   2. board_position is nullable and 0035 deliberately doesn't backfill, so
//      in a lane where every position is still null the "midpoint" resolved
//      to the same constant for every gap — the first drag in any lane sent
//      the card to the top no matter where it was dropped.

import { describe, it, expect } from "vitest";
import { planReorder } from "@/app/_components/process-board";
import type { DetailProcess } from "@/app/_components/process-detail";

function row(id: string, board_position: number | null, updated_at = "2026-01-01"): DetailProcess {
  return { id, board_position, updated_at } as unknown as DetailProcess;
}

function pick(lane: DetailProcess[], id: string): DetailProcess {
  const found = lane.find((r) => r.id === id);
  if (!found) throw new Error(`test setup: no row ${id} in lane`);
  return found;
}

/** Applies the writes and returns the id order the user would then see —
 *  asserting on order rather than on raw float values, since the exact
 *  numbers are an implementation detail. Mirrors byBoardPosition(). */
function orderAfter(lane: DetailProcess[], writes: { id: string; board_position: number }[]): string[] {
  const positions = new Map(lane.map((r) => [r.id, r.board_position]));
  for (const w of writes) positions.set(w.id, w.board_position);
  return [...lane]
    .sort((a, b) => {
      const ap = positions.get(a.id) ?? null;
      const bp = positions.get(b.id) ?? null;
      if (ap != null && bp != null) return ap - bp;
      if (ap != null) return -1;
      if (bp != null) return 1;
      return a.updated_at.localeCompare(b.updated_at);
    })
    .map((r) => r.id);
}

describe("planReorder", () => {
  describe("a fully positioned lane", () => {
    const lane = [row("A", 1000), row("B", 2000), row("C", 3000), row("D", 4000)];

    it("writes only the dragged card", () => {
      expect(planReorder(lane, pick(lane, "A"), 3)).toHaveLength(1);
    });

    it("moves a card down into exactly the gap it was dropped in", () => {
      // Slot 3 is the gap between C and D as the UI indexes it, while the
      // lane list still contains A. This is the off-by-one case.
      expect(orderAfter(lane, planReorder(lane, pick(lane, "A"), 3))).toEqual(["B", "C", "A", "D"]);
    });

    it("moves a card up into exactly the gap it was dropped in", () => {
      expect(orderAfter(lane, planReorder(lane, pick(lane, "D"), 1))).toEqual(["A", "D", "B", "C"]);
    });

    it("moves a card to the very end", () => {
      expect(orderAfter(lane, planReorder(lane, pick(lane, "A"), 4))).toEqual(["B", "C", "D", "A"]);
    });

    it("moves a card to the very start", () => {
      expect(orderAfter(lane, planReorder(lane, pick(lane, "D"), 0))).toEqual(["D", "A", "B", "C"]);
    });

    it("is a no-op when dropped where it already is", () => {
      // Both the gap above B and the gap below B are B's own position.
      expect(planReorder(lane, pick(lane, "B"), 1)).toEqual([]);
      expect(planReorder(lane, pick(lane, "B"), 2)).toEqual([]);
    });
  });

  describe("a lane that has never been ordered (every position null)", () => {
    const lane = [row("A", null, "2026-01-01"), row("B", null, "2026-01-02"), row("C", null, "2026-01-03")];

    it("renumbers the lane rather than writing one meaningless midpoint", () => {
      expect(planReorder(lane, pick(lane, "C"), 0).length).toBeGreaterThan(1);
    });

    it("puts the card where it was dropped, not at the top", () => {
      expect(orderAfter(lane, planReorder(lane, pick(lane, "A"), 3))).toEqual(["B", "C", "A"]);
      expect(orderAfter(lane, planReorder(lane, pick(lane, "C"), 0))).toEqual(["C", "A", "B"]);
      expect(orderAfter(lane, planReorder(lane, pick(lane, "A"), 2))).toEqual(["B", "A", "C"]);
    });
  });

  describe("a partially positioned lane", () => {
    // The state after one earlier drag: positioned cards sort above the rest.
    const lane = [row("X", 1024), row("Y", null, "2026-01-01"), row("Z", null, "2026-01-02")];

    it("lands the card in the dropped gap", () => {
      expect(orderAfter(lane, planReorder(lane, pick(lane, "Z"), 1))).toEqual(["X", "Z", "Y"]);
    });

    it("can place a card above the already-positioned one", () => {
      expect(orderAfter(lane, planReorder(lane, pick(lane, "Y"), 0))).toEqual(["Y", "X", "Z"]);
    });
  });

  describe("degenerate positions", () => {
    it("renumbers instead of emitting a tie when neighbours are equal", () => {
      const lane = [row("A", 1000), row("B", 1000), row("C", 1000)];
      const writes = planReorder(lane, pick(lane, "C"), 0);
      const values = writes.map((w) => w.board_position);
      expect(new Set(values).size).toBe(values.length);
      expect(orderAfter(lane, writes)).toEqual(["C", "A", "B"]);
    });

    it("renumbers when the gap is too small to halve", () => {
      // Adjacent doubles: no float sits strictly between them.
      const lane = [row("A", 1), row("B", 1 + Number.EPSILON), row("C", 5000)];
      const writes = planReorder(lane, pick(lane, "C"), 1);
      expect(writes.length).toBeGreaterThan(1);
      expect(orderAfter(lane, writes)).toEqual(["A", "C", "B"]);
    });

    it("handles a single-card lane", () => {
      const lane = [row("A", null)];
      expect(planReorder(lane, pick(lane, "A"), 0)).toEqual([]);
      expect(planReorder(lane, pick(lane, "A"), 1)).toEqual([]);
    });
  });

  describe("a card arriving from another lane", () => {
    // The arriving card is not in the target lane's list yet — the caller
    // passes the row itself precisely so it doesn't have to pre-splice it.
    it("positions a card arriving into an empty lane", () => {
      expect(planReorder([], row("NEW", null), 0)).toEqual([{ id: "NEW", board_position: 1024 }]);
    });

    it("positions a card arriving between two positioned cards", () => {
      const target = [row("A", 1000), row("B", 2000)];
      const incoming = row("NEW", null);
      expect(planReorder(target, incoming, 1)).toEqual([{ id: "NEW", board_position: 1500 }]);
      expect(orderAfter([...target, incoming], planReorder(target, incoming, 1))).toEqual(["A", "NEW", "B"]);
    });

    it("positions a card arriving at the end", () => {
      const target = [row("A", 1000), row("B", 2000)];
      const incoming = row("NEW", null);
      expect(orderAfter([...target, incoming], planReorder(target, incoming, 2))).toEqual(["A", "B", "NEW"]);
    });

    it("renumbers when arriving into a lane that was never ordered", () => {
      const target = [row("P", null, "2026-01-01"), row("Q", null, "2026-01-02")];
      const incoming = row("NEW", null, "2026-01-03");
      const writes = planReorder(target, incoming, 1);
      expect(orderAfter([...target, incoming], writes)).toEqual(["P", "NEW", "Q"]);
    });
  });
});
