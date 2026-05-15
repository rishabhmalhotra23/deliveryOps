"use client";

import { useState, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { useTheme } from "next-themes";
import type { WeeklyBundle, WeeklyProject, PhaseGroup } from "@/lib/reports/weekly-loader";

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

const HEALTH_PILL: Record<string, string> = {
  "On Track": "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Healthy:    "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  "At Risk":  "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Off Track":"bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  Stuck:      "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
};
function HealthPill({ health }: { health: string | null }) {
  if (!health) return null;
  const cls = HEALTH_PILL[health] ?? "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/25";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>{health}</span>;
}

// ── PNG export using html-to-image (handles Tailwind CSS vars + SVG charts) ───
function ExportButtons({ bundle, reportRef }: { bundle: WeeklyBundle; reportRef: React.RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function downloadPng() {
    setState("loading");
    // Hide the export strip so it's not in the image
    const strip = document.getElementById("export-strip");
    if (strip) strip.style.display = "none";
    try {
      const el = reportRef.current;
      if (!el) throw new Error("No report element");
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: window.getComputedStyle(document.documentElement)
          .getPropertyValue("--background")
          .trim() || "#ffffff",
        style: {
          // Ensure the captured width matches the render width
          maxWidth: "none",
        },
        filter: (node) => {
          // Skip external images that might cause CORS errors (logos)
          if (node instanceof HTMLImageElement && !node.src.startsWith(window.location.origin)) {
            return false;
          }
          return true;
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `deliveryops-weekly-${bundle.week_label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.png`;
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

  const label =
    state === "loading" ? "Rendering…" :
    state === "done"    ? "Saved ✓" :
    state === "error"   ? "Failed — try print (Cmd+P)" :
    "Download PNG";

  return (
    <div id="export-strip" className="flex items-center gap-2">
      <button
        onClick={downloadPng}
        disabled={state === "loading"}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        {label}
      </button>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
        </svg>
        Print / PDF
      </button>
    </div>
  );
}

// ── Phase breakdown row ───────────────────────────────────────────────────────
// Only show phases that actually have projects — hide zero-count ones.
// Labels match real Kognitos Monday phase naming.
const PHASE_META: Array<{ key: PhaseGroup; label: string; color: string }> = [
  { key: "discovery",  label: "Pre-Kickoff / M1", color: "#818cf8" },
  { key: "dev",        label: "M2 Development",   color: "#6366f1" },
  { key: "uat",        label: "M3–M5 UAT",         color: "#f59e0b" },
  { key: "waiting",    label: "Waiting",            color: "#f97316" },
  { key: "support",    label: "Support",            color: "#71717a" },
];

function PhaseBreakdown({ by_phase }: { by_phase: WeeklyBundle["by_phase"] }) {
  const visible = PHASE_META.filter(({ key }) => by_phase[key] > 0);
  const total = visible.reduce((s, { key }) => s + by_phase[key], 0);
  if (total === 0) return null;
  return (
    <div className="glass-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)] mb-3">
        Active projects by phase (Active group only)
      </div>
      <div className="flex flex-wrap gap-4">
        {visible.map(({ key, label, color }) => {
          const count = by_phase[key];
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
      {/* Stacked bar */}
      <div className="flex rounded-full overflow-hidden h-1.5 mt-3 gap-px">
        {visible.map(({ key, color }) => {
          const w = total > 0 ? (by_phase[key] / total) * 100 : 0;
          return w > 0 ? <div key={key} style={{ width: `${w}%`, background: color }} /> : null;
        })}
      </div>
    </div>
  );
}

// ── WoW trend chart ───────────────────────────────────────────────────────────
function WowChart({ data }: { data: WeeklyBundle["wow_trend"] }) {
  const t = useChartTheme();
  const avg = data.length > 0 ? data.reduce((s, d) => s + d.count, 0) / data.length : 0;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [v, "Go-lives"]} />
        {avg > 0 && (
          <ReferenceLine y={avg} stroke="#6366f1" strokeDasharray="4 3" strokeOpacity={0.6}
            label={{ value: `avg ${avg.toFixed(1)}`, position: "insideTopRight", fontSize: 10, fill: "#6366f1" }}
          />
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
function ProjectRow({ p, showTtv, tag }: { p: WeeklyProject; showTtv?: boolean; tag?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--glass-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[color:var(--foreground)] truncate">{p.name}</div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5 truncate">
          {p.customer_display_name}
          {p.phase && <span className="ml-2 opacity-55">[{p.phase}]</span>}
          {p.tam.length > 0 && <span className="ml-2 opacity-50">· {p.tam[0]}</span>}
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
function Section({ title, count, children, countCls, sub }: {
  title: string; count?: number; children: React.ReactNode; countCls?: string; sub?: string;
}) {
  return (
    <section className="glass-card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">{title}</div>
        {count !== undefined && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${countCls ?? "bg-[var(--glass-border)] text-[color:var(--muted-foreground)]"}`}>
            {count}
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-[color:var(--muted-foreground)] mb-3">{sub}</div>}
      {!sub && <div className="mb-3" />}
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-[color:var(--muted-foreground)] italic py-2">{text}</div>;
}

// ── Workload chart ─────────────────────────────────────────────────────────────
const WORKLOAD_COLORS = ["#818cf8","#6366f1","#a78bfa","#8b5cf6","#34d399","#10b981","#60a5fa","#3b82f6"];
function WorkloadChart({ data, label }: { data: Array<{ person: string; active: number }>; label: string }) {
  const t = useChartTheme();
  if (data.length === 0) return <Empty text="No assignments found." />;
  return (
    <>
      <div className="text-[11px] text-[color:var(--muted-foreground)] mb-2">{label}</div>
      <ResponsiveContainer width="100%" height={Math.max(90, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="person" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} width={95} />
          <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [v, "Active projects"]} />
          <Bar dataKey="active" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => <Cell key={i} fill={WORKLOAD_COLORS[i % WORKLOAD_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

// ── In-flight breakdown tags ──────────────────────────────────────────────────
function FlightTags({ fd }: { fd: WeeklyBundle["flight_breakdown"] }) {
  const items = [
    { label: "In progress", count: fd.in_progress, cls: "text-indigo-700 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
    { label: "Pipeline",    count: fd.pipeline,    cls: "text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/20" },
    { label: "On Hold",     count: fd.on_hold,     cls: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { label: "Backlog",     count: fd.backlog,     cls: "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
  ].filter((x) => x.count > 0);
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {items.map((x) => (
        <span key={x.label} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${x.cls}`}>
          {x.count} {x.label}
        </span>
      ))}
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
  const { totals } = bundle;
  const reportRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={reportRef} className="space-y-5 print:space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)] mb-1">Weekly Delivery Update</div>
          <h1 className="text-3xl font-bold tracking-tight text-[color:var(--foreground)]">{bundle.week_label}</h1>
          <p className="text-sm text-[color:var(--muted-foreground)] mt-1">
            Monday.com · synced {timeAgo(bundle.last_sync)}
          </p>
        </div>
        <ExportButtons bundle={bundle} reportRef={reportRef} />
      </div>

      {/* Row 1 — hero stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Shipped last 7 days"
          value={totals.shipped_last_week}
          sub={`${totals.delivered_all_time} all time`}
          accent={totals.shipped_last_week > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
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

      {/* Row 3 — WoW trend */}
      <div className="glass-card p-5">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">Deliveries — week on week</div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5 mb-4">Go-lives per week · last 10 weeks · green = at or above average</div>
        <WowChart data={bundle.wow_trend} />
      </div>

      {/* Row 4 — Shipped (ONLY shown if there are results) + UAT side by side */}
      {totals.shipped_last_week > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Shipped last 7 days" count={totals.shipped_last_week}
            countCls="bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
            {bundle.shipped_last_week.map((p) => <ProjectRow key={p.monday_item_id} p={p} showTtv />)}
          </Section>
          <Section title="In UAT — ready for sign-off" count={totals.in_uat}
            countCls="bg-amber-500/12 text-amber-700 dark:text-amber-400">
            {bundle.in_uat.length === 0
              ? <Empty text="No projects currently in UAT." />
              : bundle.in_uat.map((p) => (
                  <ProjectRow key={p.monday_item_id} p={p}
                    tag={<span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">UAT</span>}
                  />
                ))}
          </Section>
        </div>
      ) : (
        /* When nothing shipped: show UAT full-width */
        bundle.in_uat.length > 0 && (
          <Section title="In UAT — ready for sign-off" count={totals.in_uat}
            countCls="bg-amber-500/12 text-amber-700 dark:text-amber-400">
            {bundle.in_uat.map((p) => (
              <ProjectRow key={p.monday_item_id} p={p}
                tag={<span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">UAT</span>}
              />
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
          <Section
            title="In flight"
            count={totals.in_flight_total}
            sub={undefined}
          >
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
                      }
                    />
                  ))}
                </div>}
          </Section>
        </div>
      </div>

      {/* Row 6 — In production */}
      <InProdSection in_prod={bundle.in_prod} nps={bundle.nps_this_quarter} />

      {/* Row 7 — Team workload (bottom) */}
      <div className="glass-card p-5">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight mb-4">Team workload — active projects (In progress group)</div>
        <div className="grid gap-6 lg:grid-cols-2">
          <WorkloadChart data={bundle.workload_tam} label="TAM / CSM" />
          <WorkloadChart data={bundle.workload_dev} label="Engineering / SE" />
        </div>
      </div>

      <div className="text-[11px] text-[color:var(--muted-foreground)] text-center pt-1">
        Generated by DeliveryOps · {new Date(bundle.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </div>
    </div>
  );
}
