// Which Delivery section a process belongs to.
//
// The whole point is that this is a PURE FUNCTION of the row's own fields.
// There is no stored section column, no per-project override and no hardcoded
// list of exceptions anywhere: change a process's lifecycle or migration_stage
// and it is in a different section on the next render. That was the explicit
// requirement (2026-09-04) — "there should not be any static or hardcoded
// values for any projects, if we change a value then it moves to correct
// place".
//
// Before this, the two tabs used two unrelated definitions — Active work was
// keyed on lifecycle, V2 migration on a separate evidence test
// (isV2Relevant) — so 36 processes appeared in BOTH and editing a stage moved
// nothing anywhere.
//
// Deliberately NOT reusing isV2Relevant(): that function answers a different
// question ("is there real evidence this process went through migration
// work?") for lib/reports/allhands-loader.ts, the All-Hands report. Widening
// it to serve section routing would pull 28 live V1 processes into the
// migration funnel and overstate the migration programme in a deck the team
// presents. Two consumers, two questions, two functions.

import type { MigrationStage, ProcessLifecycle } from "@/lib/supabase/types";

export type DeliverySection = "active" | "v2" | "historical";

export const DELIVERY_SECTIONS: DeliverySection[] = ["active", "v2", "historical"];

export const SECTION_LABELS: Record<DeliverySection, string> = {
  active: "Active work",
  v2: "V2 migration",
  historical: "Historical",
};

export const SECTION_HINTS: Record<DeliverySection, string> = {
  active: "New V2 development",
  v2: "Not yet V2-native — migrate or retire",
  historical: "Shipped and ended work, by quarter",
};

/** Lifecycles that mean the work is no longer in flight. `needs_triage` is
 *  here because it is unreviewed rather than active — the same call
 *  ARCHIVE_LIFECYCLES already makes — and per the 2026-09-04 decision it
 *  lands in Historical until somebody changes its lifecycle, at which point
 *  this function routes it out again with no further input. */
const ENDED_LIFECYCLES = new Set<ProcessLifecycle>([
  "cancelled",
  "churned",
  "retired",
  "needs_triage",
]);

/** The one routing rule. Order matters: an ended process is Historical
 *  whatever its migration stage says. */
export function sectionFor(row: {
  lifecycle: ProcessLifecycle;
  migration_stage: MigrationStage;
}): DeliverySection {
  if (ENDED_LIFECYCLES.has(row.lifecycle)) return "historical";
  if (row.migration_stage === "v2_native") return "active";
  return "v2";
}

/** Historical is a LENS, not a partition — it answers "what have we shipped"
 *  while the other two answer "what are we doing now". A live process
 *  legitimately appears in its operational section *and* here, under the
 *  quarter it went live, which is what makes the section a record of the
 *  team's output rather than a graveyard. Section counts therefore do not sum
 *  to the total, on purpose.
 *
 *  A row qualifies if it shipped (has a go-live date) or if it ended. */
export function inHistoricalLens(row: {
  lifecycle: ProcessLifecycle;
  go_live_date: string | null;
}): boolean {
  return row.go_live_date != null || ENDED_LIFECYCLES.has(row.lifecycle);
}
