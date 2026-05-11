// Regression tests for the ARR + category-derived field helpers.
// The ARR tests use real-world fixtures (JBI's opportunity history, as
// captured from Salesforce on 2026-05-11) — these guard against the
// "sum-all-opps" overcounting bug we hit during Phase 2 Pass H.

import { describe, it, expect } from "vitest";
import {
  deriveArr,
  deriveTier,
  deriveDeploymentStage,
  deriveHealthScore,
  deriveChurnRisk,
  type OppForArr,
} from "@/lib/profile/derive";

describe("deriveArr", () => {
  // Fixture: JBI's actual SF opportunity history. The correct ARR is the
  // most-recent late-stage open opp ($384,335 at 2026-06-22), NOT the sum
  // of every Won + Open contract over the years ($960,670+).
  const jbiOpps: OppForArr[] = [
    { amount: 384_335, close_date: "2026-06-22", is_closed: false, is_won: false, probability: 90 },
    { amount: 72_000, close_date: "2025-06-26", is_closed: true, is_won: false, probability: 0 },
    { amount: 384_335, close_date: "2024-09-30", is_closed: true, is_won: true, probability: 100 },
    { amount: 72_000, close_date: "2024-07-31", is_closed: true, is_won: true, probability: 100 },
    { amount: 24_000, close_date: "2024-06-25", is_closed: true, is_won: true, probability: 100 },
    { amount: 72_000, close_date: "2024-03-31", is_closed: true, is_won: true, probability: 100 },
    { amount: 24_000, close_date: "2023-05-26", is_closed: true, is_won: true, probability: 100 },
  ];

  it("returns the open late-stage renewal amount when present", () => {
    const { arr, source_close_date } = deriveArr(jbiOpps);
    expect(arr).toBe(384_335);
    expect(source_close_date).toBe("2026-06-22");
  });

  it("does not sum across years (regression for $960,670 overcount)", () => {
    const { arr } = deriveArr(jbiOpps);
    expect(arr).not.toBe(960_670);
    expect(arr).not.toBe(1_032_670);
    expect(arr).not.toBe(576_335);
  });

  it("falls back to most recent Closed Won when no qualifying open opp exists", () => {
    // Remove the open opp; latest Won = 2024-09-30 at $384,335.
    const onlyWon = jbiOpps.filter((o) => o.is_won);
    const { arr, source_close_date } = deriveArr(onlyWon);
    expect(arr).toBe(384_335);
    expect(source_close_date).toBe("2024-09-30");
  });

  it("returns null when no opportunities exist", () => {
    expect(deriveArr([]).arr).toBeNull();
  });

  it("returns null when all opps are Closed Lost", () => {
    const lostOnly: OppForArr[] = [
      { amount: 50_000, close_date: "2025-01-01", is_closed: true, is_won: false, probability: 0 },
      { amount: 30_000, close_date: "2024-06-01", is_closed: true, is_won: false, probability: 0 },
    ];
    expect(deriveArr(lostOnly).arr).toBeNull();
  });

  it("skips open opps below 50% probability", () => {
    const lowProb: OppForArr[] = [
      { amount: 100_000, close_date: "2026-12-31", is_closed: false, is_won: false, probability: 20 },
    ];
    expect(deriveArr(lowProb).arr).toBeNull();
  });

  it("includes open opps at exactly 50% probability", () => {
    const fifty: OppForArr[] = [
      { amount: 50_000, close_date: "2026-12-31", is_closed: false, is_won: false, probability: 50 },
    ];
    expect(deriveArr(fifty).arr).toBe(50_000);
  });

  it("picks open opp over older Won opp when both exist", () => {
    const mixed: OppForArr[] = [
      { amount: 75_000, close_date: "2026-09-01", is_closed: false, is_won: false, probability: 60 },
      { amount: 50_000, close_date: "2025-09-01", is_closed: true, is_won: true, probability: 100 },
    ];
    expect(deriveArr(mixed).arr).toBe(75_000);
  });

  it("does not return a future renewal_date when the only opp is historical", () => {
    const historical: OppForArr[] = [
      { amount: 50_000, close_date: "2024-01-01", is_closed: true, is_won: true, probability: 100 },
    ];
    const result = deriveArr(historical);
    expect(result.arr).toBe(50_000);
    expect(result.renewal_date).toBeNull();
  });
});

describe("deriveTier", () => {
  it("maps the seven canonical categories", () => {
    expect(deriveTier("Strategic Growth")).toBe("enterprise");
    expect(deriveTier("Upcoming Renewals")).toBe("enterprise");
    expect(deriveTier("At Risk")).toBe("enterprise");
    expect(deriveTier("Active")).toBe("growth");
    expect(deriveTier("Partner Managed")).toBe("growth");
    expect(deriveTier("POV")).toBe("starter");
    expect(deriveTier("Churned")).toBe("enterprise");
  });
  it("is case-insensitive", () => {
    expect(deriveTier("active")).toBe("growth");
    expect(deriveTier("ACTIVE")).toBe("growth");
  });
  it("returns null for unknown categories", () => {
    expect(deriveTier(null)).toBeNull();
    expect(deriveTier("")).toBeNull();
    expect(deriveTier("something-new")).toBeNull();
  });
});

describe("deriveDeploymentStage", () => {
  it("POV → pilot", () => {
    expect(deriveDeploymentStage("POV")).toBe("pilot");
  });
  it("Churned → mature", () => {
    expect(deriveDeploymentStage("Churned")).toBe("mature");
  });
  it("active categories → scaling", () => {
    for (const cat of ["Active", "Strategic Growth", "Upcoming Renewals", "At Risk", "Partner Managed"]) {
      expect(deriveDeploymentStage(cat)).toBe("scaling");
    }
  });
  it("unknown / null → onboarding", () => {
    expect(deriveDeploymentStage(null)).toBe("onboarding");
    expect(deriveDeploymentStage("")).toBe("onboarding");
    expect(deriveDeploymentStage("Whatever")).toBe("onboarding");
  });
});

describe("deriveHealthScore", () => {
  it("monotonically reflects category health intuition", () => {
    expect(deriveHealthScore("Churned")).toBe(0);
    expect(deriveHealthScore("At Risk")).toBeLessThan(deriveHealthScore("Upcoming Renewals"));
    expect(deriveHealthScore("Upcoming Renewals")).toBeLessThan(deriveHealthScore("Active"));
    expect(deriveHealthScore("Active")).toBeLessThan(deriveHealthScore("Strategic Growth"));
  });
  it("stays in the 0-100 range", () => {
    for (const cat of [null, "", "POV", "Churned", "Active", "At Risk", "Strategic Growth"]) {
      const s = deriveHealthScore(cat);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("deriveChurnRisk", () => {
  it("high for At Risk and Churned", () => {
    expect(deriveChurnRisk("At Risk")).toBe("high");
    expect(deriveChurnRisk("Churned")).toBe("high");
  });
  it("medium for Upcoming Renewals", () => {
    expect(deriveChurnRisk("Upcoming Renewals")).toBe("medium");
  });
  it("low for everything else", () => {
    for (const cat of ["Active", "Strategic Growth", "Partner Managed", "POV", null, ""]) {
      expect(deriveChurnRisk(cat)).toBe("low");
    }
  });
});
