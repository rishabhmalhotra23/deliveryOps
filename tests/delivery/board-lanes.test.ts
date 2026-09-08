// The board must never silently lose a row.
//
// This is the guardrail for the 2026-09-08 feedback "Total number of projects
// shown in Table view, or board view is different, why?". Both loops in
// bucketRows() pushed only when they found a lane and dropped the row
// otherwise, with no overflow lane and no warning:
//
//   1. Active work: laneFor() returns null for `lifecycle = live`, because
//      viewForLifecycle("live") is "delivered". sectionFor() put live +
//      v2_native rows IN Active work, so the tab counted them, the table
//      rendered them, and the board — which Active work DEFAULTS to — showed
//      nothing. In production that was 2 of 9 rows invisible.
//   2. V2 migration: `not_required` is filtered out of the lane list
//      entirely, yet sectionFor() puts all of those rows inside the section.
//      In production that is 29 of 65 rows counted but uncardable.
//
// The invariant is deliberately stated as a total rather than per-value, so a
// new lifecycle or migration_stage can't reintroduce the bug: anything the
// board can't place has to end up somewhere visible.

import { describe, it, expect } from "vitest";
import { bucketRows } from "@/app/_components/process-board";
import type { DetailProcess } from "@/app/_components/process-detail";
import {
  MIGRATION_STAGES,
  PROCESS_LIFECYCLES,
  type MigrationStage,
  type ProcessBlockedOn,
  type ProcessLifecycle,
} from "@/lib/supabase/types";

let seq = 0;
function row(
  lifecycle: ProcessLifecycle,
  migration_stage: MigrationStage,
  blocked_on: ProcessBlockedOn = "none"
): DetailProcess {
  seq += 1;
  return {
    id: `r${seq}`,
    process_name: `Process ${seq}`,
    lifecycle,
    migration_stage,
    blocked_on,
    board_position: null,
    updated_at: "2026-01-01",
  } as unknown as DetailProcess;
}

/** Total rows the board actually placed into a lane. */
function placed(rows: DetailProcess[], mode: "active" | "v2"): number {
  const { byLane } = bucketRows(mode, rows, "manual", {});
  let n = 0;
  byLane.forEach((laneRows) => {
    n += laneRows.length;
  });
  return n;
}

/** Ids the board placed, so we can name what went missing. */
function placedIds(rows: DetailProcess[], mode: "active" | "v2"): Set<string> {
  const { byLane } = bucketRows(mode, rows, "manual", {});
  const ids = new Set<string>();
  byLane.forEach((laneRows) => laneRows.forEach((r) => ids.add(r.id)));
  return ids;
}

describe("bucketRows places every row it is given", () => {
  it("active mode: a live V2-native process is not dropped", () => {
    // sectionFor(live, v2_native) routes to Historical after the 2026-09-08
    // change, but the board must still not lose one if it ever sees it.
    const rows = [row("live", "v2_native")];
    expect(placed(rows, "active")).toBe(rows.length);
  });

  it("v2 mode: not_required rows get a lane", () => {
    const rows = [row("live", "not_required"), row("uat", "not_required")];
    expect(placed(rows, "v2")).toBe(rows.length);
  });

  it("active mode: every lifecycle lands somewhere", () => {
    const rows = PROCESS_LIFECYCLES.map((l) => row(l, "v2_native"));
    const missing = rows.filter((r) => !placedIds(rows, "active").has(r.id));
    expect(missing.map((r) => r.lifecycle)).toEqual([]);
  });

  it("v2 mode: every migration stage lands somewhere", () => {
    const rows = MIGRATION_STAGES.map((s) => row("uat", s));
    const missing = rows.filter((r) => !placedIds(rows, "v2").has(r.id));
    expect(missing.map((r) => r.migration_stage)).toEqual([]);
  });

  it("v2 mode: a row whose stage was retired in Configure keeps a lane", () => {
    // A retired stage gets no lane so nobody can pick it any more, but rows
    // still carrying it must not vanish — that's the whole reason retiring is
    // `active = false` rather than a delete.
    const rows = [row("uat", "parity_testing")];
    const vocab = { stage: { parity_testing: { label: "Parity testing", active: false } } };
    const { byLane } = bucketRows("v2", rows, "manual", vocab as never);
    let n = 0;
    byLane.forEach((laneRows) => {
      n += laneRows.length;
    });
    expect(n).toBe(1);
  });

  it("does not invent rows either — the total is exact", () => {
    const rows = [
      row("backlog", "v2_native"),
      row("uat", "v2_native"),
      row("on_hold", "v2_native"),
      row("in_development", "v2_native", "customer"),
    ];
    expect(placed(rows, "active")).toBe(4);
  });

  it("handles an empty list", () => {
    expect(placed([], "active")).toBe(0);
    expect(placed([], "v2")).toBe(0);
  });
});
