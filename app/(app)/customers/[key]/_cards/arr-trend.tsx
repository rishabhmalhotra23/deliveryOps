"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { EmptyState } from "@kognitos/lattice";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Dot } from "recharts";
import type { ArrPoint } from "@/lib/customers/view-model";
import { fmtMoney } from "@/lib/customers/view-model";

function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return {
    grid: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
    axis: dark ? "#71717a" : "#a1a1aa",
    tooltipBg: dark ? "#18181b" : "#ffffff",
    tooltipBorder: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    text: dark ? "#f4f4f5" : "#18181b",
  };
}

export function ArrTrend({ data, className }: { data: ArrPoint[]; className?: string }) {
  const t = useChartTheme();

  if (data.length === 0) {
    return (
      <div className={`glass-card glass-card-hover p-5 ${className ?? ""}`}>
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-2">Contract history</div>
        <EmptyState
          icon="TrendingUp"
          title="No contract history"
          description="Appears once a Salesforce opportunity closes Won."
        />
      </div>
    );
  }

  const won = data.filter((d) => d.type === "Won");
  const open = data.filter((d) => d.type === "Open");
  const currentArr = won.length > 0 ? won[won.length - 1].amount : 0;
  const prevArr = won.length > 1 ? won[won.length - 2].amount : null;
  const delta = prevArr != null ? currentArr - prevArr : null;

  return (
    <div className={`glass-card glass-card-hover overflow-hidden ${className ?? ""}`}>
      {/* Header with KPI */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between border-b border-[var(--glass-border)]">
        <div>
          <div className="eyebrow text-[color:var(--muted-foreground)]">Contract ARR</div>
          <div className="text-3xl font-bold tabular-nums text-[color:var(--foreground)] mt-0.5">
            {fmtMoney(currentArr)}
          </div>
        </div>
        {delta !== null && delta !== 0 ? (
          <div className={`rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ${delta > 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
            {delta > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(delta))}
          </div>
        ) : null}
      </div>

      {/* Chart */}
      <div className="px-4 pt-4 pb-3">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: t.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) => d.slice(0, 7)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: t.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(n: number) => fmtMoney(n)}
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: t.tooltipBg,
                border: `1px solid ${t.tooltipBorder}`,
                borderRadius: 8,
                fontSize: 12,
                color: t.text,
              }}
              formatter={(value, _name, payload) => {
                const item = payload?.payload as ArrPoint;
                return [fmtMoney(Number(value)), item?.name ?? "Contract"];
              }}
            />
            {/* Reference lines for contract events */}
            {won.map((d) => (
              <ReferenceLine
                key={`ref-${d.date}-${d.name}`}
                x={d.date}
                stroke="rgba(129,140,248,0.3)"
                strokeDasharray="4 2"
              />
            ))}
            {/* Won contracts: solid line */}
            <Line
              data={won}
              type="stepAfter"
              dataKey="amount"
              stroke="#818cf8"
              strokeWidth={2.5}
              dot={(props) => {
                const { cx, cy } = props;
                return (
                  <Dot
                    key={`dot-${props.index}`}
                    cx={cx} cy={cy}
                    r={5}
                    fill="#818cf8"
                    stroke={t.tooltipBg}
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 7, stroke: t.tooltipBg, strokeWidth: 2 }}
            />
            {/* Open/expected: dashed line */}
            {open.length > 0 && (
              <Line
                data={[...won.slice(-1), ...open]}
                type="stepAfter"
                dataKey="amount"
                stroke="#F2FF70"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ r: 5, fill: "#F2FF70", stroke: t.tooltipBg, strokeWidth: 2 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>

        {/* Contract event legend */}
        {won.length > 0 && (
          <div className="mt-3 space-y-1">
            {[...won, ...open]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 4)
              .map((d, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${d.type === "Open" ? "bg-[#F2FF70]" : "bg-[#818cf8]"}`} />
                    <span className="text-[color:var(--muted-foreground)] truncate max-w-[180px]">{d.name}</span>
                    {d.type === "Open" && (
                      <span className="text-[10px] text-amber-500 font-medium">expected</span>
                    )}
                  </div>
                  <span className="font-semibold tabular-nums text-[color:var(--foreground)]">{fmtMoney(d.amount)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
