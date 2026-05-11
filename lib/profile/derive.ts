// Pure derivation helpers for profile + internal_profile fields.
// Extracted so backfill scripts, future sync code, and the test suite share
// one implementation. NO Supabase / network calls — input → output only.

import type { ChurnRisk, ContractTier, DeploymentStage } from "@/lib/supabase/types";

// ─────────────────────────────────────────────────────────────────────────
// ARR derivation
//
// Background:
// Each Salesforce Opportunity represents a single annual contract event —
// a New deal, a Renewal, an Expansion, or a Closed Lost. Within a year a
// customer may have several sub-deals that roll up into one cumulative
// renewal at year end. The CURRENT ARR is therefore a single number: the
// Amount of the most recently-dated contract that is either:
//   (a) Currently OPEN with probability ≥ 50% — the upcoming renewal we
//       expect to land, OR
//   (b) Closed Won — the active contract today.
// Pick the more recent of (a) and (b) by close date.
//
// Naive summing across all opps double-counts (a Y2 renewal of $384K does
// NOT add to the original Y1 deal of $24K — it replaces it).
// ─────────────────────────────────────────────────────────────────────────

export interface OppForArr {
  amount: number | null;
  close_date: string | null; // YYYY-MM-DD
  is_closed: boolean;
  is_won: boolean;
  probability: number | null; // 0-100
}

export interface ArrDerivation {
  arr: number | null;
  renewal_date: string | null;
  source_close_date: string | null;
  rationale: string;
}

export function deriveArr(opps: OppForArr[]): ArrDerivation {
  if (opps.length === 0) {
    return { arr: null, renewal_date: null, source_close_date: null, rationale: "no opportunities" };
  }
  const eligible = opps.filter(
    (o) => o.is_won || (!o.is_closed && (o.probability ?? 0) >= 50)
  );
  if (eligible.length === 0) {
    return {
      arr: null,
      renewal_date: null,
      source_close_date: null,
      rationale: `no won or late-stage open opps (${opps.length} total; all early-stage / lost)`,
    };
  }
  const sorted = [...eligible].sort((a, b) => {
    const ad = a.close_date ?? "";
    const bd = b.close_date ?? "";
    if (ad === bd) return 0;
    return ad < bd ? 1 : -1;
  });
  const latest = sorted[0];

  // Renewal date = soonest future open w/ prob ≥ 50%. Independent of ARR.
  const today = new Date().toISOString().slice(0, 10);
  const futureOpen = opps
    .filter((o) => !o.is_closed && (o.probability ?? 0) >= 50 && (o.close_date ?? "") >= today)
    .sort((a, b) => ((a.close_date ?? "") < (b.close_date ?? "") ? -1 : 1));

  return {
    arr: latest.amount,
    renewal_date: futureOpen[0]?.close_date ?? null,
    source_close_date: latest.close_date,
    rationale: latest.is_won
      ? `latest Closed Won (${latest.close_date})`
      : `latest open ≥50% (${latest.close_date})`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Category-derived helpers
//
// DeliveryOps's seven customer categories map to a small enum-bounded set
// of profile + internal_profile fields. These mappings encode our defaults;
// CSMs override per-customer via the inline editor or the operations chat.
// ─────────────────────────────────────────────────────────────────────────

export function deriveTier(category: string | null): ContractTier | null {
  switch ((category ?? "").toLowerCase()) {
    case "strategic growth":
    case "upcoming renewals":
    case "at risk":
      return "enterprise";
    case "active":
    case "partner managed":
      return "growth";
    case "pov":
      return "starter";
    case "to drop":
    case "churned":
      return "enterprise"; // historical signal; they were enterprise when active
    default:
      return null;
  }
}

export function deriveDeploymentStage(category: string | null): DeploymentStage {
  switch ((category ?? "").toLowerCase()) {
    case "pov":
      return "pilot";
    case "to drop":
    case "churned":
      return "mature";
    case "active":
    case "strategic growth":
    case "upcoming renewals":
    case "at risk":
    case "partner managed":
      return "scaling";
    default:
      return "onboarding";
  }
}

export function deriveHealthScore(category: string | null): number {
  switch ((category ?? "").toLowerCase()) {
    case "at risk":
      return 30;
    case "to drop":
      return 15; // worse than At Risk (we've decided to drop) but not zero (they're still active)
    case "upcoming renewals":
      return 60;
    case "strategic growth":
      return 75;
    case "active":
      return 70;
    case "partner managed":
      return 65;
    case "pov":
      return 50;
    case "churned":
      return 0;
    default:
      return 50;
  }
}

export function deriveChurnRisk(category: string | null): ChurnRisk {
  switch ((category ?? "").toLowerCase()) {
    case "at risk":
    case "to drop":
    case "churned":
      return "high";
    case "upcoming renewals":
      return "medium";
    default:
      return "low";
  }
}
