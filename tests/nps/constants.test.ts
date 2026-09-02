import { describe, it, expect } from "vitest";
import { quarterSortKey, currentFiscalQuarter } from "@/lib/nps/constants";

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

describe("currentFiscalQuarter", () => {
  // Kognitos FY runs Feb-Jan, named after the year it ends in. This is the
  // exact rule the 2026-09-02 historical NPS backfill used to relabel
  // 2Q24-4Q24 -> 2Q25-4Q25 and to split a mixed "4Q26" bucket into
  // 4Q26/1Q27/2Q27 by response_date -- these cases guard against drift.
  it("puts January in Q4 of the same calendar year", () => {
    expect(currentFiscalQuarter(new Date("2026-01-15"))).toEqual({ quarterNum: 4, year: 2026 });
  });

  it("puts November and December in Q4 of the following calendar year", () => {
    expect(currentFiscalQuarter(new Date("2025-11-01"))).toEqual({ quarterNum: 4, year: 2026 });
    expect(currentFiscalQuarter(new Date("2025-12-31"))).toEqual({ quarterNum: 4, year: 2026 });
  });

  it("puts February-April in Q1 of the following calendar year", () => {
    expect(currentFiscalQuarter(new Date("2025-02-01"))).toEqual({ quarterNum: 1, year: 2026 });
    expect(currentFiscalQuarter(new Date("2025-04-30"))).toEqual({ quarterNum: 1, year: 2026 });
  });

  it("puts May-July in Q2 of the following calendar year", () => {
    expect(currentFiscalQuarter(new Date("2025-05-01"))).toEqual({ quarterNum: 2, year: 2026 });
    expect(currentFiscalQuarter(new Date("2025-07-31"))).toEqual({ quarterNum: 2, year: 2026 });
  });

  it("puts August-October in Q3 of the following calendar year", () => {
    expect(currentFiscalQuarter(new Date("2025-08-01"))).toEqual({ quarterNum: 3, year: 2026 });
    expect(currentFiscalQuarter(new Date("2025-10-31"))).toEqual({ quarterNum: 3, year: 2026 });
  });

  it("matches the known historical backfill case: a Jan 2026 response is 4Q26", () => {
    // Norco/Tia Bell, response_date 2026-01-01 -- confirmed against the
    // team's canonical Excel tracker during the 2026-09-02 backfill.
    const { quarterNum, year } = currentFiscalQuarter(new Date("2026-01-01"));
    expect(`${quarterNum}Q${String(year).slice(-2)}`).toBe("4Q26");
  });

  it("matches the known historical backfill case: a Feb 2026 response is 1Q27", () => {
    const { quarterNum, year } = currentFiscalQuarter(new Date("2026-02-03"));
    expect(`${quarterNum}Q${String(year).slice(-2)}`).toBe("1Q27");
  });
});
