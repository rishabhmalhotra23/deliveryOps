"use client";

import { Badge } from "@kognitos/lattice";
import type { HealthSpotlightProps } from "@/lib/customers/view-model";

function scoreTone(score: number) {
  if (score >= 70) return "success" as const;
  if (score >= 50) return "warning" as const;
  return "destructive" as const;
}

const TONE_STYLES = {
  success: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/8",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/20",
    label: "Healthy",
  },
  warning: {
    bg: "bg-amber-500/10 dark:bg-amber-500/8",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/20",
    label: "Needs attention",
  },
  destructive: {
    bg: "bg-red-500/10 dark:bg-red-500/8",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/20",
    label: "At risk",
  },
};

function riskVariant(risk: string): "destructive" | "warning" | "secondary" {
  if (risk === "high") return "destructive";
  if (risk === "medium") return "warning";
  return "secondary";
}

export function HealthSpotlight({
  healthScore,
  healthExplanation,
  churnRisk,
  npsAverage,
  npsCount,
  nextQbrDate,
  sfAccountOwner,
  className,
}: HealthSpotlightProps & { className?: string }) {
  const tone = scoreTone(healthScore);
  const styles = TONE_STYLES[tone];
  const npsColor =
    (npsAverage ?? 0) >= 7
      ? "text-emerald-600 dark:text-emerald-400"
      : (npsAverage ?? 0) >= 5
      ? "text-amber-600 dark:text-amber-400"
      : npsAverage == null
      ? "text-[color:var(--muted-foreground)]"
      : "text-red-600 dark:text-red-400";

  return (
    <div
      className={`scanning-line glass-card overflow-hidden ${className ?? ""}`}
    >
      {/* Color-tinted header */}
      <div className={`${styles.bg} border-b ${styles.border} px-4 pt-4 pb-3`}>
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-2">Internal health · CSM only</div>
        <div className="flex items-end gap-3">
          <span className={`text-5xl font-display font-semibold tracking-tighter tabular-nums ${styles.text}`}>
            {healthScore}
          </span>
          <div className="pb-1">
            <div className={`text-sm font-semibold ${styles.text}`}>{styles.label}</div>
            <div className="data-label text-[color:var(--muted-foreground)]">out of 100</div>
          </div>
        </div>
      </div>

      {/* Explanation */}
      {healthExplanation ? (
        <div className="px-4 py-3 border-b border-[var(--glass-border)]">
          <p className="text-xs text-[color:var(--muted-foreground)] leading-relaxed">{healthExplanation}</p>
        </div>
      ) : null}

      {/* Detail grid */}
      <div className="px-4 py-3 space-y-3">
        {/* NPS avg */}
        <div className="flex items-center justify-between">
          <span className="eyebrow">NPS avg</span>
          <div className="flex items-baseline gap-1.5">
            <span className={`data-label text-[14px] font-semibold tabular-nums ${npsColor}`}>
              {npsAverage != null ? npsAverage.toFixed(1) : "—"}
            </span>
            <span className="data-label text-[color:var(--muted-foreground)]">{npsCount} resp.</span>
          </div>
        </div>

        {/* Churn risk */}
        <div className="flex items-center justify-between">
          <span className="eyebrow">Churn risk</span>
          <Badge variant={riskVariant(churnRisk)} className="text-[10px] capitalize">{churnRisk}</Badge>
        </div>

        {/* Next QBR */}
        <div className="flex items-center justify-between">
          <span className="eyebrow">Next QBR</span>
          <span className="data-label text-[color:var(--foreground)]">{nextQbrDate ?? "—"}</span>
        </div>

        {/* SF owner */}
        {sfAccountOwner ? (
          <div className="flex items-center justify-between">
            <span className="eyebrow">SF owner</span>
            <span className="data-label text-[color:var(--foreground)] truncate max-w-[120px]">{sfAccountOwner}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
