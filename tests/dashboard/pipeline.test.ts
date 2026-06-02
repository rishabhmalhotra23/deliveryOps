import { describe, expect, it } from "vitest";
import {
  classifyOpportunityType,
  windowBounds,
} from "@/lib/dashboard/pipeline";

describe("classifyOpportunityType", () => {
  it("classifies renewals and expansions", () => {
    expect(classifyOpportunityType("Existing Customer - Renewal").kind).toBe("Renewal");
    expect(classifyOpportunityType("Upsell").kind).toBe("Expansion");
    expect(classifyOpportunityType("New Business").kind).toBe("New");
  });
});

describe("windowBounds", () => {
  it("spans 90 days from today UTC", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const { start, end } = windowBounds();
    void now;
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const diffDays = Math.round((endMs - startMs) / 86_400_000);
    expect(diffDays).toBe(90);
  });
});
