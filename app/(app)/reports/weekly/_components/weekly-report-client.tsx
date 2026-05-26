"use client";

import { useState, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, ReferenceLine,
  ComposedChart, Line, Area,
} from "recharts";
import { useTheme } from "next-themes";
import Link from "next/link";
import type { WeeklyBundle, WeeklyProject, WorkloadEntry } from "@/lib/reports/weekly-loader";
import type { V2Migration } from "@/lib/reports/v2-migrations";
import {
  PHASE_GROUP_META, ACTIVE_WORK_PHASES,
  HEALTH_PILL_CLS, FLIGHT_GROUP_META,
  formatPersonName, formatPeopleList,
  type PhaseGroup,
} from "@/lib/delivery/taxonomy";
import { RangeSelector } from "./range-selector";

// ── Chart theme ───────────────────────────────────────────────────────────────
function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return {
    grid: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
    axis: dark ? "#71717a" : "#a1a1aa",
    tooltipStyle: {
      background: dark ? "#18181b" : "#ffffff",
      border: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)",
      borderRadius: 10, padding: "8px 12px", fontSize: 12,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function HealthPill({ health }: { health: string | null }) {
  if (!health) return null;
  const cls = HEALTH_PILL_CLS[health] ?? "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/25";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>{health}</span>;
}

// ── Export buttons ────────────────────────────────────────────────────────────
function ExportButtons({ bundle, reportRef }: { bundle: WeeklyBundle; reportRef: React.RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function downloadPng() {
    setState("loading");
    const strip = document.getElementById("export-strip");
    if (strip) strip.style.display = "none";
    try {
      const el = reportRef.current;
      if (!el) throw new Error("No report element");
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: window.getComputedStyle(document.documentElement).getPropertyValue("--background").trim() || "#ffffff",
        style: { maxWidth: "none" },
        filter: (node) => {
          if (node instanceof HTMLImageElement && !node.src.startsWith(window.location.origin)) return false;
          return true;
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `deliveryops-${bundle.range.preset}-${bundle.range.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.png`;
      a.click();
      setState("done");
    } catch (err) {
      console.error("[export-png]", err);
      setState("error");
    } finally {
      if (strip) strip.style.display = "";
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const label = state === "loading" ? "Rendering…" : state === "done" ? "Saved ✓" : state === "error" ? "Failed — try Print" : "Download PNG";
  return (
    <div id="export-strip" className="flex items-center gap-2">
      <button onClick={downloadPng} disabled={state === "loading"}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 transition-colors">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {label}
      </button>
      <button onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print / PDF
      </button>
    </div>
  );
}

// ── Phase breakdown ───────────────────────────────────────────────────────────
function PhaseBreakdown({ by_phase }: { by_phase: WeeklyBundle["by_phase"] }) {
  const visible = ACTIVE_WORK_PHASES.concat("support" as PhaseGroup)
    .map((key) => ({ key, ...PHASE_GROUP_META[key], count: by_phase[key] }))
    .filter((x) => x.count > 0);
  const total = visible.reduce((s, x) => s + x.count, 0);
  if (total === 0) return null;
  return (
    <div className="glass-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)] mb-3">
        Active projects by phase (In progress group only)
      </div>
      <div className="flex flex-wrap gap-4">
        {visible.map(({ key, label, color, count }) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={key} className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
              <div>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>{count}</span>
                <span className="text-xs text-[color:var(--muted-foreground)] ml-1.5">{label}</span>
                <span className="text-[10px] text-[color:var(--muted-foreground)] ml-1 opacity-60">({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex rounded-full overflow-hidden h-1.5 mt-3 gap-px">
        {visible.map(({ key, color, count }) => {
          const w = total > 0 ? (count / total) * 100 : 0;
          return w > 0 ? <div key={key} style={{ width: `${w}%`, background: color }} /> : null;
        })}
      </div>
    </div>
  );
}

// ── Delivery trend chart ──────────────────────────────────────────────────────
function DeliveryTrendChart({ trend }: { trend: WeeklyBundle["delivery_trend"] }) {
  const t = useChartTheme();
  const data = trend.data;
  const avg = data.length > 0 ? data.reduce((s, d) => s + d.count, 0) / data.length : 0;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey="bucket_label" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [v, "Go-lives"]} />
        {avg > 0 && (
          <ReferenceLine y={avg} stroke="#6366f1" strokeDasharray="4 3" strokeOpacity={0.6}
            label={{ value: `avg ${avg.toFixed(1)}`, position: "insideTopRight", fontSize: 10, fill: "#6366f1" }} />
        )}
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.count >= avg && d.count > 0 ? "#34d399" : "#818cf8"} fillOpacity={d.count === 0 ? 0.2 : 0.9} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="glass-card p-4 flex flex-col gap-0.5">
      <div className={`text-2xl font-bold tracking-tight tabular-nums ${accent ?? "text-[color:var(--foreground)]"}`}>{value}</div>
      <div className="text-xs font-semibold text-[color:var(--foreground)]">{label}</div>
      {sub && <div className="text-[11px] text-[color:var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

// ── Project row ───────────────────────────────────────────────────────────────
// Single FDE roster — Monday still splits delivery + engineering across
// two columns but the report shows them together so the same person
// doesn't appear twice on a row.
function ProjectRow({ p, showTtv, tag }: { p: WeeklyProject; showTtv?: boolean; tag?: React.ReactNode }) {
  const fdeText = formatPeopleList(p.fde);
  const fdeLine = fdeText ? `FDE: ${fdeText}` : null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--glass-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[color:var(--foreground)] truncate">{p.name}</div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5 truncate">
          {p.customer_display_name}
          {p.phase && <span className="ml-2 opacity-55">[{p.phase}]</span>}
          {fdeLine && <span className="ml-2 opacity-60">· {fdeLine}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <HealthPill health={p.health} />
        {tag}
        {showTtv && p.ttv_days !== null && (
          <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums">{p.ttv_days}d TTV</span>
        )}
        {p.go_live_date && (
          <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums">{fmtDate(p.go_live_date)}</span>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, count, children, countCls }: {
  title: string; count?: number; children: React.ReactNode; countCls?: string;
}) {
  return (
    <section className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">{title}</div>
        {count !== undefined && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${countCls ?? "bg-[var(--glass-border)] text-[color:var(--muted-foreground)]"}`}>{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-[color:var(--muted-foreground)] italic py-2">{text}</div>;
}

// ── Workload chart ─────────────────────────────────────────────────────────────
const WORKLOAD_COLORS = ["#818cf8","#6366f1","#a78bfa","#8b5cf6","#34d399","#10b981","#60a5fa","#3b82f6"];

// Truncate a pre-formatted display name so the YAxis stays sane.
// Names already pass through formatPersonName upstream — this is just an
// overflow guard for unusually long ones.
function truncate(s: string, max = 20): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Workload chart — flat horizontal bar per person, one colour each.
// (Reverted from the stacked-by-health attempt 2026-05-25 — tried to add
// too much information and the result felt cluttered. The richer
// per-person fields stay on WorkloadEntry though, so callers can render
// detail panels off them if needed later.)
//
// `height` is opt-in from the caller so two side-by-side charts can
// match each other regardless of their row counts (otherwise the shorter
// one feels lopsided next to the taller one).
function WorkloadChart({
  data,
  label,
  height,
}: {
  data: WorkloadEntry[];
  label: string;
  height?: number;
}) {
  const t = useChartTheme();
  if (data.length === 0) return <Empty text="No assignments found." />;
  const display = data.map((d) => ({
    ...d,
    fullName: formatPersonName(d.person),
    displayName: truncate(formatPersonName(d.person)),
  }));
  const computedHeight = height ?? Math.max(120, data.length * 32);
  return (
    <>
      <div className="text-[11px] text-[color:var(--muted-foreground)] mb-2">{label}</div>
      <ResponsiveContainer width="100%" height={computedHeight}>
        <BarChart data={display} layout="vertical" margin={{ top: 0, right: 24, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 11, fill: t.axis }}
            tickLine={false}
            axisLine={false}
            width={130}
            interval={0}
          />
          <Tooltip
            contentStyle={t.tooltipStyle}
            labelFormatter={(_, payload) => (payload?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? ""}
            formatter={(v) => [v, "Active projects"]}
          />
          <Bar dataKey="active" radius={[0, 3, 3, 0]}>
            {display.map((_, i) => <Cell key={i} fill={WORKLOAD_COLORS[i % WORKLOAD_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

// ── Flight tags ────────────────────────────────────────────────────────────────
function FlightTags({ fd }: { fd: WeeklyBundle["flight_breakdown"] }) {
  const items = (Object.keys(fd) as Array<keyof WeeklyBundle["flight_breakdown"]>)
    .map((key) => ({ key, count: fd[key], ...FLIGHT_GROUP_META[key] }))
    .filter((x) => x.count > 0);
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {items.map((x) => (
        <span key={x.key} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${x.pillCls}`}>
          {x.count} {x.label}
        </span>
      ))}
    </div>
  );
}

// ── QoQ history chart ────────────────────────────────────────────────────────
// Bars = deliveries per Kognitos FY quarter; line = avg TTV (right axis).
// Tells the "how much have we shipped and are we getting faster" story.
function QoQChart({ data }: { data: WeeklyBundle["qoq_history"] }) {
  const t = useChartTheme();
  if (data.length < 2) return null;

  // Highlight the current (last) quarter differently
  const currentLabel = data[data.length - 1]?.label ?? "";

  return (
    <div className="glass-card p-5">
      <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
        Quarterly delivery — all time
      </div>
      <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5 mb-4">
        Projects delivered per Kognitos FY quarter · bars = deliveries · line = avg days to ship
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: t.axis }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: "#6366f1" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}d`}
          />
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(value, name) => {
              if (name === "avg_ttv_days") return [`${value}d avg TTV`, "Avg days to ship"];
              return [value, "Delivered"];
            }}
          />
          <Bar yAxisId="left" dataKey="delivered" radius={[3, 3, 0, 0]} name="delivered">
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.label === currentLabel ? "#f59e0b" : "#34d399"}
                fillOpacity={entry.label === currentLabel ? 0.85 : 0.9}
              />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avg_ttv_days"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: "#6366f1" }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            name="avg_ttv_days"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-[color:var(--muted-foreground)]">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" /> Delivered</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-indigo-500 inline-block rounded" /> Avg TTV (right axis)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Current quarter</span>
      </div>
    </div>
  );
}

// ── Pipeline funnel ───────────────────────────────────────────────────────────
// Shows the shape of work in the system: how many at each stage right now,
// plus the cumulative delivered total for scale context.
function PipelineFunnel({ funnel }: { funnel: WeeklyBundle["pipeline_funnel"] }) {
  const stages = [
    { label: "Discovery",   count: funnel.discovery, color: "#818cf8", desc: "Pre-Kickoff / M1" },
    { label: "Development", count: funnel.dev,        color: "#6366f1", desc: "M2" },
    { label: "UAT",         count: funnel.uat,        color: "#f59e0b", desc: "M3–M5 testing" },
    { label: "Waiting",     count: funnel.waiting,    color: "#f97316", desc: "Customer sign-off pending" },
  ].filter((s) => s.count > 0);

  const activeTotal = stages.reduce((s, x) => s + x.count, 0);
  const grandTotal  = funnel.delivered_all_time + activeTotal;

  return (
    <div className="glass-card p-5">
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">Work in the system — right now</div>
          <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">Active pipeline by phase · all-time delivered for scale</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{funnel.delivered_all_time}</div>
          <div className="text-[10px] text-[color:var(--muted-foreground)]">delivered all time</div>
        </div>
      </div>

      {/* Visual funnel bars */}
      <div className="space-y-2.5">
        {stages.map(({ label, count, color, desc }) => {
          const pct = grandTotal > 0 ? (count / grandTotal) * 100 : 0;
          return (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="text-xs font-medium text-[color:var(--foreground)]">{label}</span>
                  <span className="text-[10px] text-[color:var(--muted-foreground)]">{desc}</span>
                </div>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>{count}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--glass-border)] overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color, opacity: 0.85 }} />
              </div>
            </div>
          );
        })}

        {/* Delivered bar at bottom — the "done" layer */}
        <div className="mt-1 pt-2 border-t border-[var(--glass-border)]">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0 bg-emerald-500" />
              <span className="text-xs font-medium text-[color:var(--foreground)]">Live in production</span>
              <span className="text-[10px] text-[color:var(--muted-foreground)]">{funnel.unique_customers_served} customers</span>
            </div>
            <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{funnel.delivered_all_time}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--glass-border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${grandTotal > 0 ? (funnel.delivered_all_time / grandTotal) * 100 : 0}%`, opacity: 0.85 }}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-[var(--glass-border)] flex items-center justify-between text-[11px] text-[color:var(--muted-foreground)]">
        <span>{activeTotal} projects in flight</span>
        <span>{grandTotal} total projects tracked</span>
      </div>
    </div>
  );
}

// ── In-production stats ────────────────────────────────────────────────────────
function InProdSection({ in_prod, nps }: { in_prod: WeeklyBundle["in_prod"]; nps: WeeklyBundle["nps_this_quarter"] }) {
  return (
    <div className="glass-card p-5">
      <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight mb-4">In production</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{in_prod.projects}</div>
          <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">Total live</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-[color:var(--foreground)] tabular-nums">{in_prod.customers}</div>
          <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">Customers live</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{in_prod.this_quarter}</div>
          <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">This qtr</div>
          <div className="text-[10px] text-[color:var(--muted-foreground)] opacity-60">{in_prod.this_q_label}</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-[color:var(--foreground)] tabular-nums">{in_prod.last_quarter}</div>
          <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">Last qtr</div>
          <div className="text-[10px] text-[color:var(--muted-foreground)] opacity-60">{in_prod.last_q_label}</div>
        </div>
      </div>
      {nps && (
        <div className="border-t border-[var(--glass-border)] pt-4 flex items-center gap-4">
          <div className={`text-2xl font-bold tabular-nums ${nps.average >= 50 ? "text-emerald-600 dark:text-emerald-400" : nps.average >= 0 ? "text-amber-600 dark:text-amber-400" : "text-red-500"}`}>
            {nps.average > 0 ? `+${nps.average}` : nps.average}
          </div>
          <div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">NPS · {nps.quarter}</div>
            <div className="text-xs text-[color:var(--muted-foreground)]">{nps.count} responses this quarter</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function WeeklyReportClient({ bundle }: { bundle: WeeklyBundle }) {
  const { totals, range } = bundle;
  const reportRef = useRef<HTMLDivElement>(null);

  const isMonthly = bundle.delivery_trend.bucket_kind === "monthly";
  const trendTitle = isMonthly ? "Deliveries — month on month" : "Deliveries — week on week";
  const trendSub   = isMonthly
    ? "Go-lives per month · last 12 months · green = at or above average"
    : "Go-lives per week · last 12 weeks · green = at or above average";

  const fromIso = range.start.toISOString().slice(0, 10);
  const toIso   = range.end.toISOString().slice(0, 10);

  return (
    <div ref={reportRef} className="space-y-5 print:space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">{range.cadenceLabel} Delivery Update</div>
          <h1 className="text-3xl font-bold tracking-tight text-[color:var(--foreground)]">{range.label}</h1>
          <RangeSelector activePreset={range.preset} from={fromIso} to={toIso} />
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2">
          <ExportButtons bundle={bundle} reportRef={reportRef} />
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Monday.com · synced {timeAgo(bundle.last_sync)}
          </p>
        </div>
      </div>

      {/* Row 1 — hero stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={`Shipped in this ${range.preset === "custom" ? "range" : range.preset}`}
          value={totals.shipped_in_range}
          sub={`${totals.delivered_all_time} all time`}
          accent={totals.shipped_in_range > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
        />
        <StatCard label="In progress" value={totals.in_flight_active}
          sub={`${totals.in_flight_total} total on board`} />
        <StatCard label="In UAT" value={totals.in_uat} sub="ready for sign-off"
          accent={totals.in_uat > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
        <StatCard label="At risk" value={totals.at_risk} sub="need attention"
          accent={totals.at_risk > 0 ? "text-red-600 dark:text-red-400" : undefined} />
      </div>

      {/* Row 2 — phase breakdown */}
      <PhaseBreakdown by_phase={bundle.by_phase} />

      {/* Row 3 — Trend */}
      <div className="glass-card p-5">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">{trendTitle}</div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5 mb-4">{trendSub}</div>
        <DeliveryTrendChart trend={bundle.delivery_trend} />
      </div>

      {/* Row 4 — Shipped (only if any) + UAT */}
      {totals.shipped_in_range > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={`Shipped in this ${range.preset === "custom" ? "range" : range.preset}`} count={totals.shipped_in_range}
            countCls="bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
            {bundle.shipped_in_range.map((p) => <ProjectRow key={p.monday_item_id} p={p} showTtv />)}
          </Section>
          <Section title="In UAT — ready for sign-off" count={totals.in_uat}
            countCls="bg-amber-500/12 text-amber-700 dark:text-amber-400">
            {bundle.in_uat.length === 0
              ? <Empty text="No projects currently in UAT." />
              : bundle.in_uat.map((p) => (
                  <ProjectRow key={p.monday_item_id} p={p}
                    tag={<span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">UAT</span>} />
                ))}
          </Section>
        </div>
      ) : (
        bundle.in_uat.length > 0 && (
          <Section title="In UAT — ready for sign-off" count={totals.in_uat}
            countCls="bg-amber-500/12 text-amber-700 dark:text-amber-400">
            {bundle.in_uat.map((p) => (
              <ProjectRow key={p.monday_item_id} p={p}
                tag={<span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">UAT</span>} />
            ))}
          </Section>
        )
      )}

      {/* Row 5 — At risk + In flight */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="At risk" count={totals.at_risk}
          countCls={totals.at_risk > 0 ? "bg-red-500/12 text-red-700 dark:text-red-400" : undefined}>
          {bundle.at_risk.length === 0
            ? <div className="flex items-center gap-2 py-2 text-sm text-emerald-700 dark:text-emerald-400"><span>✓</span> All clear.</div>
            : bundle.at_risk.map((p) => (
                <div key={p.monday_item_id} className="py-2.5 border-b border-[var(--glass-border)] last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[color:var(--foreground)] truncate">{p.name}</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">{p.customer_display_name}</div>
                    </div>
                    <HealthPill health={p.health} />
                  </div>
                  {p.latest_update && (
                    <div className="text-xs text-[color:var(--muted-foreground)] mt-1.5 line-clamp-2 italic">{p.latest_update}</div>
                  )}
                </div>
              ))}
        </Section>

        <div className="lg:col-span-2">
          <Section title="In flight" count={totals.in_flight_total}>
            <FlightTags fd={bundle.flight_breakdown} />
            {bundle.all_active_board.length === 0
              ? <Empty text="No active projects." />
              : <div className="max-h-80 overflow-y-auto">
                  {bundle.all_active_board.map((p) => (
                    <ProjectRow key={p.monday_item_id} p={p}
                      tag={
                        p.group_title && p.group_title !== "Active"
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[color:var(--muted-foreground)] font-medium">{p.group_title}</span>
                          : undefined
                      } />
                  ))}
                </div>}
          </Section>
        </div>
      </div>

      {/* Row 5.5 — Migrations to v2.  Surfaces in-flight v1→v2 migrations
          per customer with delivery + engineering owners and the latest
          status update.  Source today: hand-curated list at
          lib/reports/v2-migrations.ts. */}
      {bundle.v2_migrations.length > 0 ? (
        <V2MigrationsSection migrations={bundle.v2_migrations} />
      ) : null}

      {/* Row 6 — Historical narrative: QoQ chart + pipeline funnel */}
      <div className="grid gap-4 lg:grid-cols-2">
        <QoQChart data={bundle.qoq_history} />
        <PipelineFunnel funnel={bundle.pipeline_funnel} />
      </div>

      {/* Row 7 — In production */}
      <InProdSection in_prod={bundle.in_prod} nps={bundle.nps_this_quarter} />

      {/* Row 8 — FDE workload.  Single roster — Monday splits assignments
          across two columns (delivery + engineering) but for the weekly
          report the whole delivery team is one list. */}
      <div className="glass-card p-5">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight mb-4">
          FDE workload — active projects (In progress group)
        </div>
        {(() => {
          const rows = Math.max(bundle.workload_fde.length, 3);
          const height = Math.max(140, rows * 36);
          return <WorkloadChart data={bundle.workload_fde} label="FDE" height={height} />;
        })()}
      </div>

      <div className="text-[11px] text-[color:var(--muted-foreground)] text-center pt-1">
        Generated by DeliveryOps · {new Date(bundle.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </div>
    </div>
  );
}

// ── V2 Migrations Section ─────────────────────────────────────────────
// Lightweight: customer + process pill(s), with optional Delivery /
// Engineering owner chips inline. No freeform status text — that
// decays between weekly cadences. Once the Monday column is live the
// list refreshes automatically per sync; until then the curated list
// at lib/reports/v2-migrations.ts is the source.

function V2MigrationsSection({ migrations }: { migrations: V2Migration[] }) {
  const ownerCls = (tone: "emerald" | "indigo") =>
    tone === "emerald"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400";

  return (
    <Section
      title="Migrations to v2"
      count={migrations.length}
      countCls="bg-indigo-500/12 text-indigo-700 dark:text-indigo-400"
    >
      <p className="text-xs text-[color:var(--muted-foreground)] mb-3">
        Customer processes currently being migrated from Kognitos v1 to v2.
        Source today: curated list — moves to a Monday column once the
        &ldquo;v2 Migration Status&rdquo; field is added to the Customers board
        and rows refresh on the daily sync.
      </p>
      <ul className="divide-y divide-[var(--glass-border)]">
        {migrations.map((m) => {
          const owners = [...(m.delivery_team ?? []), ...(m.engineering_team ?? [])];
          return (
            <li key={m.customer_key} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Link
                  href={`/customers/${m.customer_key}`}
                  className="text-sm font-semibold text-[color:var(--foreground)] hover:underline"
                >
                  {m.customer_display_name ?? m.customer_key}
                </Link>
                {m.processes.length === 0 ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] uppercase tracking-wider">
                    All processes
                  </span>
                ) : (
                  m.processes.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-medium uppercase tracking-wider"
                    >
                      {p}
                    </span>
                  ))
                )}
              </div>
              {owners.length > 0 ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(m.delivery_team ?? []).map((p) => (
                    <span
                      key={`d-${p}`}
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${ownerCls("emerald")}`}
                      title="Delivery team"
                    >
                      {p}
                    </span>
                  ))}
                  {(m.engineering_team ?? []).map((p) => (
                    <span
                      key={`e-${p}`}
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${ownerCls("indigo")}`}
                      title="Engineering"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
