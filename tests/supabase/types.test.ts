import { describe, it, expect } from "vitest";
import { computeNpsScore } from "@/lib/supabase/types";

describe("computeNpsScore", () => {
  it("returns null when there are no responses", () => {
    expect(computeNpsScore({ promoter: 0, detractor: 0, total: 0 })).toBeNull();
  });

  it("returns 100 when every respondent is a promoter", () => {
    expect(computeNpsScore({ promoter: 5, detractor: 0, total: 5 })).toBe(100);
  });

  it("returns -100 when every respondent is a detractor", () => {
    expect(computeNpsScore({ promoter: 0, detractor: 5, total: 5 })).toBe(-100);
  });

  it("returns 0 when promoters and detractors balance out", () => {
    expect(computeNpsScore({ promoter: 3, detractor: 3, total: 10 })).toBe(0);
  });

  it("excludes passives from the numerator but keeps them in the total", () => {
    // 6 promoters, 2 detractors, 2 passives -> (6-2)/10 * 100 = 40
    expect(computeNpsScore({ promoter: 6, detractor: 2, total: 10 })).toBe(40);
  });

  it("rounds to the nearest integer", () => {
    // (2-1)/3 * 100 = 33.33...
    expect(computeNpsScore({ promoter: 2, detractor: 1, total: 3 })).toBe(33);
  });
});
