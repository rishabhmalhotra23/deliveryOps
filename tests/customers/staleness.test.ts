import { describe, it, expect } from "vitest";
import {
  computeStaleFields,
  CUSTOMER_FRESHNESS_FIELDS,
  type FreshnessFieldConfig,
} from "@/lib/customers/staleness";

const FIELDS: FreshnessFieldConfig[] = [
  { key: "health_score", label: "Health score", thresholdDays: 30, source: "internal_profile" },
  { key: "renewal_date", label: "Renewal date", thresholdDays: 90, source: "profile" },
];

describe("computeStaleFields", () => {
  const now = new Date("2026-08-19T00:00:00.000Z");

  it("flags a field with no provenance as stale once the record itself is older than the threshold", () => {
    const stale = computeStaleFields(
      FIELDS,
      {
        profile: { field_provenance: {}, updated_at: "2026-01-01T00:00:00.000Z" },
        internalProfile: { field_provenance: {}, updated_at: "2026-01-01T00:00:00.000Z" },
      },
      now
    );
    expect(stale.map((s) => s.key)).toEqual(["health_score", "renewal_date"]);
  });

  it("does not flag a field with no provenance if the record itself is recent", () => {
    const stale = computeStaleFields(
      FIELDS,
      {
        profile: { field_provenance: {}, updated_at: "2026-08-18T00:00:00.000Z" },
        internalProfile: { field_provenance: {}, updated_at: "2026-08-18T00:00:00.000Z" },
      },
      now
    );
    expect(stale).toEqual([]);
  });

  it("uses the per-field provenance timestamp over the record's updated_at when present", () => {
    const stale = computeStaleFields(
      FIELDS,
      {
        profile: {
          field_provenance: { renewal_date: { by: "rishabh", at: "2026-08-01T00:00:00.000Z" } },
          updated_at: "2020-01-01T00:00:00.000Z", // ancient, but renewal_date was confirmed recently
        },
        internalProfile: { field_provenance: {}, updated_at: "2020-01-01T00:00:00.000Z" },
      },
      now
    );
    const keys = stale.map((s) => s.key);
    expect(keys).toContain("health_score"); // untouched, record is ancient -> stale
    expect(keys).not.toContain("renewal_date"); // confirmed 18 days ago, under the 90-day threshold
  });

  it("reports who confirmed the field and how many days ago, when provenance exists", () => {
    const stale = computeStaleFields(
      FIELDS,
      {
        profile: {
          field_provenance: { renewal_date: { by: "rishabh", at: "2026-01-01T00:00:00.000Z" } },
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        internalProfile: { field_provenance: {}, updated_at: "2026-01-01T00:00:00.000Z" },
      },
      now
    );
    const renewal = stale.find((s) => s.key === "renewal_date");
    expect(renewal).toBeDefined();
    expect(renewal?.lastConfirmedBy).toBe("rishabh");
    expect(renewal?.daysSinceConfirmed).toBe(230);
  });

  it("treats the exact threshold boundary as stale (>=, not >)", () => {
    const stale = computeStaleFields(
      [{ key: "health_score", label: "Health score", thresholdDays: 30, source: "internal_profile" }],
      {
        internalProfile: { field_provenance: {}, updated_at: "2026-07-20T00:00:00.000Z" }, // exactly 30 days before `now`
      },
      now
    );
    expect(stale.map((s) => s.key)).toEqual(["health_score"]);
  });

  it("skips a field whose source record wasn't provided", () => {
    const stale = computeStaleFields(FIELDS, { profile: undefined, internalProfile: undefined }, now);
    expect(stale).toEqual([]);
  });
});

describe("CUSTOMER_FRESHNESS_FIELDS", () => {
  it("is non-empty and every field has a positive threshold", () => {
    expect(CUSTOMER_FRESHNESS_FIELDS.length).toBeGreaterThan(0);
    for (const f of CUSTOMER_FRESHNESS_FIELDS) {
      expect(f.thresholdDays).toBeGreaterThan(0);
    }
  });
});
