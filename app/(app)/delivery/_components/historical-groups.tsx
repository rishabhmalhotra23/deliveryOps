"use client";

// Delivery's Historical section: the same rows the other sections use, grouped
// by the fiscal quarter each process went live, newest first.
//
// This is the team's output record — "how much have we shipped" — which is why
// the axis is time rather than whatever column you last sorted by, and why a
// live process appears here as well as in its operational section. Grouping
// and the bar strip come from lib/delivery/historical.ts; the rows inside each
// group are the ordinary ProcessTable, passed in by `renderGroup`, so every
// inline edit still works. Editing a lifecycle here moves the row out of the
// section on the next render, because membership is derived (see
// lib/delivery/sections.ts) rather than stored.
//
// Approved design: docs/mockups/2026-09-04-delivery-three-sections.html.

import { useState } from "react";
import { groupByQuarter, deliveredSeries, NO_QUARTER } from "@/lib/delivery/historical";
import type { DetailProcess } from "@/app/_components/process-detail";

export function HistoricalGroups({
  rows,
  renderGroup,
  emptyTitle,
  emptyHint,
}: {
  rows: DetailProcess[];
  renderGroup: (groupRows: DetailProcess[]) => React.ReactNode;
  emptyTitle: string;
  emptyHint: string;
}) {
  const groups = groupByQuarter(rows);
  const series = deliveredSeries(groups);
  // Newest quarter open, the rest collapsed: 132 rows across 12 quarters is a
  // lot of table to scroll past to reach the second group.
  //
  // Held as per-quarter OVERRIDES rather than as the collapsed set itself,
  // because the set can't be seeded once at mount: `groups` depends on the
  // active filters, so mounting while a filter matched nothing (a
  // ?owner= deep link, say) seeded an empty set, and clearing the filter
  // then expanded all twelve quarters at once. Anything the user hasn't
  // touched falls back to the rule below.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const newestQuarter = groups[0]?.quarter;
  const isCollapsedFor = (quarter: string) => overrides[quarter] ?? quarter !== newestQuarter;

  if (rows.length === 0) {
    // Matches ProcessTable's own empty block rather than importing a shared
    // component that doesn't exist.
    return (
      <div className="rounded-xl border px-6 py-12 text-center" style={{ borderColor: "var(--brand-metal-line)" }}>
        <div className="text-[13px] text-[color:var(--foreground)]">{emptyTitle}</div>
        <div className="text-[12px] text-[color:var(--muted-foreground)] mt-1">{emptyHint}</div>
      </div>
    );
  }

  const peak = Math.max(1, ...series.map((p) => p.delivered));

  function toggle(quarter: string) {
    setOverrides((cur) => ({ ...cur, [quarter]: !isCollapsedFor(quarter) }));
  }

  /** The bar strip's "show only this quarter". */
  function isolate(quarter: string) {
    setOverrides(Object.fromEntries(groups.map((g) => [g.quarter, g.quarter !== quarter])));
  }

  return (
    <div className="space-y-3">
      {/* Delivered per quarter. A plain flex row of divs rather than a chart
          component: it's one series of a dozen integers, and pulling in
          Recharts for that would ship a chart library to render 12 bars. */}
      {series.length > 1 ? (
        <div
          className="rounded-xl border p-3"
          style={{ borderColor: "var(--brand-metal-line)", background: "var(--surface-1, var(--card))" }}
        >
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-2">
            Processes delivered per quarter
          </div>
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {series.map((point) => (
              <button
                key={point.quarter}
                type="button"
                onClick={() => isolate(point.quarter)}
                title={`${point.delivered} delivered in ${point.quarter} — click to show only this quarter`}
                className="shrink-0 flex flex-col items-center gap-1 group"
              >
                <span className="text-[10px] font-mono text-[color:var(--muted-foreground)]">
                  {point.delivered}
                </span>
                <span
                  className="rounded-t transition-opacity group-hover:opacity-100"
                  style={{
                    width: 18,
                    // 4px floor so a zero-delivery quarter is still a visible
                    // tick rather than vanishing from its own timeline.
                    height: Math.max(4, Math.round((point.delivered / peak) * 52)),
                    background: "var(--brand-yellow)",
                    opacity: 0.85,
                  }}
                />
                <span className="text-[9px] text-[color:var(--muted-foreground)]">{point.quarter}</span>
              </button>
            ))}
          </div>
          <div className="text-[10.5px] text-[color:var(--muted-foreground)] mt-1.5">
            Fiscal quarters — February to January, named for the year they end in, the same
            convention as NPS.
          </div>
        </div>
      ) : null}

      {groups.map((group) => {
        const isCollapsed = isCollapsedFor(group.quarter);
        return (
          <div key={group.quarter}>
            <button
              type="button"
              onClick={() => toggle(group.quarter)}
              className="w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left mb-1.5"
              style={{
                borderColor: "var(--brand-metal-line)",
                background: "var(--surface-2, var(--muted))",
                // The undated group isn't a point in time, so it's visually
                // demoted rather than sitting as a peer of real quarters.
                opacity: group.quarter === NO_QUARTER ? 0.75 : 1,
              }}
            >
              <span className="text-[11px] text-[color:var(--muted-foreground)] w-3">
                {isCollapsed ? "▸" : "▾"}
              </span>
              <span className="text-[13px] font-semibold text-[color:var(--foreground)]">
                {group.label}
              </span>
              <span className="text-[11.5px] text-[color:var(--muted-foreground)]">
                {[
                  group.live > 0 ? `${group.live} delivered` : null,
                  group.ended > 0 ? `${group.ended} ended` : null,
                  group.needsTriage > 0 ? `${group.needsTriage} need triage` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="ml-auto font-mono text-[11px] text-[color:var(--muted-foreground)]">
                {group.rows.length}
              </span>
            </button>
            {!isCollapsed ? renderGroup(group.rows) : null}
          </div>
        );
      })}
    </div>
  );
}
