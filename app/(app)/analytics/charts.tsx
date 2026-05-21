"use client";

import {
  BarChart, Bar, Cell, PieChart, Pie, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadialBarChart, RadialBar, LabelList, ReferenceLine, ComposedChart,
} from "recharts";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

// ── Theme hook ───────────────────────────────────────────────────────────────
function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return {
    grid:   dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
    axis:   dark ? "#71717a" : "#a1a1aa",
    bg:     dark ? "#18181b" : "#ffffff",
    border: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    text:   dark ? "#f4f4f5" : "#18181b",
    muted:  dark ? "#71717a" : "#71717a",
    tooltipStyle: {
      background: dark ? "#18181b" : "#ffffff",
      border:     dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)",
      borderRadius: 10,
      padding: "8px 12px",
      fontSize: 12,
      color:    dark ? "#f4f4f5" : "#18181b",
      boxShadow: dark ? "0 8px 32px rgba(0,0,0,0.6)" : "0 8px 32px rgba(0,0,0,0.12)",
    },
  };
}

// ── Colour palette ───────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  "At Risk":         "#f43f5e",
  "Upcoming Renewals": "#fb923c",
  "Strategic Growth":  "#34d399",
  "Active":            "#60a5fa",
  "Partner Managed":   "#a78bfa",
  "POV":               "#facc15",
  "To Drop":           "#ef4444",
  "Churned":           "#6b7280",
};

const CHART_PALETTE = [
  "#818cf8", "#34d399", "#fb923c", "#f43f5e",
  "#38bdf8", "#a78bfa", "#fbbf24", "#6ee7b7",
  "#f87171", "#c084fc",
];

