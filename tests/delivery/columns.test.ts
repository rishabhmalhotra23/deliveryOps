// The Fields menu renders from COL_GROUPS rather than from COLDEFS directly,
// so a column missing from a group would silently become unreachable — you
// could still promote it from the drawer, but you could never find it in the
// menu or turn it back off there. Cheap to assert, and the failure would
// otherwise be invisible.

import { describe, it, expect } from "vitest";
import { COLDEFS, COL_GROUPS, CARD_FIELDS, DEFAULT_COLS, minColWidth, COLDEF_BY_KEY } from "@/lib/delivery/columns";

describe("COL_GROUPS", () => {
  it("covers every column exactly once", () => {
    const grouped = COL_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual(COLDEFS.map((c) => c.key).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("names every group", () => {
    for (const g of COL_GROUPS) expect(g.label.trim()).not.toBe("");
  });
});

describe("column widths", () => {
  // Only 3 of 16 columns declared a narrowW before 2026-09-08, so opening the
  // 420px split panel cost ~500px of viewport and gave back 80.
  it("gives every column a narrow width", () => {
    for (const def of COLDEFS) {
      expect(def.narrowW, def.key).toBeDefined();
      expect(def.narrowW!, def.key).toBeLessThanOrEqual(def.wideW);
    }
  });

  it("keeps the resize floor below the column's own narrow width", () => {
    // A floor above narrowW would mean a column could never be dragged down
    // to the width it already uses in split mode.
    for (const def of COLDEFS) {
      expect(minColWidth(def), def.key).toBeLessThanOrEqual(def.narrowW ?? def.wideW);
    }
  });

  it("never floors below 52px", () => {
    for (const def of COLDEFS) expect(minColWidth(def)).toBeGreaterThanOrEqual(52);
  });
});

describe("defaults", () => {
  // Engineering owner is the one column off by default — most processes leave
  // it unassigned. Phase used to be this exclusion; it was retired in 0044.
  it("shows everything except the engineering owner", () => {
    expect(DEFAULT_COLS).not.toContain("engg");
    expect(DEFAULT_COLS).toHaveLength(COLDEFS.length - 1);
  });

  it("has no phase column left to configure", () => {
    expect(COLDEFS.map((c) => c.key)).not.toContain("phase");
  });

  it("only offers card fields that are real columns", () => {
    for (const key of CARD_FIELDS) expect(COLDEF_BY_KEY[key], key).toBeDefined();
  });
});
