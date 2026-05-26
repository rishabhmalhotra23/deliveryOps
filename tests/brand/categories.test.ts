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
    // Monday lumps churned + dropped customers into one group — we default to
    // the neutral "Past" so the UI never claims a customer churned when they
    // were actually dropped pre-go-live (or vice versa). The FDE disambiguates
    // per-customer via the inline-edit category dropdown.
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "Churned/Dropped" })).toBe(
      "Past"
    );
    // Per-customer override wins, as for every other category.
    expect(
      categoryFromCustomer({ custom_category: "Churned", lifecycle_group: "Churned/Dropped" })
    ).toBe("Churned");
    expect(
      categoryFromCustomer({ custom_category: "Dropped", lifecycle_group: "Churned/Dropped" })
    ).toBe("Dropped");
    // New in Phase 2 Pass I — Monday added "To be Dropped" as a group.
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "To be Dropped" })).toBe(
      "To Drop"
    );
    // "Tier 2 - Secondary Priority" now maps to the renamed "Secondary
    // Priority" canonical key (was "Active" pre-2026-05).
    expect(
      categoryFromCustomer({ custom_category: null, lifecycle_group: "Tier 2 - Secondary Priority" })
    ).toBe("Secondary Priority");
  });

  it("defaults to Secondary Priority when both fields are missing or unrecognised", () => {
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: null })).toBe("Secondary Priority");
    expect(categoryFromCustomer({ custom_category: null, lifecycle_group: "Unknown" })).toBe("Secondary Priority");
  });

  describe("dynamic rules from signals", () => {
    const today = new Date();
    const isoDaysFromNow = (days: number): string => {
      const d = new Date(today.getTime() + days * 86_400_000);
      return d.toISOString().slice(0, 10);
    };

    it("flips to Upcoming Renewals when renewal_date is within 90 days", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: "Growth / Focus" }, // would normally be Strategic Growth
          { renewal_date: isoDaysFromNow(45) }
        )
      ).toBe("Upcoming Renewals");
    });

    it("does NOT flip to Upcoming Renewals when renewal is >90 days away", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: "Growth / Focus" },
          { renewal_date: isoDaysFromNow(120) }
        )
      ).toBe("Strategic Growth");
    });

    it("does NOT flip to Upcoming Renewals when renewal is in the past", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: null },
          { renewal_date: isoDaysFromNow(-30) }
        )
      ).toBe("Secondary Priority");
    });

    it("flips to Strategic Growth when annual_revenue > $20M", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: null },
          { annual_revenue: 25_000_000 }
        )
      ).toBe("Strategic Growth");
    });

    it("does NOT flip to Strategic Growth at exactly $20M (threshold is strict)", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: null },
          { annual_revenue: 20_000_000 }
        )
      ).toBe("Secondary Priority");
    });

    it("small companies default to Secondary Priority", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: null },
          { annual_revenue: 5_000_000 }
        )
      ).toBe("Secondary Priority");
    });

    it("renewal-in-90-days beats revenue>$20M (renewal is more actionable)", () => {
      expect(
        categoryFromCustomer(
          { custom_category: null, lifecycle_group: null },
          { renewal_date: isoDaysFromNow(30), annual_revenue: 50_000_000 }
        )
      ).toBe("Upcoming Renewals");
    });

    it("POV / To Drop / Past / Partner Managed / At Risk survive the dynamic rules", () => {
      const big = { annual_revenue: 100_000_000 };
      expect(
        categoryFromCustomer({ custom_category: null, lifecycle_group: "POV" }, big)
      ).toBe("POV");
      expect(
        categoryFromCustomer({ custom_category: null, lifecycle_group: "To be Dropped" }, big)
      ).toBe("To Drop");
      expect(
        categoryFromCustomer({ custom_category: null, lifecycle_group: "Churned/Dropped" }, big)
      ).toBe("Past");
      expect(
        categoryFromCustomer({ custom_category: null, lifecycle_group: "Partner Managed" }, big)
      ).toBe("Partner Managed");
      expect(
        categoryFromCustomer({ custom_category: null, lifecycle_group: "High Risk" }, big)
      ).toBe("At Risk");
    });

    it("custom_category override beats every dynamic rule", () => {
      expect(
        categoryFromCustomer(
          { custom_category: "Active", lifecycle_group: null },
          { renewal_date: "2026-06-01", annual_revenue: 100_000_000 }
        )
      ).toBe("Active");
    });
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
  it("puts At Risk first, To Drop near the bottom, past states last", () => {
    expect(categorySortIndex("At Risk")).toBe(0);
    expect(categorySortIndex("To Drop")).toBe(6);
    // Past states sit at the end: Past (auto-class) → Churned → Dropped.
    expect(categorySortIndex("Past")).toBe(7);
    expect(categorySortIndex("Churned")).toBe(8);
    expect(categorySortIndex("Dropped")).toBe(9);
  });
  it("sends unknown categories to the bottom (99)", () => {
    expect(categorySortIndex("Strategic Logos")).toBe(99);
    expect(categorySortIndex("")).toBe(99);
  });
});
