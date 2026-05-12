"use client";

import { InsightsCard } from "@kognitos/lattice";
import type { NpsStatProps } from "@/lib/customers/view-model";

export function NpsStat({ average, count, promoters, detractors, latestQuarter, className }: NpsStatProps & { className?: string }) {
  const trendValue = count > 0
    ? `${promoters}P · ${detractors}D · ${count} total`
    : undefined;

  const trendType =
    average == null ? undefined : average >= 8 ? "positive" : average < 6 ? "negative" : undefined;

  return (
    <InsightsCard
      className={className}
      title={`Average NPS${latestQuarter ? ` · ${latestQuarter}` : ""}`}
      value={average != null ? average.toFixed(1) : "—"}
      trend={trendValue ? { value: trendValue, type: trendType } : undefined}
      variant={
        average == null ? "default"
        : average >= 8 ? "success"
        : average < 6 ? "destructive"
        : "default"
      }
    />
  );
}