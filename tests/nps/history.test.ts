import { describe, it, expect } from "vitest";
import { quarterSortKey } from "@/lib/nps/history";

describe("quarterSortKey", () => {
  it("sorts chronologically across years", () => {
    const quarters = ["4Q25", "1Q26", "2Q24", "3Q24", "4Q24", "1Q25"];
    const sorted = [...quarters].sort((a, b) => quarterSortKey(a) - quarterSortKey(b));
    expect(sorted).toEqual(["2Q24", "3Q24", "4Q24", "1Q25", "4Q25", "1Q26"]);
  });

  it("sorts campaign-composed quarters together with historical-format quarters", () => {
    // "1Q26" is exactly what the New Campaign modal's quarter+year picker
    // composes (app/(app)/nps/_components/new-campaign-modal.tsx) -- this
    // guards against a future format drift breaking the mixed sort again.
    expect(quarterSortKey("4Q25")).toBeLessThan(quarterSortKey("1Q26"));
  });

  it("returns 0 for an unparseable string, rather than throwing", () => {
    expect(quarterSortKey("Q1'26")).toBe(0);
    expect(quarterSortKey("")).toBe(0);
    expect(quarterSortKey("garbage")).toBe(0);
  });
});
