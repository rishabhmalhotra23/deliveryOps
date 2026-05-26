"use client";

import { formatPersonName } from "@/lib/delivery/taxonomy";
import type { AccountSnapshotProps } from "@/lib/customers/view-model";

export function AccountSnapshot({
  npsAverage,
  npsCount,
  nextQbrDate,
  sfAccountOwner,
  className,
}: AccountSnapshotProps & { className?: string }) {
  const npsColor =
    (npsAverage ?? 0) >= 7
      ? "text-emerald-600 dark:text-emerald-400"
      : (npsAverage ?? 0) >= 5
      ? "text-amber-600 dark:text-amber-400"
      : npsAverage == null
      ? "text-[color:var(--muted-foreground)]"
      : "text-red-600 dark:text-red-400";

  return (
    <div className={`scanning-line glass-card overflow-hidden ${className ?? ""}`}>
      <div className="px-4 py-3 border-b border-[var(--glass-border)]">
        <div className="eyebrow text-[color:var(--muted-foreground)]">Account snapshot</div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="eyebrow">NPS avg</span>
          <div className="flex items-baseline gap-1.5">
            <span className={`data-label text-[14px] font-semibold tabular-nums ${npsColor}`}>
              {npsAverage != null ? npsAverage.toFixed(1) : "—"}
            </span>
            <span className="data-label text-[color:var(--muted-foreground)]">{npsCount} resp.</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="eyebrow">Next QBR</span>
          <span className="data-label text-[color:var(--foreground)]">{nextQbrDate ?? "—"}</span>
        </div>

        {sfAccountOwner ? (
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">SF owner</span>
            <span
              className="data-label text-[color:var(--foreground)] break-words text-right"
              title={`Salesforce account owner: ${sfAccountOwner}`}
            >
              {formatPersonName(sfAccountOwner)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
