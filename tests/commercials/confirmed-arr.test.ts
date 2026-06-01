import { describe, expect, it } from "vitest";
import {
  CONFIRMED_ARR_OVERRIDES,
  deriveConfirmedArrFromOpps,
  getConfirmedArrForCustomer,
} from "@/lib/commercials/confirmed-arr";

describe("getConfirmedArrForCustomer", () => {
  it("applies Norco GTM override instead of latest SF won opp", () => {
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

    const corrected = getConfirmedArrForCustomer("norco", opps);
    expect(corrected.arr).toBe(CONFIRMED_ARR_OVERRIDES.norco);
    expect(corrected.arr).toBe(284_000);
  });
});
