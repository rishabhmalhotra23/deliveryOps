// Zone resolution, which moved from a compiled map to vocabulary_values (0045).
//
// Worth real coverage because the failure is silent and points the wrong way:
// before 0045, `zoneForCategory` fell through to `?? "Focus"` for any category
// it didn't know, so minting "To be dropped post contract expiry" from the
// record card filed that customer under Focus — the active book. The label was
// configurable and its meaning was not. There was no test on zones at all.

import { describe, it, expect } from "vitest";
import { zoneForCategory, FALLBACK_ZONES } from "@/app/_components/brand";
import { contradictionFor } from "@/app/(app)/customers/_components/customers-browser";

const vocab = {
  zones: [
    { value: "focus" },
    { value: "pipeline" },
    { value: "evaluation" },
    { value: "closed" },
  ],
  categories: [
    { value: "Strategic Growth", zone: "focus" },
    { value: "POV", zone: "pipeline" },
    { value: "Churned", zone: "closed" },
    { value: "To be dropped post contract expiry", zone: "closed" },
    // A category whose zone was deleted out from under it.
    { value: "Orphaned", zone: "zone_that_no_longer_exists" },
  ],
};

describe("zoneForCategory with the vocabulary loaded", () => {
  it("uses the configured roll-up", () => {
    expect(zoneForCategory("Strategic Growth", vocab)).toBe("focus");
    expect(zoneForCategory("POV", vocab)).toBe("pipeline");
    expect(zoneForCategory("Churned", vocab)).toBe("closed");
  });

  // The whole point of the change: a category minted in the product can now
  // say it belongs in Closed, instead of silently joining the active book.
  it("lets a minted category file itself under Closed", () => {
    expect(zoneForCategory("To be dropped post contract expiry", vocab)).toBe("closed");
  });

  it("falls back to the first zone when a category's zone was deleted", () => {
    expect(zoneForCategory("Orphaned", vocab)).toBe("focus");
  });

  it("falls back to the first zone for a category with no row", () => {
    expect(zoneForCategory("Never Seen Before", vocab)).toBe("focus");
  });
});

describe("zoneForCategory without a vocabulary", () => {
  // The compiled map is the fallback for a failed load, so it has to keep
  // producing today's answers rather than becoming a second source of truth
  // that drifts.
  it("reproduces the pre-0045 mapping, in slugs", () => {
    expect(zoneForCategory("At Risk")).toBe("focus");
    expect(zoneForCategory("Upcoming Renewals")).toBe("focus");
    expect(zoneForCategory("Strategic Growth")).toBe("focus");
    expect(zoneForCategory("Active")).toBe("focus");
    expect(zoneForCategory("Partner Managed")).toBe("focus");
    expect(zoneForCategory("Secondary Priority")).toBe("focus");
    expect(zoneForCategory("POV")).toBe("pipeline");
    expect(zoneForCategory("Evaluation")).toBe("evaluation");
    expect(zoneForCategory("To Drop")).toBe("closed");
    expect(zoneForCategory("Churned")).toBe("closed");
    expect(zoneForCategory("Past")).toBe("closed");
    expect(zoneForCategory("Dropped")).toBe("closed");
  });

  it("still lands an unknown category somewhere renderable", () => {
    expect(zoneForCategory("Something New")).toBe("focus");
  });
});

describe("FALLBACK_ZONES", () => {
  // Mirrors what 0045 seeds. If the two drift, a failed vocabulary load would
  // group rows under headers the database doesn't have.
  it("matches the four seeded zones, in order", () => {
    expect(FALLBACK_ZONES.map((z) => z.value)).toEqual([
      "focus",
      "pipeline",
      "evaluation",
      "closed",
    ]);
  });

  it("carries a label and a sub-label for each", () => {
    for (const z of FALLBACK_ZONES) {
      expect(z.label.trim(), z.value).not.toBe("");
      expect(z.description.trim(), z.value).not.toBe("");
    }
  });

  it("is what every fallback zone resolves into", () => {
    const values = new Set(FALLBACK_ZONES.map((z) => z.value));
    for (const category of ["At Risk", "POV", "Evaluation", "Churned", "Unknown"]) {
      expect(values.has(zoneForCategory(category)), category).toBe(true);
    }
  });
});

describe("contradictionFor", () => {
  // The chip and the row badge read through this one function. The first
  // version had two copies of the rule and they disagreed: the chip counted 2
  // rows and neither carried a marker, so the page told you something was
  // wrong and gave you no way to find it.
  const zones = [{ value: "focus" }, { value: "closed" }];

  it("flags a retired customer with live work", () => {
    const why = contradictionFor({ active: false, liveProcesses: 2, zone: "closed" }, zones);
    expect(why).toMatch(/no longer a customer/);
    expect(why).toMatch(/still live/);
  });

  it("flags a live customer whose category files it under a closed zone", () => {
    // Bradley & Beams in production: category To Drop, active, 4 live.
    const why = contradictionFor({ active: true, liveProcesses: 4, zone: "closed" }, zones);
    expect(why).toMatch(/closed zone/);
  });

  it("says nothing about an ordinary active customer", () => {
    expect(contradictionFor({ active: true, liveProcesses: 6, zone: "focus" }, zones)).toBeNull();
  });

  it("says nothing about a retired customer with no live work", () => {
    expect(contradictionFor({ active: false, liveProcesses: 0, zone: "closed" }, zones)).toBeNull();
  });

  it("says nothing about a live customer in a closed zone with no live work", () => {
    expect(contradictionFor({ active: true, liveProcesses: 0, zone: "closed" }, zones)).toBeNull();
  });

  it("does not invent a closed-zone rule when no closed zone is configured", () => {
    // A zone can be renamed or deleted, so the rule must degrade rather than
    // assume "closed" exists.
    expect(contradictionFor({ active: true, liveProcesses: 4, zone: "closed" }, [{ value: "focus" }])).toBeNull();
  });

  it("singularises one process", () => {
    expect(contradictionFor({ active: false, liveProcesses: 1, zone: "focus" }, zones)).toMatch(
      /1 process is still live/
    );
  });
});
