"use client";

// Client-only Recharts wrappers. Server passes pre-aggregated data; we
// render the charts in the browser to avoid SSR'ing the entire Recharts
// runtime (~50KB+ post-tree-shake).

import {
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

const CATEGORY_COLOR: Record<string, string> = {
  "At Risk": "#991B1B",
  "Upcoming Renewals": "#92400E",
  "Strategic Growth": "#065F46",
  Active: "#1E40AF",
  "Partner Managed": "#5B21B6",
  POV: "#171717",
  "To Drop": "#B91C1C",
  Churned: "#525252",
};

const NPS_COLOR: Record<string, string> = {
  Promoter: "#059669",
  Passive: "#D97706",
  Detractor: "#DC2626",
};

const PROJECT_GROUP_COLOR: Record<string, string> = {
  Active: "#1E40AF",
  Pipeline: "#0EA5E9",
  "On Hold": "#A3A3A3",
  Backlog: "#D4D4D4",
};

const BRAND_YELLOW = "#F2FF70";
const BRAND_NIGHT = "#171717";

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// ─────────────────────────────────────────────────────────────────────
// ARR by Category — vertical bar
// ─────────────────────────────────────────────────────────────────────

export function ArrByCategoryChart({
  data,
}: {
  data: Array<{ category: string; arr: number; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 35 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis
          dataKey="category"
          tick={{ fontSize: 11, fill: "#525252" }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={50}
        />
        <YAxis tick={{ fontSize: 11, fill: "#525252" }} tickFormatter={fmtCompact} />
        <Tooltip
          formatter={(value) => fmtCompact(Number(value))}
          contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }}
        />
        <Bar dataKey="arr" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={CATEGORY_COLOR[entry.category] ?? BRAND_NIGHT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Customers by Category — horizontal bar
// ─────────────────────────────────────────────────────────────────────

export function CustomersByCategoryChart({
  data,
}: {
  data: Array<{ category: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, left: 90, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#525252" }} />
        <YAxis
          type="category"
          dataKey="category"
          tick={{ fontSize: 11, fill: "#525252" }}
          width={90}
        />
        <Tooltip contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={CATEGORY_COLOR[entry.category] ?? BRAND_NIGHT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Projects by Group (Active / Pipeline / On Hold / Backlog) — vertical bar
// ─────────────────────────────────────────────────────────────────────

export function ProjectsByGroupChart({
  data,
}: {
  data: Array<{ group: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis dataKey="group" tick={{ fontSize: 12, fill: "#525252" }} />
        <YAxis tick={{ fontSize: 11, fill: "#525252" }} allowDecimals={false} />
        <Tooltip contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={PROJECT_GROUP_COLOR[entry.group] ?? BRAND_NIGHT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AE workload — horizontal bar
// ─────────────────────────────────────────────────────────────────────

export function AeWorkloadChart({
  data,
}: {
  data: Array<{ ae: string; count: number; arr: number }>;
}) {
  const top = data.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, top.length * 30)}>
      <BarChart data={top} layout="vertical" margin={{ top: 10, right: 50, left: 90, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#525252" }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="ae"
          tick={{ fontSize: 11, fill: "#525252" }}
          width={90}
        />
        <Tooltip
          formatter={(value, name) => {
            if (name === "arr") return [fmtCompact(Number(value)), "ARR"];
            return [String(value), "Customers"];
          }}
          contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="count" fill={BRAND_NIGHT} name="Customers" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NPS distribution — donut
// ─────────────────────────────────────────────────────────────────────

export function NpsDistributionChart({
  data,
}: {
  data: Array<{ category: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="category"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={95}
          paddingAngle={2}
          label={(entry) => {
            const e = entry as unknown as { category?: string; count?: number };
            return `${e.category ?? ""} ${e.count ?? ""}`;
          }}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={NPS_COLOR[entry.category] ?? "#A3A3A3"} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NPS by quarter — line + stacked bars
// ─────────────────────────────────────────────────────────────────────

export function NpsByQuarterChart({
  data,
}: {
  data: Array<{ quarter: string; average: number; promoter: number; passive: number; detractor: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: "#525252" }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#525252" }} domain={[0, 10]} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#525252" }} allowDecimals={false} />
        <Tooltip contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="average"
          name="Average score"
          stroke={BRAND_NIGHT}
          strokeWidth={3}
          dot={{ fill: BRAND_YELLOW, stroke: BRAND_NIGHT, strokeWidth: 2, r: 5 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="promoter"
          name="Promoters"
          stroke={NPS_COLOR.Promoter}
          strokeWidth={1.5}
          dot={{ r: 3 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="detractor"
          name="Detractors"
          stroke={NPS_COLOR.Detractor}
          strokeWidth={1.5}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Deliveries over time — line
// ─────────────────────────────────────────────────────────────────────

export function DeliveriesOverTimeChart({
  data,
}: {
  data: Array<{ month: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#525252" }} />
        <YAxis tick={{ fontSize: 11, fill: "#525252" }} allowDecimals={false} />
        <Tooltip contentStyle={{ background: "white", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="count"
          name="Projects delivered"
          stroke={BRAND_NIGHT}
          strokeWidth={3}
          dot={{ fill: BRAND_YELLOW, stroke: BRAND_NIGHT, strokeWidth: 2, r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
