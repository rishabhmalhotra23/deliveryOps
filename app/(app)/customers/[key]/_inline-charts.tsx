"use client";

// Inline mini-charts for the customer page. Server passes pre-aggregated
// points; we render with Recharts. Two charts:
//   - ArrHistoryChart: every annual contract event (Won amounts) over time,
//     so the JBI-style $24K → $384K expansion shows up at a glance.
//   - NpsTrendChart: average NPS per quarter, with promoter / detractor
//     counts overlaid.

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from "recharts";

const BRAND_NIGHT = "#171717";
const BRAND_YELLOW = "#F2FF70";
const PROMOTER = "#059669";
const DETRACTOR = "#DC2626";

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// ─────────────────────────────────────────────────────────────────────
// ARR history — every Won contract event + the current expected ARR.
// ─────────────────────────────────────────────────────────────────────

export interface ArrPoint {
  date: string; // YYYY-MM-DD
  amount: number; // contract amount
  type: "Won" | "Open"; // Closed Won (historical) vs current open expected
  name: string; // opp name, for tooltip
}

export function ArrHistoryChart({ data }: { data: ArrPoint[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.amount));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="arrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND_YELLOW} stopOpacity={0.5} />
            <stop offset="100%" stopColor={BRAND_YELLOW} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#525252" }}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#525252" }}
          tickFormatter={fmtCompact}
          domain={[0, Math.ceil(max / 100_000) * 100_000 || 100_000]}
        />
        <Tooltip
          formatter={(value) => fmtCompact(Number(value))}
          labelFormatter={(d) => String(d)}
          contentStyle={{
            background: "white",
            border: "1px solid #E5E5E5",
            borderRadius: 6,
            fontSize: 11,
          }}
        />
        <Area
          type="stepAfter"
          dataKey="amount"
          stroke={BRAND_NIGHT}
          strokeWidth={2.5}
          fill="url(#arrFill)"
        />
        {data
          .filter((d) => d.type === "Open")
          .map((d) => (
            <ReferenceDot
              key={d.date + d.name}
              x={d.date}
              y={d.amount}
              r={5}
              fill={BRAND_YELLOW}
              stroke={BRAND_NIGHT}
              strokeWidth={2}
            />
          ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NPS quarter trend — average score per quarter, line.
// ─────────────────────────────────────────────────────────────────────

export interface NpsTrendPoint {
  quarter: string; // "1Q26"
  average: number; // 0-10
  count: number;
  promoter: number;
  passive: number;
  detractor: number;
}

export function NpsTrendChart({ data }: { data: NpsTrendPoint[] }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: "#525252" }} />
        <YAxis
          tick={{ fontSize: 10, fill: "#525252" }}
          domain={[0, 10]}
          ticks={[0, 5, 7, 9, 10]}
        />
        <Tooltip
          formatter={(value, name) => {
            if (name === "average") return [Number(value).toFixed(1), "Avg score"];
            return [String(value), String(name)];
          }}
          contentStyle={{
            background: "white",
            border: "1px solid #E5E5E5",
            borderRadius: 6,
            fontSize: 11,
          }}
        />
        <Line
          type="monotone"
          dataKey="average"
          name="average"
          stroke={BRAND_NIGHT}
          strokeWidth={2.5}
          dot={{ fill: BRAND_YELLOW, stroke: BRAND_NIGHT, strokeWidth: 2, r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="promoter"
          name="promoter"
          stroke={PROMOTER}
          strokeWidth={1.5}
          dot={{ r: 2 }}
          strokeDasharray="3 3"
        />
        <Line
          type="monotone"
          dataKey="detractor"
          name="detractor"
          stroke={DETRACTOR}
          strokeWidth={1.5}
          dot={{ r: 2 }}
          strokeDasharray="3 3"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
