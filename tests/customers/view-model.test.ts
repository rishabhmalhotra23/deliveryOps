// Tests for the customer page view-model builders. All pure functions —
// no network calls, no Supabase, no React. Complement the derive.test.ts
// coverage with the integration-level shape tests.

import { describe, it, expect } from "vitest";
import {
  buildArrStatProps,
  buildNpsStatProps,
  buildProjectsStatProps,
  buildArrPoints,
  buildNpsTrendPoints,
  fmtMoney,
} from "@/lib/customers/view-model";

// ─── fmtMoney ──────────────────────────────────────────────────────────

describe("fmtMoney", () => {
  it("returns em-dash for null / undefined", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(undefined)).toBe("—");
  });
  it("formats billions with 2dp", () => {
    expect(fmtMoney(1_500_000_000)).toBe("$1.50B");
  });
  it("formats thousands as K with no decimal", () => {
    expect(fmtMoney(384_335)).toBe("$384K");
    expect(fmtMoney(50_000)).toBe("$50K");
  });
  it("formats sub-thousand amounts as whole dollars", () => {
    expect(fmtMoney(500)).toBe("$500");
  });
});

// ─── buildArrStatProps ─────────────────────────────────────────────────

describe("buildArrStatProps", () => {
  const wonOpp = {
    amount: 384_335, close_date: "2024-09-30",
    is_closed: true, is_won: true, probability: 100,
    name: "JBI 2024 renewal",
  };
  const openOpp = {
    amount: 384_335, close_date: "2026-06-22",
    is_closed: false, is_won: false, probability: 90,
    name: "JBI 2026 renewal",
  };
  const lostOpp = {
    amount: 72_000, close_date: "2025-06-26",
    is_closed: true, is_won: false, probability: 0,
    name: "JBI 2025 lost",
  };

  it("uses latest Closed Won (not open pipeline) for currentArr", () => {
    const props = buildArrStatProps([openOpp, wonOpp, lostOpp], null);
    expect(props.currentArr).toBe(384_335);
  });

  it("reports first-contract when only one Closed Won exists", () => {
    const props = buildArrStatProps([openOpp, wonOpp], null);
    expect(props.direction).toBe("first-contract");
    expect(props.previousArr).toBeNull();
  });

  it("reports no-data when only open pipeline opps exist", () => {
    const props = buildArrStatProps([openOpp], null);
    expect(props.direction).toBe("no-data");
    expect(props.currentArr).toBeNull();
  });

  it("reports growth when current Closed Won > prior Closed Won", () => {
    const priorWon = {
      amount: 200_000,
      close_date: "2023-06-01",
      is_closed: true,
      is_won: true,
      probability: 100,
    };
    const props = buildArrStatProps([wonOpp, priorWon], null);
    expect(props.direction).toBe("growth");
    expect(props.deltaPct).toBeGreaterThan(0);
  });

  it("reports no-data for empty opp list with no profile", () => {
    const props = buildArrStatProps([], null);
    expect(props.direction).toBe("no-data");
    expect(props.currentArr).toBeNull();
  });
});

// ─── buildNpsStatProps ─────────────────────────────────────────────────

describe("buildNpsStatProps", () => {
  const responses = [
    { score: 10, category: "Promoter", quarter: "4Q25" },
    { score: 10, category: "Promoter", quarter: "4Q25" },
    { score: 8, category: "Passive", quarter: "4Q25" },
    { score: 6, category: "Detractor", quarter: "4Q25" },
    { score: 10, category: "Promoter", quarter: "1Q26" },
  ];

  it("computes the correct average", () => {
    const { average } = buildNpsStatProps(responses);
    // (10+10+8+6+10)/5 = 44/5 = 8.8
    expect(average).toBe(8.8);
  });

  it("counts categories correctly", () => {
    const { promoters, passives, detractors } = buildNpsStatProps(responses);
    expect(promoters).toBe(3);
    expect(passives).toBe(1);
    expect(detractors).toBe(1);
  });

  it("returns the latest quarter", () => {
    // "1Q26" should sort after "4Q25"
    expect(buildNpsStatProps(responses).latestQuarter).toBe("1Q26");
  });

  it("handles empty array gracefully", () => {
    const props = buildNpsStatProps([]);
    expect(props.average).toBeNull();
    expect(props.count).toBe(0);
  });
});

