// Tests for the category resolution + sort helpers used everywhere the UI
// renders a category chip. categoryFromCustomer is the single source of truth
// for "what bucket is this customer in" — used by the dashboard, customer page,
// and operations chat. Regressions here would silently miscategorise customers
// across the UI.

import { describe, it, expect } from "vitest";
import {
  categoryFromCustomer,
  categorySortIndex,
  CATEGORY_ORDER,
} from "@/app/_components/brand";

describe("categoryFromCustomer", () => {
  it("prefers custom_category when present (DeliveryOps's operational truth)", () => {
    expect(
      categoryFromCustomer({ custom_category: "Strategic Growth", lifecycle_group: "Churned/Dropped" })
    ).toBe("Strategic Growth");
  });

  it("falls back to mapped lifecycle_group when custom_category is empty", () => {
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "High Risk" })).toBe("At Risk");
    expect(categoryFromCustomer({ custom_category: "", lifecycle_group: "Growth / Focus" })).toBe(
      "Strategic Growth"
    );
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "POV" })).toBe("POV");
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "Churned/Dropped" })).toBe(
      "Churned"
    );
    // New in Phase 2 Pass I — Monday added "To be Dropped" as a group.
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "To be Dropped" })).toBe(
      "To Drop"
    );
  });

  it("defaults to Active when both fields are missing or unrecognised", () => {
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: null })).toBe("Active");
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "Unknown" })).toBe("Active");
  });

  it("trims whitespace on custom_category", () => {
    expect(
      categoryFromCustomer({ custom_category: "  At Risk  ", lifecycle_group: null })
    ).toBe("At Risk");
  });

  it("never returns the raw lifecycle_group label (regressions for mixed UI)", () => {
    // The legacy "High Risk" must never bleed through to the rendered UI —
    // we always show DeliveryOps's "At Risk".
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "High Risk" })).not.toBe(
      "High Risk"
    );
  });
});

describe("categorySortIndex", () => {
  it("orders categories in declared priority", () => {
    const indices = CATEGORY_ORDER.map((c) => categorySortIndex(c));
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });
  it("puts At Risk first, To Drop near the bottom, Churned last", () => {
    expect(categorySortIndex("At Risk")).toBe(0);
    expect(categorySortIndex("To Drop")).toBe(6);
    expect(categorySortIndex("Churned")).toBe(7);
  });
  it("sends unknown categories to the bottom (99)", () => {
    expect(categorySortIndex("Strategic Logos")).toBe(99);
    expect(categorySortIndex("")).toBe(99);
  });
});
