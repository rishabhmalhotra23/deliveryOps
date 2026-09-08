import { describe, expect, it } from "vitest";
import {
  deriveConfirmedArrFromOpps,
  getConfirmedArrForCustomer,
} from "@/lib/commercials/confirmed-arr";

// The override map used to be a hardcoded constant in the module under test.
// It is now a parameter, loaded from `field_overrides` (0041) by each caller,
// so these tests pass it in explicitly — which also means they no longer
// depend on Norco specifically being the one customer somebody hardcoded.
describe("getConfirmedArrForCustomer", () => {
  it("applies a human override instead of the latest SF won opp", () => {
    const opps = [
      {
        amount: 689_000,
        close_date: "2026-04-15",
        is_won: true,
        is_closed: true,
      },
      {
        amount: 284_000,
        close_date: "2025-04-01",
        is_won: true,
        is_closed: true,
      },
    ];
    const derived = deriveConfirmedArrFromOpps(opps);
    expect(derived.arr).toBe(689_000);

    const corrected = getConfirmedArrForCustomer("norco", opps, { norco: 311_000 });
    expect(corrected.arr).toBe(311_000);
    expect(corrected.overridden).toBe(true);
  });

  it("falls back to the Salesforce derivation when no override applies", () => {
    const opps = [{ amount: 689_000, close_date: "2026-04-15", is_won: true, is_closed: true }];
    const plain = getConfirmedArrForCustomer("norco", opps);
    expect(plain.arr).toBe(689_000);
    expect(plain.overridden).toBeUndefined();
  });

  it("only applies an override to the customer it belongs to", () => {
    const opps = [{ amount: 689_000, close_date: "2026-04-15", is_won: true, is_closed: true }];
    expect(getConfirmedArrForCustomer("century", opps, { norco: 311_000 }).arr).toBe(689_000);
  });

  it("keeps the derived renewal date and stage — an override corrects the amount only", () => {
    const opps = [{ amount: 689_000, close_date: "2026-04-15", is_won: true, is_closed: true, stage_name: "Closed Won" }];
    const corrected = getConfirmedArrForCustomer("norco", opps, { norco: 311_000 });
    expect(corrected.source_close_date).toBe("2026-04-15");
    expect(corrected.stage).toBe("Closed Won");
  });

  // The delivery review treats an override as a confirmed source even when no
  // Closed-Won opp exists, because the correction itself is GTM truth. That
  // only works if `overridden` is set in that case too.
  it("marks an override as such even with no opps at all", () => {
    const corrected = getConfirmedArrForCustomer("norco", [], { norco: 311_000 });
    expect(corrected.arr).toBe(311_000);
    expect(corrected.overridden).toBe(true);
    expect(corrected.source_close_date).toBeNull();
  });
});
