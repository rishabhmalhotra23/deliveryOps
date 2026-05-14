"use client";

import type { K2Metrics } from "@/lib/customers/k2-metrics";

interface K2MetricsCardProps {
  metrics: K2Metrics;
  className?: string;
}

export function K2MetricsCard({ metrics, className }: K2MetricsCardProps) {
  if (!metrics.enabled) {
    return (
      <div className={`glass-card overflow-hidden ${className ?? ""}`}>
        <div className="px-4 py-3 border-b border-[var(--glass-border)]">
          <div className="eyebrow text-[color:var(--muted-foreground)]">Automation health</div>
        </div>
        <div className="px-4 py-3 text-xs text-[color:var(--muted-foreground)]">
          Not linked to a Kognitos workspace. Set <code>customers.kognitos_v2_workspace_id</code> to enable.
        </div>
      </div>
    );
  }

  const successTone =
    (metrics.success_rate_pct ?? 0) >= 90
      ? "text-emerald-600 dark:text-emerald-400"
      : (metrics.success_rate_pct ?? 0) >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div className={`glass-card overflow-hidden ${className ?? ""}`}>
      <div className="px-4 py-3 border-b border-[var(--glass-border)]">
        <div className="flex items-center justify-between">
          <div className="eyebrow text-[color:var(--muted-foreground)]">Automation health</div>
          <span className="data-label text-[10px] text-[color:var(--muted-foreground)]">
            last {metrics.window_days}d
          </span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Runs</span>
          <span className="data-label text-[14px] font-semibold text-[color:var(--foreground)] tabular-nums">
            {metrics.total_runs}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="eyebrow">Success rate</span>
          <span className={`data-label text-[14px] font-semibold tabular-nums ${successTone}`}>
            {metrics.success_rate_pct != null ? `${metrics.success_rate_pct}%` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="eyebrow">Failed / awaiting</span>
          <span className="data-label tabular-nums text-[color:var(--foreground)]">
            {metrics.failed} / {metrics.awaiting_guidance}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="eyebrow">Avg duration</span>
          <span className="data-label tabular-nums text-[color:var(--foreground)]">
            {metrics.avg_duration_sec > 0 ? `${metrics.avg_duration_sec}s` : "—"}
          </span>
        </div>
        {metrics.last_run_at ? (
          <div className="flex items-center justify-between">
            <span className="eyebrow">Last run</span>
            <span className="data-label text-[color:var(--muted-foreground)]">
              {new Date(metrics.last_run_at).toLocaleDateString()}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
