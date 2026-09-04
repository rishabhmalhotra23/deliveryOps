// The six Delivery-tab fixes from the 2026-09-04 review. Each block pins the
// specific defect that was found in production, not just the happy path —
// three of the six were silent failures that looked like empty data.

import { describe, it, expect } from "vitest";
import { rankByRole } from "@/lib/roster/store";
import { clearAttentionOnEdit } from "@/lib/processes/store";
import { attentionReasons } from "@/lib/delivery/labels";
import { resolveHue } from "@/lib/delivery/hues";
import { planRowReorder } from "@/app/_components/process-table";
import { planPositions, byPosition } from "@/lib/delivery/reorder";
import { PROCESS_LIFECYCLES, type Process } from "@/lib/supabase/types";
import type { DetailProcess } from "@/app/_components/process-detail";

function person(display_name: string, roles: string[] = []) {
  return { display_name, roles };
}

describe("rankByRole — role ranks, it must never exclude", () => {
  // The bug: `roles @> {'fde'}` was a WHERE clause, and 0033 left all 27
  // roster rows at the '{}' default, so the FDE and TAM pickers matched zero
  // rows forever. The invariant that prevents a repeat is that the output
  // length always equals the input length.
  const roster = [person("Karthik", ["fde"]), person("Sandeep"), person("Alejo", ["fde", "tam"])];

  it("never drops an entry that lacks the role", () => {
    expect(rankByRole(roster, "fde")).toHaveLength(3);
  });

  it("keeps a roleless roster fully pickable", () => {
    const roleless = [person("A"), person("B"), person("C")];
    expect(rankByRole(roleless, "fde").map((e) => e.display_name)).toEqual(["A", "B", "C"]);
  });

  it("sorts role-holders ahead of everyone else", () => {
    expect(rankByRole(roster, "fde").map((e) => e.display_name)).toEqual([
      "Alejo",
      "Karthik",
      "Sandeep",
    ]);
  });

  it("is alphabetical within each group", () => {
    const many = [person("Zoe", ["tam"]), person("Adam"), person("Bea", ["tam"]), person("Yan")];
    expect(rankByRole(many, "tam").map((e) => e.display_name)).toEqual(["Bea", "Zoe", "Adam", "Yan"]);
  });

  it("leaves order untouched when no role is requested", () => {
    expect(rankByRole(roster, undefined)).toBe(roster);
  });
});

describe("clearAttentionOnEdit", () => {
  const flagged = { needs_attention: true } as Pick<Process, "needs_attention">;
  const clean = { needs_attention: false } as Pick<Process, "needs_attention">;

  it("clears the flag and its reason on a real field edit", () => {
    const update: Record<string, unknown> = { lifecycle: "uat" };
    clearAttentionOnEdit(flagged, update);
    expect(update).toMatchObject({ needs_attention: false, needs_attention_reason: null });
  });

  it("leaves an unflagged row alone", () => {
    const update: Record<string, unknown> = { lifecycle: "uat" };
    clearAttentionOnEdit(clean, update);
    expect(update).toEqual({ lifecycle: "uat" });
  });

  // Dragging is a mouse gesture, not a human reviewing the record — the same
  // reasoning that keeps these two columns out of `updated_at` (0036/0037).
  it("does not clear on a board reorder", () => {
    const update: Record<string, unknown> = { board_position: 2048 };
    clearAttentionOnEdit(flagged, update);
    expect(update).toEqual({ board_position: 2048 });
  });

  it("does not clear on a table reorder", () => {
    const update: Record<string, unknown> = { table_position: 512 };
    clearAttentionOnEdit(flagged, update);
    expect(update).toEqual({ table_position: 512 });
  });

  // The dismiss button sends needs_attention itself. Re-deriving it here
  // would let an implicit clear overwrite an explicit re-flag.
  it("defers to an explicit write to needs_attention", () => {
    const update: Record<string, unknown> = { needs_attention: true };
    clearAttentionOnEdit(flagged, update);
    expect(update).toEqual({ needs_attention: true });
  });

  it("still clears when a content field rides along with a position write", () => {
    const update: Record<string, unknown> = { board_position: 1, health: "on_track" };
    clearAttentionOnEdit(flagged, update);
    expect(update.needs_attention).toBe(false);
  });
});

