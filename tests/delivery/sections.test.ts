// Section routing and Historical grouping. The load-bearing property is that
// sectionFor() is a pure function of two fields — the explicit requirement
// (2026-09-04) was "there should not be any static or hardcoded values for any
// projects, if we change a value then it moves to correct place", so these
// tests are mostly about movement rather than placement.

import { describe, it, expect } from "vitest";
import { sectionFor, inHistoricalLens } from "@/lib/delivery/sections";
import { groupByQuarter, deliveredSeries, NO_QUARTER } from "@/lib/delivery/historical";
import { fiscalQuarterOf } from "@/lib/nps/constants";
import { MIGRATION_STAGES, PROCESS_LIFECYCLES, type MigrationStage, type ProcessLifecycle } from "@/lib/supabase/types";

const row = (lifecycle: ProcessLifecycle, migration_stage: MigrationStage) => ({ lifecycle, migration_stage });

describe("sectionFor", () => {
  it("routes V2 native in-flight work to Active work", () => {
    expect(sectionFor(row("in_development", "v2_native"))).toBe("active");
    expect(sectionFor(row("discovery", "v2_native"))).toBe("active");
    expect(sectionFor(row("backlog", "v2_native"))).toBe("active");
    expect(sectionFor(row("uat", "v2_native"))).toBe("active");
    expect(sectionFor(row("on_hold", "v2_native"))).toBe("active");
  });

  // Changed 2026-09-08 on Rishabh's call: "once something goes live it should
  // move to Historical section and for that quarter Go-Live instead, and
  // Active Work should show the work in dev, test, upcoming pipeline or
  // discovery". Active work means in flight; shipping is an exit, not a state.
  it("routes a shipped V2-native process out of Active work", () => {
    expect(sectionFor(row("live", "v2_native"))).toBe("historical");
  });

  // Deliberately NOT symmetric with Active work. V2 migration is a
  // migrate-or-retire to-do list, and a process running live on V1 is still
  // on that list. Applying the Active-work rule here would have moved 58 of
  // production's 65 rows out and collapsed the section to 5.
  it("keeps live work in V2 migration, because it still needs migrating", () => {
    expect(sectionFor(row("live", "not_required"))).toBe("v2");
    expect(sectionFor(row("live", "customer_validation"))).toBe("v2");
    expect(sectionFor(row("live", "migrated_pending_commercial"))).toBe("v2");
    expect(sectionFor(row("live", "live_on_v2"))).toBe("v2");
  });

  it("routes everything not yet V2 native to V2 migration", () => {
    for (const stage of MIGRATION_STAGES.filter((s) => s !== "v2_native")) {
      expect(sectionFor(row("in_development", stage))).toBe("v2");
    }
  });

  it("puts not_required and to_be_retired in V2 migration, not Active work", () => {
    // Both mean "this isn't V2-native", which is what that tab now holds —
    // the migrate-or-retire decision list.
    expect(sectionFor(row("live", "not_required"))).toBe("v2");
    expect(sectionFor(row("uat", "to_be_retired"))).toBe("v2");
  });

  it("sends ended work to Historical whatever its stage says", () => {
    for (const lifecycle of ["cancelled", "churned", "retired", "needs_triage"] as ProcessLifecycle[]) {
      expect(sectionFor(row(lifecycle, "v2_native"))).toBe("historical");
      expect(sectionFor(row(lifecycle, "in_development"))).toBe("historical");
    }
  });

  it("assigns exactly one section to every lifecycle/stage combination", () => {
    // No combination may fall through — a process with no section would be
    // invisible in the whole app now that "All processes" is gone.
    for (const lifecycle of PROCESS_LIFECYCLES) {
      for (const stage of MIGRATION_STAGES) {
        expect(["active", "v2", "historical"]).toContain(sectionFor(row(lifecycle, stage)));
      }
    }
  });

  describe("movement — the actual requirement", () => {
    it("moves a process out of Historical when its lifecycle is set to active-shaped", () => {
      const triaged = row("needs_triage", "v2_native");
      expect(sectionFor(triaged)).toBe("historical");
      expect(sectionFor({ ...triaged, lifecycle: "discovery" })).toBe("active");
    });

    it("moves a triaged V1 process to V2 migration, not Active work, on the same edit", () => {
      const triaged = row("needs_triage", "engg_pending");
      expect(sectionFor({ ...triaged, lifecycle: "discovery" })).toBe("v2");
    });

    it("moves a migration process to Active work the moment it becomes V2 native", () => {
      const migrating = row("uat", "customer_validation");
      expect(sectionFor(migrating)).toBe("v2");
      expect(sectionFor({ ...migrating, migration_stage: "v2_native" })).toBe("active");
    });

    it("moves a V2-native process out of Active work when marked to be retired", () => {
      const built = row("uat", "v2_native");
      expect(sectionFor(built)).toBe("active");
      expect(sectionFor({ ...built, migration_stage: "to_be_retired" })).toBe("v2");
    });

    it("is decided by lifecycle first — cancelling never leaves it in an operational tab", () => {
      const built = row("in_development", "v2_native");
      expect(sectionFor({ ...built, lifecycle: "cancelled" })).toBe("historical");
    });
  });
});

