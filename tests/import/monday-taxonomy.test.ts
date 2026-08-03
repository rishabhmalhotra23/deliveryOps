// Tests for the Monday -> native taxonomy derivation.
//
// Two halves. The first pins the individual mappings, including the two data
// defects and the lossy case. The second replays the ACTUAL 146 rows from
// monday-backup-2026-08-03 when that folder is present and asserts the resulting
// view split, which is the number that has to survive the cutover.
//
// The archive is gitignored (real customer data), so the second half skips
// cleanly in CI and on a fresh clone. It is the half that matters locally.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  derivePlatform,
  migrationStageFromPlatform,
  deriveHealth,
  deriveComplexity,
  deriveState,
  viewForLifecycle,
  laneFor,
} from "@/lib/import/monday-taxonomy";

describe("derivePlatform", () => {
  it("maps the three simple values", () => {
    expect(derivePlatform("V1")).toBe("v1");
    expect(derivePlatform("V2")).toBe("v2");
    expect(derivePlatform("Custom Solution")).toBe("custom");
  });

  it("records where a mid-migration process RUNS, not where it is being tested", () => {
    // "Currently in V1; Testing in V2" is one real row (Scan Health Enhancements
    // Phase 2). Calling it v2 would overstate the V2 estate in the all-hands
    // report by one row; the testing half belongs in migration_stage.
    expect(derivePlatform("Currently in V1; Testing in V2")).toBe("v1");
    expect(migrationStageFromPlatform("Currently in V1; Testing in V2")).toBe("parity_testing");
  });

  it("says nothing about migration stage for the simple values", () => {
    expect(migrationStageFromPlatform("V1")).toBeNull();
    expect(migrationStageFromPlatform("V2")).toBeNull();
  });

  it("returns null rather than guessing on an unknown value", () => {
    expect(derivePlatform("V3")).toBeNull();
    expect(derivePlatform(null)).toBeNull();
  });
});

describe("deriveHealth", () => {
  it("keeps only the values that carry health signal", () => {
    expect(deriveHealth("On Track")).toBe("on_track");
    expect(deriveHealth("Positive")).toBe("on_track");
    expect(deriveHealth("Off Track")).toBe("off_track");
  });

  it("drops lifecycle values masquerading as health", () => {
    // 91 of 146 archive rows said "Finished", which is why the old report's
    // health mix was meaningless.
    expect(deriveHealth("Finished")).toBeNull();
    expect(deriveHealth("Inactive")).toBeNull();
    expect(deriveHealth("On Hold")).toBeNull();
  });
});

describe("deriveComplexity", () => {
  it("normalises to Low / Medium / High", () => {
    expect(deriveComplexity("low")).toBe("Low");
    expect(deriveComplexity("Medium")).toBe("Medium");
    expect(deriveComplexity("HIGH")).toBe("High");
    expect(deriveComplexity(null)).toBeNull();
  });
});

describe("deriveState — lifecycle", () => {
  it("maps the six Project Status values", () => {
    const s = (project_status: string, current_phase: string | null = null) =>
      deriveState({ project_status, current_phase, health: null }).lifecycle;

    expect(s("Live", "M5 - Exception Handling")).toBe("live");
    expect(s("Backlog")).toBe("backlog");
    expect(s("Upcoming")).toBe("upcoming");
    expect(s("On Hold")).toBe("on_hold");
  });

  it("disambiguates Inactive by phase", () => {
    const s = (current_phase: string) =>
      deriveState({ project_status: "Inactive", current_phase, health: null }).lifecycle;

    expect(s("Cancelled")).toBe("cancelled");
    expect(s("Churned")).toBe("churned");
  });

  it("prefers the phase over In Progress when the phase is more specific", () => {
    // Without this the 10 rows sitting in M3 land in Building instead of
    // Validating and the board misrepresents where work actually is.
    const st = deriveState({
      project_status: "In Progress",
      current_phase: "M3 - Testing/UAT",
      health: "On Track",
    });
    expect(st.lifecycle).toBe("uat");
    expect(st.phase).toBe("m3_testing_uat");
    expect(st.needs_attention).toBe(false);
  });
});