// ─── buildProjectsStatProps ────────────────────────────────────────────

describe("buildProjectsStatProps", () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  const pastDate = "2024-01-01";
  const futureDate = "2099-12-31";

  it("counts in-progress by project_status", () => {
    const { inProgress } = buildProjectsStatProps([
      { group_title: "Active", project_status: "In Progress", go_live_date: null },
      { group_title: "Active", project_status: "Backlog", go_live_date: null },
    ]);
    expect(inProgress).toBe(1);
  });

  it("counts delivered by past go_live_date", () => {
    const { delivered } = buildProjectsStatProps([
      { group_title: "Active", project_status: "In Progress", go_live_date: pastDate },
    ]);
    expect(delivered).toBe(1);
  });

  it("does not count future go_live_date as delivered", () => {
    const { delivered } = buildProjectsStatProps([
      { group_title: "Active", project_status: "In Progress", go_live_date: futureDate },
    ]);
    expect(delivered).toBe(0);
  });

  it("counts pipeline group correctly", () => {
    const { pipeline } = buildProjectsStatProps([
      { group_title: "Pipeline", project_status: "Upcoming", go_live_date: null },
      { group_title: "Active", project_status: "In Progress", go_live_date: null },
    ]);
    expect(pipeline).toBe(1);
  });
});

// ─── buildArrPoints ────────────────────────────────────────────────────

describe("buildArrPoints", () => {
  const opps = [
    { name: "New 2023", amount: 24_000, close_date: "2023-05-26", is_closed: true, is_won: true, probability: 100 },
    { name: "Renewal 2024", amount: 384_335, close_date: "2024-09-30", is_closed: true, is_won: true, probability: 100 },
    { name: "Renewal 2026 open", amount: 384_335, close_date: "2026-06-22", is_closed: false, is_won: false, probability: 90 },
    { name: "Lost 2025", amount: 72_000, close_date: "2025-06-26", is_closed: true, is_won: false, probability: 0 },
    { name: "Low prob 2026", amount: 50_000, close_date: "2026-12-31", is_closed: false, is_won: false, probability: 20 },
  ];

  it("excludes lost and low-probability opps", () => {
    const points = buildArrPoints(opps);
    expect(points.find((p) => p.name === "Lost 2025")).toBeUndefined();
    expect(points.find((p) => p.name === "Low prob 2026")).toBeUndefined();
  });

  it("tags won as Won and qualifying open as Open", () => {
    const points = buildArrPoints(opps);
    const won = points.find((p) => p.name === "Renewal 2024");
    const open = points.find((p) => p.name === "Renewal 2026 open");
    expect(won?.type).toBe("Won");
    expect(open?.type).toBe("Open");
  });

  it("sorts ascending by date", () => {
    const points = buildArrPoints(opps);
    const dates = points.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("returns empty for no qualifying opps", () => {
    expect(buildArrPoints([])).toHaveLength(0);
  });
});

// ─── buildNpsTrendPoints ───────────────────────────────────────────────

describe("buildNpsTrendPoints", () => {
  const responses = [
    { score: 10, category: "Promoter", quarter: "4Q25" },
    { score: 8, category: "Passive", quarter: "4Q25" },
    { score: 9, category: "Promoter", quarter: "1Q26" },
  ];

  it("groups by quarter", () => {
    const points = buildNpsTrendPoints(responses);
    expect(points).toHaveLength(2);
  });

  it("sorts chronologically ascending", () => {
    const points = buildNpsTrendPoints(responses);
    expect(points[0].quarter).toBe("4Q25");
    expect(points[1].quarter).toBe("1Q26");
  });

  it("computes correct average per quarter", () => {
    const points = buildNpsTrendPoints(responses);
    const q4 = points.find((p) => p.quarter === "4Q25");
    expect(q4?.average).toBe(9); // (10+8)/2
    expect(q4?.promoter).toBe(1);
    expect(q4?.passive).toBe(1);
  });

  it("returns empty array for no NPS data", () => {
    expect(buildNpsTrendPoints([])).toHaveLength(0);
  });
});