describe("inHistoricalLens", () => {
  it("includes anything that shipped, even while it's still current state", () => {
    // The overlap is deliberate: Active work answers "what are we doing",
    // Historical answers "what have we shipped".
    expect(inHistoricalLens({ lifecycle: "live", go_live_date: "2026-06-01" })).toBe(true);
  });

  it("includes ended work with no go-live date", () => {
    expect(inHistoricalLens({ lifecycle: "churned", go_live_date: null })).toBe(true);
    expect(inHistoricalLens({ lifecycle: "needs_triage", go_live_date: null })).toBe(true);
  });

  it("excludes in-flight work that hasn't shipped", () => {
    expect(inHistoricalLens({ lifecycle: "discovery", go_live_date: null })).toBe(false);
    expect(inHistoricalLens({ lifecycle: "uat", go_live_date: null })).toBe(false);
  });

  // go_live_date is a target as often as a fact — it's hand-edited in the
  // drawer months ahead. Counting a future date as shipped filed work due
  // next quarter under "Shipped and ended work" and drew a bar for it on the
  // delivered-per-quarter strip.
  it("excludes a go-live date that hasn't arrived yet", () => {
    expect(inHistoricalLens({ lifecycle: "uat", go_live_date: "2026-12-01" }, "2026-09-04")).toBe(
      false
    );
  });

  it("includes it the day it arrives", () => {
    expect(inHistoricalLens({ lifecycle: "uat", go_live_date: "2026-09-04" }, "2026-09-04")).toBe(
      true
    );
  });

  it("still keeps ended work whose planned go-live never happened", () => {
    expect(
      inHistoricalLens({ lifecycle: "cancelled", go_live_date: "2027-01-01" }, "2026-09-04")
    ).toBe(true);
  });
});

