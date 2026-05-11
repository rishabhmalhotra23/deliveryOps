// Tests for the formatting utilities used in the dashboard + customer page.

import { describe, it, expect, vi } from "vitest";
import { formatMoney, formatTimeAgo } from "@/app/_components/brand";

describe("formatMoney", () => {
  it("renders compact suffixes by default", () => {
    expect(formatMoney(1_500)).toBe("$2K"); // rounds via toFixed(0)
    expect(formatMoney(50_000)).toBe("$50K");
    expect(formatMoney(2_500_000)).toBe("$2.5M");
    expect(formatMoney(1_300_000_000)).toBe("$1.3B");
  });
  it("handles small / sub-thousand amounts as full numerals", () => {
    expect(formatMoney(384)).toBe("$384");
    expect(formatMoney(0)).toBe("$0");
  });
  it("returns the em-dash for null / undefined", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });
  it("respects opts.compact=false", () => {
    expect(formatMoney(384_335, { compact: false })).toBe("$384,335");
  });
});

describe("formatTimeAgo", () => {
  it("returns 'never' for null", () => {
    expect(formatTimeAgo(null)).toBe("never");
  });
  it("returns 'just now' for very recent timestamps", () => {
    expect(formatTimeAgo(new Date(Date.now() - 30_000).toISOString())).toBe("just now");
  });
  it("returns minutes-ago for sub-hour timestamps", () => {
    expect(formatTimeAgo(new Date(Date.now() - 15 * 60_000).toISOString())).toBe("15m ago");
  });
  it("returns hours-ago for sub-day timestamps", () => {
    expect(formatTimeAgo(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
  });
  it("returns days-ago for older timestamps", () => {
    expect(formatTimeAgo(new Date(Date.now() - 5 * 86_400_000).toISOString())).toBe("5d ago");
  });
});