describe("deriveState — the lossy case", () => {
  it("nulls the phase and flags it when Monday overwrote the milestone", () => {
    const st = deriveState({
      project_status: "In Progress",
      current_phase: "Waiting for Customer",
      health: "On Track",
    });
    expect(st.phase).toBeNull();
    expect(st.blocked_on).toBe("customer");
    expect(st.needs_attention).toBe(true);
    expect(st.needs_attention_reason).toMatch(/unrecoverable/);
  });
});

describe("deriveState — the two data defects", () => {
  it("flags rows marked Live whose phase contradicts it", () => {
    for (const phase of ["Pre-Kickoff", "POV complete", "Waiting for Customer"]) {
      const st = deriveState({ project_status: "Live", current_phase: phase, health: "Finished" });
      expect(st.needs_attention, phase).toBe(true);
    }
  });

  it("flags Inactive POVs awaiting a decision instead of reclassifying them", () => {
    const st = deriveState({
      project_status: "Inactive",
      current_phase: "POV complete, Waiting for next steps",
      health: "Inactive",
    });
    expect(st.needs_attention).toBe(true);
    expect(st.needs_attention_reason).toMatch(/POV awaiting a decision/);
    // Deliberately still archive — the importer flags, a human decides.
    expect(viewForLifecycle(st.lifecycle)).toBe("archive");
  });

  it("flags unrecognised values rather than guessing", () => {
    const st = deriveState({ project_status: "Nonsense", current_phase: "Also nonsense", health: null });
    expect(st.needs_attention).toBe(true);
    expect(st.needs_attention_reason).toMatch(/unrecognised Project Status/);
    expect(st.needs_attention_reason).toMatch(/unrecognised Current Phase/);
  });
});

describe("deriveState — health is only kept in flight", () => {
  it("drops health on live and archived rows", () => {
    expect(
      deriveState({ project_status: "Live", current_phase: "Support", health: "On Track" }).health
    ).toBeNull();
    expect(
      deriveState({ project_status: "Inactive", current_phase: "Cancelled", health: "On Track" }).health
    ).toBeNull();
  });

  it("keeps it on active rows", () => {
    expect(
      deriveState({ project_status: "In Progress", current_phase: "M2 - Development", health: "Off Track" })
        .health
    ).toBe("off_track");
  });
});

describe("laneFor — the four approved Active lanes", () => {
  it("routes blocked and on-hold work to Stuck regardless of stage", () => {
    expect(laneFor("uat", "customer")).toBe("stuck");
    expect(laneFor("on_hold", "none")).toBe("stuck");
  });

  it("routes the rest by stage", () => {
    expect(laneFor("backlog", "none")).toBe("pipeline");
    expect(laneFor("upcoming", "none")).toBe("pipeline");
    expect(laneFor("in_development", "none")).toBe("building");
    expect(laneFor("discovery", "none")).toBe("building");
    expect(laneFor("uat", "none")).toBe("validating");
  });

  it("has no lane for delivered or archived work", () => {
    expect(laneFor("live", "none")).toBeNull();
    expect(laneFor("cancelled", "none")).toBeNull();
  });
});

// ─── replay against the real archive ─────────────────────────────────────────

const BACKUP = path.resolve(process.cwd(), "monday-backup-2026-08-03", "boards");
const REPORT_BOARDS = [
  "18395281570", // Projects              30
  "18398797224", // FY-2025 Deliverables  47
  "18398797267", // FY-2026 Deliverables  19
  "18398797301", // Inactive / Cancelled  25
  "18398797248", // FY-2024 Deliverables  20
  "18398797257", // FY-2023 Deliverables   5
];

const archivePresent = fs.existsSync(BACKUP);

