"use client";

import { InsightsCard } from "@kognitos/lattice";
import type { ProjectsStatProps } from "@/lib/customers/view-model";

export function ProjectsStat({ total, inProgress, delivered, pipeline, className }: ProjectsStatProps & { className?: string }) {
  const trendParts = [
    inProgress > 0 ? `${inProgress} in progress` : null,
    delivered > 0 ? `${delivered} delivered` : null,
    pipeline > 0 ? `${pipeline} in pipeline` : null,
  ].filter(Boolean);

  return (
    <InsightsCard
      className={className}
      title="Projects"
      value={String(total)}
      trend={
        trendParts.length > 0
          ? { value: trendParts.join(" · "), type: inProgress > 0 ? "positive" : undefined }
          : undefined
      }
    />
  );
}