import { describe, it, expect } from "vitest";
import { findRenewalSpotlight, findAtRiskMigratingCustomers, type CustomerForSignals } from "@/lib/reports/allhands-signals";
import type { Process } from "@/lib/supabase/types";

function customer(overrides: Partial<CustomerForSignals>): CustomerForSignals {
  return { id: "c1", key: "acme", display_name: "Acme", custom_category: null, lifecycle_group: null, ...overrides };
}
function proc(overrides: Partial<Pick<Process, "customer_id" | "lifecycle" | "migration_stage">>): Pick<Process, "customer_id" | "lifecycle" | "migration_stage"> {
  return { customer_id: "c1", lifecycle: "live", migration_stage: "not_required", ...overrides };
}

describe("findRenewalSpotlight", () => {
  it("returns the soonest-renewing customer within 90 days", () => {
    const customers = [customer({ id: "c1", key: "norco", display_name: "Norco" })];
    const arrByCustomer = new Map([["c1", { arr: 311000, renewal_date: "2026-09-24" }]]);
    const processesByCustomer = new Map([
      ["c1", [proc({ lifecycle: "live" }), proc({ lifecycle: "in_development", migration_stage: "in_development" })]],
    ]);
    const spotlight = findRenewalSpotlight(customers, arrByCustomer, processesByCustomer, new Date("2026-08-07"));
    expect(spotlight?.customerKey).toBe("norco");
    expect(spotlight?.arr).toBe(311000);
    expect(spotlight?.liveProcessCount).toBe(1);
    expect(spotlight?.migratingProcessCount).toBe(1);
  });

  it("returns null when nothing renews within 90 days", () => {
    const customers = [customer({ id: "c1" })];
    const arrByCustomer = new Map([["c1", { arr: 100000, renewal_date: "2027-01-01" }]]);
    expect(findRenewalSpotlight(customers, arrByCustomer, new Map(), new Date("2026-08-07"))).toBeNull();
  });

  it("returns null when no customer has a renewal date at all", () => {
    const customers = [customer({ id: "c1" })];
    expect(findRenewalSpotlight(customers, new Map([["c1", { arr: 0, renewal_date: null }]]), new Map(), new Date("2026-08-07"))).toBeNull();
  });

  it("breaks a tie on renewal days by picking the higher-ARR customer", () => {
    // Production has a real 3-way tie (Conectiv / Scan Health / Pepsi, 24 days out
    // as of 2026-08-07) and the customers query has no .order(), so without an
    // explicit tiebreak the winner varied between page loads and PNG exports.
    const customers = [
      customer({ id: "c1", key: "small", display_name: "Small Co" }),
      customer({ id: "c2", key: "big", display_name: "Big Co" }),
    ];
    const arrByCustomer = new Map([
      ["c1", { arr: 100_000, renewal_date: "2026-08-31" }],
      ["c2", { arr: 900_000, renewal_date: "2026-08-31" }],
    ]);
    const spotlight = findRenewalSpotlight(customers, arrByCustomer, new Map(), new Date("2026-08-07"));
    expect(spotlight?.customerKey).toBe("big");
    // Same answer regardless of the order the rows arrive in.
    const reversed = findRenewalSpotlight([...customers].reverse(), arrByCustomer, new Map(), new Date("2026-08-07"));
    expect(reversed?.customerKey).toBe("big");
  });

  it("breaks a tie on both days and ARR by picking the lexicographically smaller key", () => {
    const customers = [
      customer({ id: "c1", key: "zulu", display_name: "Zulu" }),
      customer({ id: "c2", key: "alpha", display_name: "Alpha" }),
    ];
    const arrByCustomer = new Map([
      ["c1", { arr: 250_000, renewal_date: "2026-08-31" }],
      ["c2", { arr: 250_000, renewal_date: "2026-08-31" }],
    ]);
    const spotlight = findRenewalSpotlight(customers, arrByCustomer, new Map(), new Date("2026-08-07"));
    expect(spotlight?.customerKey).toBe("alpha");
    const reversed = findRenewalSpotlight([...customers].reverse(), arrByCustomer, new Map(), new Date("2026-08-07"));
    expect(reversed?.customerKey).toBe("alpha");
  });
});

describe("findAtRiskMigratingCustomers", () => {
  it("flags a customer that is both At Risk and has active migration work", () => {
    const customers = [customer({ id: "c1", custom_category: "At Risk" })];
    const processesByCustomer = new Map([
      ["c1", [proc({ migration_stage: "parity_testing" }), proc({ migration_stage: "not_required" })]],
    ]);
    const result = findAtRiskMigratingCustomers(customers, processesByCustomer);
    expect(result).toEqual([{ customerKey: "acme", customerName: "Acme", migratingProcessCount: 1 }]);
  });

  it("excludes At Risk customers with no active migration work", () => {
    const customers = [customer({ id: "c1", custom_category: "At Risk" })];
    const processesByCustomer = new Map([["c1", [proc({ migration_stage: "not_required" })]]]);
    expect(findAtRiskMigratingCustomers(customers, processesByCustomer)).toEqual([]);
  });

  it("excludes migrating customers that are not At Risk", () => {
    const customers = [customer({ id: "c1", custom_category: "Strategic Growth" })];
    const processesByCustomer = new Map([["c1", [proc({ migration_stage: "parity_testing" })]]]);
    expect(findAtRiskMigratingCustomers(customers, processesByCustomer)).toEqual([]);
  });
});
