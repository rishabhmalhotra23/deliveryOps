// The override allow-list and the ARR resolution it feeds. The store's
// database calls aren't exercised here — validation is, because it's what
// stands between a typo and an override that silently never applies.

import { describe, it, expect } from "vitest";
import { OVERRIDABLE_FIELDS, OVERRIDE_ENTITY_TYPES } from "@/lib/overrides/store";
import { getConfirmedArrForCustomer } from "@/lib/commercials/confirmed-arr";
import { slugifyCustomerKey } from "@/lib/customers/slug";

describe("OVERRIDABLE_FIELDS", () => {
  it("declares an entity type that is one of the allowed ones", () => {
    for (const [field, spec] of Object.entries(OVERRIDABLE_FIELDS)) {
      expect(OVERRIDE_ENTITY_TYPES, `${field} entityType`).toContain(spec.entityType);
    }
  });

  it("names a source and label for every field, since the UI asks by name", () => {
    for (const [field, spec] of Object.entries(OVERRIDABLE_FIELDS)) {
      expect(spec.source, `${field} source`).toBeTruthy();
      expect(spec.label, `${field} label`).toBeTruthy();
    }
  });

  it("covers the field the hardcoded map used to hold", () => {
    // CONFIRMED_ARR_OVERRIDES existed solely for this. If it isn't
    // overridable, migration 0041's seeded Norco row would never apply.
    expect(OVERRIDABLE_FIELDS.confirmed_arr).toBeDefined();
    expect(OVERRIDABLE_FIELDS.confirmed_arr!.entityType).toBe("customer");
  });
});

describe("ARR override resolution", () => {
  const opps = [
    { amount: 689_000, close_date: "2026-04-15", is_won: true, is_closed: true },
    { amount: 284_000, close_date: "2025-04-01", is_won: true, is_closed: true },
  ];

  it("takes the override over the most recent Closed-Won opp", () => {
    expect(getConfirmedArrForCustomer("norco", opps, { norco: 311_000 }).arr).toBe(311_000);
  });

  it("leaves other customers on the Salesforce derivation", () => {
    expect(getConfirmedArrForCustomer("jbi", opps, { norco: 311_000 }).arr).toBe(689_000);
  });

  it("treats a missing customer key as no override rather than throwing", () => {
    expect(getConfirmedArrForCustomer(null, opps, { norco: 311_000 }).arr).toBe(689_000);
    expect(getConfirmedArrForCustomer(undefined, opps, { norco: 311_000 }).arr).toBe(689_000);
  });

  it("applies an override of 0 — a real correction, not a missing value", () => {
    // `override == null` is the guard, deliberately not falsiness: a customer
    // corrected to $0 ARR must not silently fall back to Salesforce's number.
    const zeroed = getConfirmedArrForCustomer("norco", opps, { norco: 0 });
    expect(zeroed.arr).toBe(0);
    expect(zeroed.overridden).toBe(true);
  });
});

describe("slugifyCustomerKey — one implementation, two consumers", () => {
  // The Configure dialog carried its own copy for a while, and it disagreed
  // on exactly this case: a customer added from the UI would have got
  // "bradley-beams" while every server-side path produced
  // "bradley-and-beams", i.e. a different customer.
  it("expands & to 'and', which the duplicated client copy did not", () => {
    expect(slugifyCustomerKey("Bradley & Beams")).toBe("bradley-and-beams");
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugifyCustomerKey("  Wipro  FSS -- India!  ")).toBe("wipro-fss-india");
  });

  it("lowercases", () => {
    expect(slugifyCustomerKey("Scan Health")).toBe("scan-health");
  });
});