const NPS_COLORS = { Promoter: "#34d399", Passive: "#fbbf24", Detractor: "#f43f5e" };

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// Gradient definitions for reuse
function Gradients() {
  return (
    <defs>
      <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradPurple" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradOrange" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fb923c" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

// ── ARR Donut ────────────────────────────────────────────────────────────────

export function ArrByCategoryChart({
  data,
}: {
  data: Array<{ category: string; arr: number; count: number }>;
}) {
  const t = useChartTheme();
  const filtered = data.filter((d) => d.arr > 0);
  const total = filtered.reduce((s, d) => s + d.arr, 0);

  const CustomLabel = ({ cx, cy }: { cx?: number; cy?: number }) => {
    const x = cx ?? 0;
    const y = cy ?? 0;
    return (
      <g>
        <text x={x} y={y - 10} textAnchor="middle" fill={t.text} fontSize={22} fontWeight={700}>
          {fmtMoney(total)}
        </text>
        <text x={x} y={y + 14} textAnchor="middle" fill={t.muted} fontSize={11}>
          Total ARR
        </text>
      </g>
    );
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={filtered}
            dataKey="arr"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={75}
            outerRadius={110}
            paddingAngle={2}
            labelLine={false}
            label={(props) => <CustomLabel cx={props.cx} cy={props.cy} />}
          >
            {filtered.map((entry, i) => (
              <Cell key={i} fill={CATEGORY_COLORS[entry.category] ?? CHART_PALETTE[i % CHART_PALETTE.length]} strokeWidth={0} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(value) => [fmtMoney(Number(value)), "ARR"]}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1 px-2">
        {filtered.map((d, i) => (
          <div key={d.category} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[d.category] ?? CHART_PALETTE[i % CHART_PALETTE.length] }} />
            <span style={{ color: t.axis }}>{d.category}</span>
            <span className="font-semibold tabular-nums" style={{ color: t.text }}>{fmtMoney(d.arr)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Customers by Category (horizontal bars) ──────────────────────────────────

export function CustomersByCategoryChart({
  data,
}: {
  data: Array<{ category: string; count: number }>;
}) {
  const t = useChartTheme();
  const sorted = [...data].sort((a, b) => b.count - a.count);
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, sorted.length * 36)}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 0, right: 40, left: 110, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="category"
          tick={{ fontSize: 12, fill: t.text }}
          width={105}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={t.tooltipStyle} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
          {sorted.map((entry, i) => (
            <Cell key={i} fill={CATEGORY_COLORS[entry.category] ?? CHART_PALETTE[i % CHART_PALETTE.length]} />
          ))}
          <LabelList dataKey="count" position="right" style={{ fill: t.axis, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Projects by Group ────────────────────────────────────────────────────────

const GROUP_COLORS: Record<string, string> = {
  "Active":             "#818cf8",
  "Pipeline":           "#38bdf8",
  "On Hold":            "#fbbf24",
  "Backlog":            "#6b7280",
  "Active Projects":    "#34d399",
  "Completed Projects": "#818cf8",
  "Stalled Projects":   "#fb923c",
  "Cancelled Projects": "#f43f5e",
  "Upcoming Projects":  "#38bdf8",
  "Projects":           "#a78bfa",
};

export function ProjectsByGroupChart({ data }: { data: Array<{ group: string; count: number }> }) {
  const t = useChartTheme();
  const sorted = [...data].filter(d => d.count > 0).sort((a, b) => b.count - a.count).slice(0, 12);
  // Min height keeps the chart looking like a chart even when there are
  // only 2-3 entries; row spacing of 48px gives bars enough vertical room
  // to look like solid bars rather than thin lines.
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, sorted.length * 48)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 8, right: 56, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="group" tick={{ fontSize: 12, fill: t.text }} width={150} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [`${v} projects`, "Projects"]} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={32}>
          {sorted.map((entry, i) => (
            <Cell key={i} fill={GROUP_COLORS[entry.group] ?? CHART_PALETTE[i % CHART_PALETTE.length]} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            style={{ fill: t.text, fontSize: 12, fontWeight: 600 }}
            offset={8}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Deliveries Area Chart ────────────────────────────────────────────────────

export function DeliveriesOverTimeChart({ data }: { data: Array<{ month: string; count: number }> }) {
  const t = useChartTheme();

  // Determine which months to show as X-axis labels (first month of each quarter)
  const xTicks = data
    .map((d) => d.month)
    .filter((m) => {
      const month = parseInt(m.split("-")[1], 10);
      return month === 1 || month === 4 || month === 7 || month === 10;
    });

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const yTicks = Array.from({ length: maxCount + 1 }, (_, i) => i).filter(
    (n) => n === 0 || n === Math.ceil(maxCount / 2) || n === maxCount
  );

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="delivGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: t.axis }}
          tickLine={false}
          axisLine={false}
          ticks={xTicks}
          tickFormatter={(m: string) => {
            const [year, month] = m.split("-");
            const q = Math.ceil(Number(month) / 3);
            return `Q${q}'${year.slice(2)}`;
          }}
        />
        <YAxis
          tick={{ fontSize: 10, fill: t.axis }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          ticks={yTicks}
          label={{ value: "projects", angle: -90, position: "insideLeft", offset: 10, fontSize: 9, fill: t.axis }}
        />
        <Tooltip
          contentStyle={t.tooltipStyle}
          labelFormatter={(label: unknown) => {
            const m = String(label ?? "");
            const [year, month] = m.split("-");
            const q = Math.ceil(Number(month) / 3);
            return `Q${q} ${year} · ${m}`;
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#34d399"
          strokeWidth={2.5}
          fill="url(#delivGrad)"
          dot={{ fill: "#34d399", strokeWidth: 0, r: 3 }}
          activeDot={{ r: 6, fill: "#34d399", stroke: t.tooltipStyle.background as string, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── NPS Gauge ────────────────────────────────────────────────────────────────

export function NpsGauge({ score, count }: { score: number | null; count: number }) {
  const t = useChartTheme();
  if (score == null) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: t.muted }}>
        No NPS data yet
      </div>
    );
  }
  const pct = Math.round((score / 10) * 100);
  const color = score >= 8 ? "#34d399" : score >= 6 ? "#fbbf24" : "#f43f5e";
  const label = score >= 8 ? "Excellent" : score >= 6 ? "Good" : "Needs work";

  const radialData = [
    { name: "score", value: pct, fill: color },
    { name: "empty", value: 100 - pct, fill: t.grid },
  ];

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={200}>
        <RadialBarChart
          cx="50%"
          cy="65%"
          innerRadius="60%"
          outerRadius="90%"
          startAngle={180}
          endAngle={0}
          data={radialData}
          barSize={18}
        >
          <RadialBar dataKey="value" cornerRadius={10} background={{ fill: t.grid }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="text-center -mt-16">
        <div className="text-5xl font-bold tabular-nums" style={{ color, lineHeight: 1 }}>
          {score.toFixed(1)}
        </div>
        <div className="text-sm mt-1 font-medium" style={{ color }}>{label}</div>
        <div className="text-xs mt-1" style={{ color: t.muted }}>{count} responses</div>
      </div>
    </div>
  );
}

// ── NPS by Quarter ───────────────────────────────────────────────────────────

export function NpsByQuarterChart({
  data,
}: {
  data: Array<{ quarter: string; average: number; promoter: number; passive: number; detractor: number }>;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="npsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="score" domain={[0, 10]} tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} width={28} />
        <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
        <Tooltip contentStyle={t.tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11, color: t.axis }} />
        <ReferenceLine yAxisId="score" y={7} stroke="#34d399" strokeDasharray="4 2" strokeWidth={1} />
        <Line
          yAxisId="score"
          type="monotone"
          dataKey="average"
          name="Avg score"
          stroke="#818cf8"
          strokeWidth={3}
          dot={{ fill: "#818cf8", r: 4, strokeWidth: 0 }}
          activeDot={{ r: 6, stroke: t.bg, strokeWidth: 2 }}
        />
        <Line yAxisId="count" type="monotone" dataKey="promoter" name="Promoters" stroke={NPS_COLORS.Promoter} strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
        <Line yAxisId="count" type="monotone" dataKey="detractor" name="Detractors" stroke={NPS_COLORS.Detractor} strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── NPS Distribution Bars ────────────────────────────────────────────────────

export function NpsDistributionChart({ data }: { data: Array<{ category: string; count: number }> }) {
  const t = useChartTheme();
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="space-y-3 py-4">
      {data.map((d) => {
        const pct = total > 0 ? (d.count / total) * 100 : 0;
        const color = NPS_COLORS[d.category as keyof typeof NPS_COLORS] ?? "#6b7280";
        return (
          <div key={d.category}>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: t.axis }}>
              <span className="font-medium" style={{ color: t.text }}>{d.category}</span>
              <span className="tabular-nums">{d.count} ({pct.toFixed(0)}%)</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: t.grid }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── AE Workload ──────────────────────────────────────────────────────────────

export function AeWorkloadChart({ data }: { data: Array<{ ae: string; count: number; arr: number }> }) {
  const t = useChartTheme();
  const top = [...data].sort((a, b) => b.arr - a.arr).slice(0, 8);
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, top.length * 48)}>
      <BarChart data={top} layout="vertical" margin={{ top: 8, right: 80, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={fmtMoney} />
        <YAxis type="category" dataKey="ae" tick={{ fontSize: 12, fill: t.text }} width={110} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={t.tooltipStyle}
          formatter={(value, name) => [name === "arr" ? fmtMoney(Number(value)) : value, name === "arr" ? "ARR" : "Customers"]}
        />
        <Bar dataKey="arr" name="arr" radius={[0, 6, 6, 0]} maxBarSize={32} fill="#818cf8">
          {top.map((_, i) => (
            <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
          ))}
          <LabelList
            dataKey="arr"
            position="right"
            style={{ fill: t.text, fontSize: 12, fontWeight: 600 }}
            offset={8}
            formatter={(v: unknown) => fmtMoney(Number(v))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Team Workload (TAM / FDE or Dev / SE) ────────────────────────────────────

function shortName(s: string): string {
  // Email → "First L." (first name + last initial). Compact + unambiguous.
  if (s.includes("@")) {
    const local = s.split("@")[0].replace(/[._]/g, " ");
    const parts = local.split(" ").filter(Boolean);
    return parts.length >= 2
      ? `${capitalise(parts[0])} ${parts[parts.length - 1][0].toUpperCase()}.`
      : capitalise(parts[0]);
  }
  // "Karthik Nagabhushana" → "Karthik N." so the y-axis doesn't wrap.
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  return s;
}
function capitalise(w: string): string {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

export function TeamWorkloadChart({ data }: { data: Array<{ person: string; count: number }> }) {
  const t = useChartTheme();
  const top = data.slice(0, 10).map((d) => ({ ...d, person: shortName(d.person) }));
  // Generous row height (48px) + min chart height (280px) so the chart looks
  // substantial when there are only 3-4 entries. Right-margin reserved for
  // the count label so it never collides with the axis.
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, top.length * 48)}>
      <BarChart data={top} layout="vertical" margin={{ top: 8, right: 56, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="person" tick={{ fontSize: 12, fill: t.text }} width={120} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [`${v} active project${v === 1 ? "" : "s"}`, "Workload"]} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={32}>
          {top.map((_, i) => (
            <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            style={{ fill: t.text, fontSize: 12, fontWeight: 600 }}
            offset={8}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── TTV Distribution ─────────────────────────────────────────────────────────

export function TtvDistributionChart({ data }: { data: Array<{ bucket: string; count: number }> }) {
  const t = useChartTheme();
  const colors = ["#34d399", "#fbbf24", "#fb923c", "#f43f5e", "#818cf8"];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: t.axis }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [`${v} projects`, "Projects"]} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={60}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          <LabelList dataKey="count" position="top" style={{ fill: t.axis, fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── TTV Trend ────────────────────────────────────────────────────────────────

export function TtvTrendChart({ data }: { data: Array<{ quarter: string; avg_days: number; count: number }> }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="ttvGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} unit="d" />
        <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [`${v}d`, "Avg TTV"]} />
        <Area type="monotone" dataKey="avg_days" fill="url(#ttvGrad)" stroke="#818cf8" strokeWidth={2.5} dot={{ r: 4, fill: "#818cf8", strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
