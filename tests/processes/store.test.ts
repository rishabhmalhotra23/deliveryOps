// buildCreateProcessRow is the pure validation/defaulting core of
// createProcess (lib/processes/store.ts) — split out so the "New Process"
// flow's rules (required fields, forced migration_stage, lifecycle/platform
// defaults) are testable without a live Supabase client.

import { describe, it, expect } from "vitest";
import {
  buildCreateProcessRow,
  pickEditable,
  withDerivedFields,
  stampGoLive,
  InvalidProcessInputError,
  bulkApply,
  bulkUpdateProcesses,
  bulkDeleteProcesses,
  TooManyIdsError,
  MAX_BULK_IDS,
} from "@/lib/processes/store";
import type { Process, ProcessLifecycle } from "@/lib/supabase/types";

function fakeProcess(overrides: Partial<Process> = {}): Process {
  return {
    lifecycle: "discovery",
    ...overrides,
  } as Process;
}

describe("buildCreateProcessRow", () => {
  // The forced stage was `not_required` until 2026-09-04, on the reasoning
  // that new work isn't migration work. Delivery's sections are now derived
  // from migration_stage (lib/delivery/sections.ts), which inverts it: new
  // work is new V2 dev, and v2_native is what routes a process to Active
  // work. Under the old default every process you created would have landed
  // in the V2 migration / migrate-or-retire list instead.
  it("applies delivery defaults and forces migration_stage to v2_native", () => {
    const row = buildCreateProcessRow(
      { process_name: "Invoice reconciliation", account: "Acme Corp" },
      "rishabh@kognitos.com"
    );
    expect(row).toMatchObject({
      process_name: "Invoice reconciliation",
      account: "Acme Corp",
      customer_id: null,
      lifecycle: "backlog",
      platform: "v2",
      migration_stage: "v2_native",
      fde_owner: null,
      updated_by: "rishabh@kognitos.com",
    });
  });

  it("trims process_name and account", () => {
    const row = buildCreateProcessRow(
      { process_name: "  Order sync  ", account: "  Acme Corp  " },
      "rishabh@kognitos.com"
    );
    expect(row.process_name).toBe("Order sync");
    expect(row.account).toBe("Acme Corp");
  });

  it("honors explicit lifecycle, platform, customer_id and fde_owner", () => {
    const row = buildCreateProcessRow(
      {
        process_name: "Order sync",
        account: "Acme Corp",
        customer_id: "cust-1",
        lifecycle: "discovery",
        platform: "custom",
        fde_owner: "Karthik N.",
      },
      "rishabh@kognitos.com"
    );
    expect(row).toMatchObject({
      customer_id: "cust-1",
      lifecycle: "discovery",
      platform: "custom",
      fde_owner: "Karthik N.",
    });
  });

  it("rejects a blank process name", () => {
    expect(() => buildCreateProcessRow({ process_name: "   ", account: "Acme Corp" }, "actor")).toThrow(
      InvalidProcessInputError
    );
  });

  it("rejects a blank account", () => {
    expect(() => buildCreateProcessRow({ process_name: "Order sync", account: "  " }, "actor")).toThrow(
      InvalidProcessInputError
    );
  });
});

describe("withDerivedFields", () => {
  it("derives lifecycle from an in-flight migration_stage move", () => {
    const existing = fakeProcess({ lifecycle: "discovery" });
    const next = withDerivedFields(existing, { migration_stage: "in_development" });
    expect(next.lifecycle).toBe("in_development");
  });

  it("still derives lifecycle from a migration_stage change", () => {
    const existing = fakeProcess({ lifecycle: "discovery" });
    const next = withDerivedFields(existing, { migration_stage: "parity_testing" });
    expect(next.lifecycle).toBe("uat");
  });

  // Phase was retired on 2026-09-08. It used to be derived here 1:1 from
  // lifecycle on every write, which is exactly why it never carried
  // information the lifecycle chip beside it didn't already show: blank on 111
  // of 149 production rows, and where set it just restated its neighbour.
  // Asserted rather than deleted so nobody reintroduces the derivation.
  it("no longer writes phase", () => {
    const existing = fakeProcess({ lifecycle: "discovery" });
    expect(withDerivedFields(existing, { migration_stage: "parity_testing" })).not.toHaveProperty("phase");
    expect(withDerivedFields(existing, { lifecycle: "live" })).not.toHaveProperty("phase");
  });

  it("never overrides an explicit lifecycle in the same patch", () => {
    const existing = fakeProcess({ lifecycle: "discovery" });
    const next = withDerivedFields(existing, {
      migration_stage: "in_development",
      lifecycle: "on_hold",
    });
    expect(next.lifecycle).toBe("on_hold");
  });

  it("does not touch lifecycle when migration_stage carries no delivery signal (not_required)", () => {
    const existing = fakeProcess({ lifecycle: "discovery" });
    const next = withDerivedFields(existing, { migration_stage: "not_required" });
    expect(next.lifecycle).toBeUndefined();
  });

  it("never overrides a deliberate hold or terminal lifecycle", () => {
    for (const held of ["on_hold", "needs_triage", "cancelled", "churned", "retired"] as ProcessLifecycle[]) {
      const existing = fakeProcess({ lifecycle: held });
      const next = withDerivedFields(existing, { migration_stage: "live_on_v2" });
      expect(next.lifecycle).toBeUndefined();
    }
  });

  it("is a no-op when the derived value already matches the current one", () => {
    const existing = fakeProcess({ lifecycle: "in_development" });
    const next = withDerivedFields(existing, { migration_stage: "engg_pending" });
    expect(next.lifecycle).toBeUndefined();
  });
});