describe.skipIf(!archivePresent)("replay of the real 146 archive rows", () => {
  interface Row {
    project_status: string | null;
    current_phase: string | null;
    health: string | null;
    platform: string | null;
  }

  function loadRows(): Row[] {
    const rows: Row[] = [];
    for (const id of REPORT_BOARDS) {
      const raw = JSON.parse(fs.readFileSync(path.join(BACKUP, `board-${id}.json`), "utf8"));
      const titles = new Map<string, string>(
        (raw.board.columns as { id: string; title: string }[]).map((c) => [c.id, c.title])
      );
      for (const item of raw.items as { column_values: { id: string; text: string | null }[] }[]) {
        const by: Record<string, string | null> = {};
        for (const cv of item.column_values) by[titles.get(cv.id) ?? cv.id] = cv.text || null;
        rows.push({
          project_status: by["Project Status"] ?? null,
          current_phase: by["Current Phase"] ?? null,
          health: by["Health"] ?? null,
          platform: by["Development Platform"] ?? null,
        });
      }
    }
    return rows;
  }

  const rows = loadRows();

  it("reads all 146 rows", () => {
    expect(rows).toHaveLength(146);
  });

  it("recognises every Project Status and Current Phase value in the set", () => {
    // The point of this test: if Monday gains a new status label, this fails
    // loudly here instead of silently flagging rows at import time.
    const unrecognised = rows
      .map((r) => deriveState(r))
      .filter((s) => /unrecognised/.test(s.needs_attention_reason ?? ""));
    expect(unrecognised).toHaveLength(0);
  });

  it("maps every platform value, including the compound one", () => {
    const unmapped = rows.filter((r) => r.platform && derivePlatform(r.platform) === null);
    expect(unmapped.map((r) => r.platform)).toEqual([]);
  });

  it("finds exactly one mid-migration row", () => {
    // This test exists because 0021's SQL guard rejects unmapped platform values,
    // and the 0020 seed (75 rows, 3 values) did not exercise the fourth.
    const midMigration = rows.filter((r) => migrationStageFromPlatform(r.platform) !== null);
    expect(midMigration).toHaveLength(1);
  });

  it("records the platform distribution so a silent shift gets caught", () => {
    const dist: Record<string, number> = {};
    for (const r of rows) {
      const p = derivePlatform(r.platform);
      if (p) dist[p] = (dist[p] ?? 0) + 1;
    }
    // V1 103 + the 1 compound row that runs on V1 = 104.
    expect(dist).toEqual({ v1: 104, v2: 39, custom: 3 });
  });

  it("produces the approved three-view split", () => {
    const counts = { active: 0, delivered: 0, archive: 0 };
    for (const r of rows) counts[viewForLifecycle(deriveState(r).lifecycle)] += 1;

    // Matches the counts the IA was approved against, and sums to 146.
    expect(counts).toEqual({ active: 30, delivered: 71, archive: 45 });
  });

  it("flags exactly the 15 rows a human has to look at", () => {
    const flagged = rows.map((r) => deriveState(r)).filter((s) => s.needs_attention);

    // 7 milestone-unrecoverable + 4 marked-Live-but-not + 4 Inactive POVs.
    // Two of the 9 "Waiting for Customer" rows are also marked Live, so they
    // carry both reasons and are counted once.
    const unrecoverable = flagged.filter((s) => /unrecoverable/.test(s.needs_attention_reason!));
    const notLive = flagged.filter((s) => /would be overstated/.test(s.needs_attention_reason!));
    const povArchive = flagged.filter((s) => /POV awaiting a decision/.test(s.needs_attention_reason!));

    expect(unrecoverable).toHaveLength(9);
    expect(notLive).toHaveLength(4);
    expect(povArchive).toHaveLength(4);
    expect(flagged).toHaveLength(15);
  });

  it("puts every active row in exactly one of the four lanes", () => {
    const lanes: Record<string, number> = {};
    for (const r of rows) {
      const s = deriveState(r);
      const lane = laneFor(s.lifecycle, s.blocked_on);
      if (lane) lanes[lane] = (lanes[lane] ?? 0) + 1;
    }
    const total = Object.values(lanes).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
    // Discovery being empty is real, so Building is small. Recorded so a future
    // change that silently inflates it gets caught.
    expect(lanes.pipeline).toBeGreaterThan(0);
    expect(lanes.stuck).toBeGreaterThan(0);
  });

  it("keeps health null on everything that is not in flight", () => {
    const bad = rows
      .map((r) => deriveState(r))
      .filter((s) => s.health !== null && viewForLifecycle(s.lifecycle) !== "active");
    expect(bad).toHaveLength(0);
  });
});
