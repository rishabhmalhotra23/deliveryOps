// buildCreateProcessRow is the pure validation/defaulting core of
// createProcess (lib/processes/store.ts) — split out so the "New Process"
// flow's rules (required fields, migration_stage always not_required,
// lifecycle/platform defaults) are testable without a live Supabase client.

import { describe, it, expect } from "vitest";
import {
  buildCreateProcessRow,
  withDerivedFields,
  InvalidProcessInputError,
  bulkApply,
  bulkUpdateProcesses,
  bulkDeleteProcesses,
  TooManyIdsError,
  MAX_BULK_IDS,
} from "@/lib/processes/store";
import type { Process, ProcessLifecycle, ProcessPhase } from "@/lib/supabase/types";

function fakeProcess(overrides: Partial<Process> = {}): Process {
  return {
    lifecycle: "discovery",
    phase: "m1_discovery",
    ...overrides,
  } as Process;
}

describe("buildCreateProcessRow", () => {
  it("applies delivery defaults and forces migration_stage to not_required", () => {
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
      migration_stage: "not_required",
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

  it("derives phase from the resulting lifecycle in the same write", () => {
    const existing = fakeProcess({ lifecycle: "discovery", phase: "m1_discovery" });
    const next = withDerivedFields(existing, { migration_stage: "parity_testing" });
    expect(next.lifecycle).toBe("uat");
    expect(next.phase).toBe("m3_testing_uat");
  });

  it("derives phase from an explicit lifecycle edit with no migration_stage involved", () => {
    const existing = fakeProcess({ lifecycle: "discovery", phase: "m1_discovery" });
    const next = withDerivedFields(existing, { lifecycle: "live" });
    expect(next.phase).toBe("m4_deployment");
  });

  it("never overrides an explicit lifecycle or phase in the same patch", () => {
    const existing = fakeProcess({ lifecycle: "discovery" });
    const next = withDerivedFields(existing, {
      migration_stage: "in_development",
      lifecycle: "on_hold",
      phase: "m1_discovery",
    });
    expect(next.lifecycle).toBe("on_hold");
    expect(next.phase).toBe("m1_discovery");
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
    const existing = fakeProcess({ lifecycle: "in_development", phase: "m2_development" });
    const next = withDerivedFields(existing, { migration_stage: "engg_pending" });
    expect(next.lifecycle).toBeUndefined();
    expect(next.phase).toBeUndefined();
  });

  it("leaves phase alone for lifecycles with no clean single-phase mapping", () => {
    const existing = fakeProcess({ lifecycle: "discovery", phase: "m1_discovery" as ProcessPhase });
    const next = withDerivedFields(existing, { lifecycle: "on_hold" });
    expect(next.phase).toBeUndefined();
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