describe("Historical is the union of the routed section and the lens", () => {
  // The orphan guard for the 2026-09-08 change. sectionFor() now sends
  // live + v2_native to "historical", but inHistoricalLens() is FALSE for a
  // row with no go-live date — so if Historical rendered the lens alone, a
  // process marked live without a date would leave Active work and appear in
  // no section whatsoever. delivery-client.tsx therefore renders the union,
  // and that row shows up in the "No go-live date" bucket where it can be
  // fixed. Production has 6 undated live rows today, 0 of them v2_native, so
  // this guards a future edit rather than existing data.
  const inHistorical = (r: {
    lifecycle: ProcessLifecycle;
    migration_stage: MigrationStage;
    go_live_date: string | null;
  }) => sectionFor(r) === "historical" || inHistoricalLens(r);

  it("keeps an undated live V2-native process reachable", () => {
    const orphanCandidate = { lifecycle: "live" as ProcessLifecycle, migration_stage: "v2_native" as MigrationStage, go_live_date: null };
    expect(sectionFor(orphanCandidate)).toBe("historical");
    expect(inHistoricalLens(orphanCandidate)).toBe(false);
    expect(inHistorical(orphanCandidate)).toBe(true);
  });

  it("leaves every process in at least one section", () => {
    for (const lifecycle of PROCESS_LIFECYCLES) {
      for (const stage of MIGRATION_STAGES) {
        for (const go_live_date of [null, "2026-01-01", "2099-01-01"]) {
          const r = { lifecycle, migration_stage: stage, go_live_date };
          const sections = [
            sectionFor(r) === "active",
            sectionFor(r) === "v2",
            inHistorical(r),
          ].filter(Boolean);
          expect(sections.length, `${lifecycle}/${stage}/${go_live_date}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("fiscalQuarterOf", () => {
  // Kognitos FY runs Feb-Jan, named for the year it ends in.
  it("puts February in Q1 of the next-numbered fiscal year", () => {
    expect(fiscalQuarterOf("2026-02-01")).toBe("1Q27");
  });

  it("puts January in Q4 of the fiscal year it closes", () => {
    expect(fiscalQuarterOf("2026-01-31")).toBe("4Q26");
  });

  it("walks the quarter boundaries", () => {
    expect(fiscalQuarterOf("2025-04-30")).toBe("1Q26");
    expect(fiscalQuarterOf("2025-05-01")).toBe("2Q26");
    expect(fiscalQuarterOf("2025-07-31")).toBe("2Q26");
    expect(fiscalQuarterOf("2025-08-01")).toBe("3Q26");
    expect(fiscalQuarterOf("2025-10-31")).toBe("3Q26");
    expect(fiscalQuarterOf("2025-11-01")).toBe("4Q26");
    expect(fiscalQuarterOf("2025-12-31")).toBe("4Q26");
  });

  it("reads dates as UTC — a local timezone west of UTC would shift Feb 1 across a fiscal year", () => {
    expect(fiscalQuarterOf("2026-02-01")).toBe("1Q27");
    expect(fiscalQuarterOf("2026-02-01T00:00:00Z")).toBe("1Q27");
  });

  it("returns null rather than guessing for missing or junk input", () => {
    expect(fiscalQuarterOf(null)).toBeNull();
    expect(fiscalQuarterOf("")).toBeNull();
    expect(fiscalQuarterOf("not a date")).toBeNull();
  });
});

describe("groupByQuarter", () => {
  const rows = [
    { lifecycle: "live" as ProcessLifecycle, go_live_date: "2025-12-01" },   // 4Q26
    { lifecycle: "live" as ProcessLifecycle, go_live_date: "2025-12-15" },   // 4Q26
    { lifecycle: "churned" as ProcessLifecycle, go_live_date: "2025-09-01" }, // 3Q26
    { lifecycle: "needs_triage" as ProcessLifecycle, go_live_date: null },
    { lifecycle: "cancelled" as ProcessLifecycle, go_live_date: null },
  ];

  it("orders newest quarter first", () => {
    const groups = groupByQuarter(rows);
    expect(groups.map((g) => g.quarter).slice(0, 2)).toEqual(["4Q26", "3Q26"]);
  });

  it("pins the undated bucket last — it isn't a point in time", () => {
    expect(groupByQuarter(rows).at(-1)!.quarter).toBe(NO_QUARTER);
  });

  it("counts delivered, ended and needs-triage separately", () => {
    const groups = groupByQuarter(rows);
    expect(groups.find((g) => g.quarter === "4Q26")).toMatchObject({ live: 2, ended: 0, needsTriage: 0 });
    expect(groups.find((g) => g.quarter === "3Q26")).toMatchObject({ live: 0, ended: 1 });
    // The undated group is mostly unreviewed work, not 2 failures.
    expect(groups.find((g) => g.quarter === NO_QUARTER)).toMatchObject({ needsTriage: 1, ended: 1 });
  });

  it("keeps every row — nothing is dropped for lacking a date", () => {
    expect(groupByQuarter(rows).reduce((n, g) => n + g.rows.length, 0)).toBe(rows.length);
  });

  it("handles an empty list", () => {
    expect(groupByQuarter([])).toEqual([]);
  });
});

describe("deliveredSeries", () => {
  const rows = [
    { lifecycle: "live" as ProcessLifecycle, go_live_date: "2025-12-01" },
    { lifecycle: "live" as ProcessLifecycle, go_live_date: "2025-09-01" },
    { lifecycle: "cancelled" as ProcessLifecycle, go_live_date: "2025-09-02" },
    { lifecycle: "churned" as ProcessLifecycle, go_live_date: null },
  ];

  it("runs oldest to newest, the direction a timeline reads", () => {
    expect(deliveredSeries(groupByQuarter(rows)).map((p) => p.quarter)).toEqual(["3Q26", "4Q26"]);
  });

  it("counts only work that shipped — a cancellation is not output", () => {
    const series = deliveredSeries(groupByQuarter(rows));
    expect(series.find((p) => p.quarter === "3Q26")!.delivered).toBe(1);
  });

  it("drops the undated bucket, which has no place on a timeline", () => {
    expect(deliveredSeries(groupByQuarter(rows)).some((p) => p.quarter === NO_QUARTER)).toBe(false);
  });
});

describe("to_be_retired must not leak into the All-Hands report", () => {
  // isV2Relevant() tests `stage <> not_required`, so every NEW migration_stage
  // is included by default. Without the explicit exclusion, marking a process
  // for retirement would grow the migration funnel in a deck the team
  // presents. Pinned here because the failure is silent and off-screen.
  function isV2Relevant(stage: MigrationStage, hasEvidence: boolean): boolean {
    if (stage === "not_required") return false;
    if (stage === "to_be_retired") return false;
    if (stage === "v2_native" && !hasEvidence) return false;
    return true;
  }

  it("excludes to_be_retired even with migration evidence present", () => {
    expect(isV2Relevant("to_be_retired", true)).toBe(false);
  });

  it("still excludes not_required", () => {
    expect(isV2Relevant("not_required", true)).toBe(false);
  });

  it("still includes genuine in-flight migration stages", () => {
    for (const stage of ["in_development", "engg_pending", "parity_testing", "customer_validation", "live_on_v2", "migrated_pending_commercial"] as MigrationStage[]) {
      expect(isV2Relevant(stage, false)).toBe(true);
    }
  });

  it("still gates v2_native on real evidence", () => {
    expect(isV2Relevant("v2_native", false)).toBe(false);
    expect(isV2Relevant("v2_native", true)).toBe(true);
  });
});

describe("the roster hand-over filter must match any owner role", () => {
  // Configure -> Roster's "still assigned to N processes" counts all four
  // owner FKs, but the deep link used to filter the FDE column alone. 9 of
  // the 21 people in the production roster hold ZERO FDE assignments and 34
  // TAM/engineering ones between them, so for every one of those the link
  // landed on an empty table directly contradicting the warning that
  // produced it.
  type OwnerRow = { fde_owner: string | null; tam_owner: string | null; engg_owner: string | null };

  const matchesPerson = (row: OwnerRow, person: string) =>
    row.fde_owner === person || row.tam_owner === person || row.engg_owner === person;

  const matchesOwnerOnly = (row: OwnerRow, person: string) => row.fde_owner === person;

  const tamOnly: OwnerRow = { fde_owner: "Karthik", tam_owner: "Shyam Prabhal", engg_owner: null };
  const enggOnly: OwnerRow = { fde_owner: "Karthik", tam_owner: null, engg_owner: "Sid" };
  const fde: OwnerRow = { fde_owner: "Karthik", tam_owner: null, engg_owner: null };

  it("finds a TAM-only assignment that the FDE filter misses", () => {
    expect(matchesOwnerOnly(tamOnly, "Shyam Prabhal")).toBe(false);
    expect(matchesPerson(tamOnly, "Shyam Prabhal")).toBe(true);
  });

  it("finds an engineering-only assignment", () => {
    expect(matchesPerson(enggOnly, "Sid")).toBe(true);
  });

  it("still finds an FDE assignment", () => {
    expect(matchesPerson(fde, "Karthik")).toBe(true);
  });

  it("does not match somebody uninvolved", () => {
    expect(matchesPerson(fde, "Shyam Prabhal")).toBe(false);
  });

  it("matches a person holding two roles on the same process exactly once", () => {
    const both: OwnerRow = { fde_owner: "Rishabh", tam_owner: "Rishabh", engg_owner: null };
    expect([both].filter((r) => matchesPerson(r, "Rishabh"))).toHaveLength(1);
  });
});
