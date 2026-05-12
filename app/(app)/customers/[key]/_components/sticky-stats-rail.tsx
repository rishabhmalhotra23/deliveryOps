"use client";

import { useEffect, useRef, useState } from "react";
import { fmtMoney } from "@/lib/customers/view-model";
import type { ArrStatProps, NpsStatProps, ProjectsStatProps } from "@/lib/customers/view-model";

interface StickyStatsRailProps {
  displayName: string;
  arrStat: ArrStatProps;
  npsStat: NpsStatProps;
  projectsStat: ProjectsStatProps;
  healthScore: number;
  renewalDate: string | null;
}

function Pip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div>
        <div className="eyebrow text-[color:var(--muted-foreground)]">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="data-label text-[13px] font-semibold text-[color:var(--foreground)]">{value}</span>
          {sub ? <span className="data-label text-[10px] text-[color:var(--muted-foreground)]">{sub}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-[var(--glass-border)]" />;
}

export function StickyStatsRail({
  displayName,
  arrStat,
  npsStat,
  projectsStat,
  healthScore,
  renewalDate,
}: StickyStatsRailProps) {
  const [visible, setVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-64px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const healthColor =
    healthScore >= 70
      ? "text-emerald-500"
      : healthScore >= 50
      ? "text-amber-500"
      : "text-red-500";

  return (
    <>
      {/* Sentinel element placed just below the hero to trigger the sticky bar */}
      <div ref={sentinelRef} className="h-px" />

      <div
        className={`sticky top-0 z-30 transition-all duration-200 ${
          visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="glass-card rounded-none border-x-0 border-t-0 px-6 py-2.5 max-w-full">
          <div className="max-w-[1400px] mx-auto flex items-center gap-4 overflow-x-auto">
            {/* Customer name */}
            <span className="text-sm font-semibold tracking-tighter text-[color:var(--foreground)] shrink-0 mr-2">
              {displayName}
            </span>
            <Divider />
            <Pip
              label="ARR"
              value={fmtMoney(arrStat.currentArr)}
              sub={
                arrStat.direction === "growth" && arrStat.deltaPct != null
                  ? `▲${arrStat.deltaPct.toFixed(0)}%`
                  : arrStat.direction === "contraction" && arrStat.deltaPct != null
                  ? `▼${Math.abs(arrStat.deltaPct).toFixed(0)}%`
                  : undefined
              }
            />
            <Divider />
            <Pip
              label="NPS"
              value={npsStat.average != null ? npsStat.average.toFixed(1) : "—"}
              sub={`${npsStat.count} resp.`}
            />
            <Divider />
            <div>
              <div className="eyebrow text-[color:var(--muted-foreground)]">Health</div>
              <span className={`data-label text-[13px] font-semibold tabular-nums ${healthColor}`}>
                {healthScore}
              </span>
            </div>
            <Divider />
            <Pip label="Projects" value={String(projectsStat.inProgress)} sub="active" />
            {renewalDate ? (
              <>
                <Divider />
                <Pip label="Renewal" value={renewalDate} />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