describe("bulkApply", () => {
  it("collects successes and continues past a failing id", async () => {
    const result = await bulkApply(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("boom");
      return `ok-${id}`;
    });
    expect(result.updated).toEqual(["ok-a", "ok-c"]);
    expect(result.failed).toEqual([{ id: "b", error: "boom" }]);
  });

  it("returns everything as updated when nothing fails", async () => {
    const result = await bulkApply(["a", "b"], async (id) => id.toUpperCase());
    expect(result.updated).toEqual(["A", "B"]);
    expect(result.failed).toEqual([]);
  });

  it("stringifies a non-Error throw", async () => {
    const result = await bulkApply(["a"], async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "not an Error object";
    });
    expect(result.failed).toEqual([{ id: "a", error: "not an Error object" }]);
  });
});

describe("bulk request size cap", () => {
  it("rejects a bulk update over the cap before touching Supabase", async () => {
    const ids = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
    await expect(bulkUpdateProcesses(ids, {}, "actor")).rejects.toThrow(TooManyIdsError);
  });

  it("rejects a bulk delete over the cap before touching Supabase", async () => {
    const ids = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
    await expect(bulkDeleteProcesses(ids, "actor")).rejects.toThrow(TooManyIdsError);
  });
});

// completion_pct is stored as a 0..1 fraction while every UI surface talks in
// whole percents. A scaling slip in one surface used to write 65 instead of
// 0.65, which rendered as "6500%" and a progress bar wider than the table, so
// the store clamps rather than trusting callers to convert.
describe("pickEditable / completion_pct", () => {
  it("keeps a valid fraction untouched", () => {
    expect(pickEditable({ completion_pct: 0.65 }).completion_pct).toBe(0.65);
    expect(pickEditable({ completion_pct: 0 }).completion_pct).toBe(0);
    expect(pickEditable({ completion_pct: 1 }).completion_pct).toBe(1);
  });

  it("clamps a percent mistakenly sent on a 0..100 scale", () => {
    expect(pickEditable({ completion_pct: 65 }).completion_pct).toBe(1);
  });

  it("clamps negatives", () => {
    expect(pickEditable({ completion_pct: -3 }).completion_pct).toBe(0);
  });

  it("nulls a non-finite value rather than storing NaN", () => {
    expect(pickEditable({ completion_pct: Number.NaN }).completion_pct).toBeNull();
  });

  it("leaves the field alone when the patch doesn't mention it", () => {
    expect("completion_pct" in pickEditable({ notes: "hi" })).toBe(false);
  });
});


describe("stampGoLive", () => {
  // Nothing stamped went_live_at before 2026-09-08. The notifier was designed
  // in 0019's header comment, built, then archived, and MIGRATION_DONE_STAGE
  // survived with no caller — so the column was permanently null and
  // lib/reports/delivery-review-loader.ts documented the resulting
  // under-reporting as a known write-path gap. This is the write path.
  const live = (overrides: Partial<Process> = {}) =>
    fakeProcess({ lifecycle: "uat", migration_stage: "in_development", went_live_at: null, ...overrides });

  it("stamps when lifecycle flips to live", () => {
    const out = stampGoLive(live(), { lifecycle: "live" }, "2026-09-08T10:00:00.000Z");
    expect(out.went_live_at).toBe("2026-09-08T10:00:00.000Z");
  });

  it("stamps when migration_stage reaches live_on_v2", () => {
    const out = stampGoLive(live(), { migration_stage: "live_on_v2" }, "2026-09-08T10:00:00.000Z");
    expect(out.went_live_at).toBe("2026-09-08T10:00:00.000Z");
  });

  // Idempotency is the whole reason went_live_at exists rather than a boolean:
  // re-saving a live process must not move the date, or "when did this ship"
  // becomes "when was it last edited".
  it("never re-stamps a process that already shipped", () => {
    const already = live({ lifecycle: "live", went_live_at: "2026-05-14T00:00:00.000Z" });
    const out = stampGoLive(already, { health: "on_track" }, "2026-09-08T10:00:00.000Z");
    expect(out.went_live_at).toBeUndefined();
  });

  it("does not stamp an edit that leaves the process pre-live", () => {
    const out = stampGoLive(live(), { lifecycle: "uat" }, "2026-09-08T10:00:00.000Z");
    expect(out.went_live_at).toBeUndefined();
  });

  it("does not stamp on an unrelated field edit", () => {
    const out = stampGoLive(live(), { total_effort_hours: 12 }, "2026-09-08T10:00:00.000Z");
    expect(out.went_live_at).toBeUndefined();
  });

  // withDerivedFields runs first and can promote lifecycle to "live" from a
  // migration_stage change alone, so the derived value has to count.
  it("stamps a lifecycle that was derived rather than sent", () => {
    const derived = withDerivedFields(live(), { migration_stage: "migrated_pending_commercial" });
    expect(derived.lifecycle).toBe("live");
    const out = stampGoLive(live(), derived, "2026-09-08T10:00:00.000Z");
    expect(out.went_live_at).toBe("2026-09-08T10:00:00.000Z");
  });

  it("leaves the rest of the patch alone", () => {
    const out = stampGoLive(live(), { lifecycle: "live", health: "on_track" }, "2026-09-08T10:00:00.000Z");
    expect(out).toMatchObject({ lifecycle: "live", health: "on_track" });
  });
});
