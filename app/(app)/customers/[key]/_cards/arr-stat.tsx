"use client";

import { InsightsCard } from "@kognitos/lattice";
import { fmtMoney } from "@/lib/customers/view-model";
import type { ArrStatProps } from "@/lib/customers/view-model";

export function ArrStat({ currentArr, previousArr, direction, deltaPct, renewalDate, className }: ArrStatProps & { className?: string }) {
  // trend display
  let trendValue: string | undefined;
  let trendType: "positive" | "negative" | undefined;

  if (direction === "growth" && deltaPct != null) {
    trendValue = `▲ ${Math.abs(deltaPct).toFixed(1)}% vs prior`;
    trendType = "positive";
  } else if (direction === "contraction" && deltaPct != null) {
    trendValue = `▼ ${Math.abs(deltaPct).toFixed(1)}% vs prior`;
    trendType = "negative";
  } else if (direction === "flat") {
    trendValue = "flat vs prior";
  } else if (direction === "first-contract") {
    trendValue = "first contract";
  } else if (renewalDate) {
    trendValue = `renews ${renewalDate}`;
  }

  return (
    <InsightsCard
      className={className}
      title="Kognitos ARR"
      value={fmtMoney(currentArr)}
      trend={trendValue ? { value: trendValue, type: trendType } : undefined}
    />
  );
}