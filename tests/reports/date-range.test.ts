import { describe, it, expect } from "vitest";
import { resolveRange } from "@/lib/reports/date-range";

describe("resolveRange", () => {
  it("defaults to a rolling 7-day window ending now", () => {
    const now = new Date("2026-08-07T14:30:00Z");
    const range = resolveRange({}, now);
    expect(range.preset).toBe("week");
    expect(range.end).toEqual(now);
    expect(range.start.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("resolves a custom range from from/to query strings", () => {
    const now = new Date("2026-08-07T14:30:00Z");
    const range = resolveRange({ preset: "custom", from: "2026-08-01", to: "2026-08-05" }, now);
    expect(range.preset).toBe("custom");
    expect(range.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-05T23:59:59.999Z");
  });

  it("falls back to the week default when custom range is missing from/to", () => {
    const now = new Date("2026-08-07T14:30:00Z");
    const range = resolveRange({ preset: "custom" }, now);
    expect(range.preset).toBe("week");
  });
});
