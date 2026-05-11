// Regression tests for the Monday name-matching utilities.
// The "." bug from Phase 2 Pass H: an SF account literally named "." normalised
// to an empty string, and the prefix matcher's `norm.startsWith(an)` returned
// true for any input — every Monday item incorrectly "matched" the junk account.

import { describe, it, expect } from "vitest";
import {
  normalizeName,
  nameSimilarity,
} from "@/lib/import/monday-customers";

describe("normalizeName", () => {
  it("strips company suffixes case-insensitively", () => {
    expect(normalizeName("Acme Inc.")).toBe("acme");
    expect(normalizeName("Acme, LLC")).toBe("acme");
    expect(normalizeName("Acme Corp")).toBe("acme");
    expect(normalizeName("Acme GmbH")).toBe("acme");
  });

  it("collapses punctuation + whitespace", () => {
    expect(normalizeName("Dish - Ecostar")).toBe("dishecostar");
    expect(normalizeName("Bradley & Beams")).toBe("bradleybeams");
    expect(normalizeName("SSD/SKP")).toBe("ssdskp");
  });

  it("returns empty for purely punctuation input (regression for the '.' bug)", () => {
    expect(normalizeName(".")).toBe("");
    expect(normalizeName("...")).toBe("");
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName(",,,")).toBe("");
  });

  it("guards downstream prefix matching against empty-normalised strings", () => {
    // The "." bug: a normalised empty string makes any norm.startsWith(an)
    // return true. Callers must defend by checking length > 0 before doing
    // prefix matches. This test documents the invariant that "." → "".
    const dotNorm = normalizeName(".");
    expect(dotNorm.length).toBe(0);
    expect("pepsi".startsWith(dotNorm)).toBe(true); // documents the foot-gun
    expect("anything-at-all".startsWith(dotNorm)).toBe(true);
  });
});

describe("nameSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(nameSimilarity("Pepsi", "Pepsi")).toBe(1);
  });
  it("returns 0 for entirely disjoint names", () => {
    expect(nameSimilarity("Pepsi", "Mitie")).toBe(0);
  });
  it("ignores stopwords (inc, corp, etc.)", () => {
    expect(nameSimilarity("Acme Inc", "Acme Corp")).toBe(1);
  });
  it("scores partial overlap proportionally", () => {
    const score = nameSimilarity("Wipro FSS", "Wipro Americas Strategic Unit");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
  it("is case-insensitive", () => {
    expect(nameSimilarity("CSA Transport", "csa transport")).toBe(1);
  });
});