describe("attentionReasons", () => {
  it("rewrites the Monday milestone reason out of dead vocabulary", () => {
    const out = attentionReasons("milestone unrecoverable — Monday overwrote it with a waiting state");
    expect(out).toHaveLength(1);
    expect(out[0]).not.toMatch(/milestone/i);
    expect(out[0]).toMatch(/Phase/);
  });

  it("splits a joined reason into one sentence per cause", () => {
    const out = attentionReasons(
      'milestone unrecoverable — Monday overwrote it with a waiting state; marked Live but phase is "Waiting for Customer" — delivered count would be overstated'
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toContain("Waiting for Customer");
  });

  it("keeps the interpolated customer name", () => {
    expect(attentionReasons('customer inferred from the item name ("Srinar") — verify')[0]).toContain(
      '"Srinar"'
    );
  });

  it("passes an unrecognised reason through rather than swallowing it", () => {
    expect(attentionReasons("something nobody has a pattern for")).toEqual([
      "something nobody has a pattern for",
    ]);
  });

  it("returns nothing for null or blank", () => {
    expect(attentionReasons(null)).toEqual([]);
    expect(attentionReasons("   ")).toEqual([]);
  });
});

describe("lifecycle hues", () => {
  // Every value used to map to "neutral", which is what made Discovery, In
  // development and UAT visually identical in the table.
  it("gives the whole happy path a non-neutral hue", () => {
    for (const value of ["upcoming", "discovery", "in_development", "uat", "live"]) {
      expect(resolveHue("lifecycle", value, {})).not.toBe("neutral");
    }
  });

  it("assigns a hue to every lifecycle value, so none falls through to the default", () => {
    for (const value of PROCESS_LIFECYCLES) {
      expect(resolveHue("lifecycle", value, {})).toBeTruthy();
    }
  });

  it("still lets Configure → Colours override a default", () => {
    expect(resolveHue("lifecycle", "uat", { "lifecycle:uat": "fuchsia" })).toBe("fuchsia");
  });

  it("keeps lifecycle and migration_stage independent for a shared value name", () => {
    expect(resolveHue("lifecycle", "in_development", {})).not.toBe(
      resolveHue("stage", "in_development", {})
    );
  });
});

function tableRow(id: string, table_position: number | null, updated_at = "2026-01-01"): DetailProcess {
  return { id, table_position, updated_at } as unknown as DetailProcess;
}

describe("planRowReorder — the table's manual order", () => {
  it("writes table_position, never board_position", () => {
    const rows = [tableRow("A", 1000), tableRow("B", 2000)];
    const writes = planRowReorder(rows, rows[0]!, 2);
    expect(writes[0]).toHaveProperty("table_position");
    expect(writes[0]).not.toHaveProperty("board_position");
  });

  it("reads table_position, so a board order can't leak into it", () => {
    // Both rows are unplaced in the TABLE order even though a board order
    // exists on them. If planRowReorder read board_position it would see a
    // fully-positioned list and emit a single midpoint write instead of the
    // renumber an all-null list requires.
    const rows = [
      { id: "A", table_position: null, board_position: 1000, updated_at: "2026-01-01" },
      { id: "B", table_position: null, board_position: 2000, updated_at: "2026-01-02" },
    ] as unknown as DetailProcess[];
    const writes = planRowReorder(rows, rows[1]!, 0);
    expect(writes.length).toBeGreaterThan(1);
  });

  it("moves a row up into exactly the gap it was dropped in", () => {
    const rows = [tableRow("A", 1000), tableRow("B", 2000), tableRow("C", 3000)];
    const writes = planRowReorder(rows, rows[2]!, 0);
    const positions = new Map(rows.map((r) => [r.id, r.table_position]));
    for (const w of writes) positions.set(w.id, w.table_position);
    const order = [...rows]
      .sort((a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0))
      .map((r) => r.id);
    expect(order).toEqual(["C", "A", "B"]);
  });

  it("is a no-op when a row is dropped back where it started", () => {
    const rows = [tableRow("A", 1000), tableRow("B", 2000)];
    expect(planRowReorder(rows, rows[0]!, 0)).toEqual([]);
  });
});

describe("planPositions / byPosition are column-agnostic", () => {
  // The whole reason the math was extracted: the board and the table must not
  // drift apart, so the same input must produce the same plan on either
  // column.
  const shape = [
    { id: "A", p: 1000, q: 1000, updated_at: "2026-01-01" },
    { id: "B", p: 2000, q: 2000, updated_at: "2026-01-02" },
    { id: "C", p: 3000, q: 3000, updated_at: "2026-01-03" },
  ];

  it("plans identically for two different columns holding the same values", () => {
    const viaP = planPositions(shape, shape[0]!, 2, (r) => r.p);
    const viaQ = planPositions(shape, shape[0]!, 2, (r) => r.q);
    expect(viaP).toEqual(viaQ);
  });

  it("sorts unplaced rows after placed ones, falling back to staleness", () => {
    const rows = [
      { id: "fresh", pos: null, updated_at: "2026-05-01" },
      { id: "placed", pos: 5, updated_at: "2026-01-01" },
      { id: "stale", pos: null, updated_at: "2026-02-01" },
    ];
    expect([...rows].sort(byPosition((r) => r.pos)).map((r) => r.id)).toEqual([
      "placed",
      "stale",
      "fresh",
    ]);
  });
});
