// Validation and fallback behaviour for app_settings (0043).
//
// The fallbacks matter more than they look: these figures drive every "value
// delivered" number on Dashboard → Trends, and a getter that returned 0 for a
// missing row would render the whole section as nothing and read as a data
// problem rather than a config one.

import { describe, it, expect } from "vitest";
import {
  SETTING_DEFAULTS,
  InvalidSettingError,
  setSetting,
  valueModelTierHours,
  valueModelRates,
  valueModelHoursPerFte,
} from "@/lib/settings/store";

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a rejection, got none");
}

describe("compiled defaults match what the constants held", () => {
  // If these drift, deploying 0043 would silently change numbers the team
  // presents. The migration seeds exactly these values for the same reason.
  it("keeps the value model identical to lib/analytics/loader.ts's constants", () => {
    expect(SETTING_DEFAULTS["value_model.tier_hours"]).toEqual({ low: 1200, medium: 2600, high: 5200 });
    expect(SETTING_DEFAULTS["value_model.rates"]).toEqual({ low: 30, mid: 35, high: 45 });
    expect(SETTING_DEFAULTS["value_model.hours_per_fte"]).toBe(2080);
  });

  it("keeps the NPS cadence identical to lib/nps/constants.ts", () => {
    expect(SETTING_DEFAULTS["nps.max_auto_reminders"]).toBe(3);
    expect(SETTING_DEFAULTS["nps.reminder_interval_days"]).toBe(7);
    expect(SETTING_DEFAULTS["nps.from_address"]).toBe("ai.cx@kognitos.com");
  });
});

describe("readers fall back rather than returning zero", () => {
  it("returns the compiled model when settings are empty", () => {
    expect(valueModelTierHours({})).toEqual({ low: 1200, medium: 2600, high: 5200 });
    expect(valueModelRates({})).toEqual({ low: 30, mid: 35, high: 45 });
    expect(valueModelHoursPerFte({})).toBe(2080);
  });

  it("ignores a stored value of the wrong shape instead of trusting it", () => {
    // A string where a number map belongs would otherwise produce NaN in
    // every derived figure.
    expect(valueModelTierHours({ "value_model.tier_hours": "oops" })).toEqual(
      SETTING_DEFAULTS["value_model.tier_hours"]
    );
    expect(valueModelRates({ "value_model.rates": [30, 35, 45] })).toEqual(
      SETTING_DEFAULTS["value_model.rates"]
    );
  });

  it("ignores a non-finite or non-positive hours-per-FTE, which would divide by zero", () => {
    expect(valueModelHoursPerFte({ "value_model.hours_per_fte": 0 })).toBe(2080);
    expect(valueModelHoursPerFte({ "value_model.hours_per_fte": -5 })).toBe(2080);
    expect(valueModelHoursPerFte({ "value_model.hours_per_fte": Number.NaN })).toBe(2080);
  });

  it("uses a stored value when it is well-formed", () => {
    expect(valueModelHoursPerFte({ "value_model.hours_per_fte": 1800 })).toBe(1800);
    expect(valueModelTierHours({ "value_model.tier_hours": { low: 1, medium: 2, high: 3 } })).toEqual({
      low: 1,
      medium: 2,
      high: 3,
    });
  });
});

describe("setSetting validation", () => {
  it("rejects an unknown key rather than storing something nothing reads", async () => {
    const err = await rejection(() => setSetting("value_model.made_up", 1, "test"));
    expect(err).toBeInstanceOf(InvalidSettingError);
    expect(err.message).toContain("Unknown setting");
  });

  it("rejects a type change on a number setting", async () => {
    const err = await rejection(() => setSetting("value_model.hours_per_fte", "2080", "test"));
    expect(err.message).toContain("must be a number");
  });

  it("rejects a type change on a text setting", async () => {
    const err = await rejection(() => setSetting("nps.from_address", 42, "test"));
    expect(err.message).toContain("must be text");
  });

  it("rejects an array where an object of named numbers belongs", async () => {
    const err = await rejection(() => setSetting("value_model.rates", [30, 35, 45], "test"));
    expect(err.message).toContain("object of named numbers");
  });

  it("rejects a negative or non-numeric member of an object setting", async () => {
    expect((await rejection(() => setSetting("value_model.rates", { low: -1, mid: 35, high: 45 }, "test"))).message)
      .toContain("zero or more");
    expect((await rejection(() => setSetting("value_model.rates", { low: "x", mid: 35, high: 45 }, "test"))).message)
      .toContain("zero or more");
  });

  it("rejects a missing member rather than storing a partial model", async () => {
    // {low, mid} without {high} would make value_high fall back per-read and
    // disagree with the other two bands.
    const err = await rejection(() => setSetting("value_model.rates", { low: 30, mid: 35 }, "test"));
    expect(err.message).toContain("high");
  });

  it("refuses to unset a value — there is no null state", async () => {
    const err = await rejection(() => setSetting("value_model.hours_per_fte", null, "test"));
    expect(err.message).toContain("needs a value");
  });
});
