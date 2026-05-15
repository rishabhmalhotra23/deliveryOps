"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import type { WeeklyBundle, WeeklyProject } from "@/lib/reports/weekly-loader";

// ── Theme ────────────────────────────────────────────────────────────────────
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
      borderRadius: 10,
      padding: "8px 12px",
      fontSize: 12,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const HEALTH_PILL: Record<string, string> = {
  "On Track":  "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  "At Risk":   "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Off Track": "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Stuck":     "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  "Healthy":   "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
};
function healthPill(health: string | null) {
  if (!health) return null;
  const cls = HEALTH_PILL[health] ?? "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/25";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>
      {health}
    </span>
  );
}

// ── Notion Export ─────────────────────────────────────────────────────────────
function NotionExportButton({ bundle }: { bundle: WeeklyBundle }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "no-token">("idle");
  const hasToken = typeof window !== "undefined" && false; // will detect from /api/notion/status later

  async function handleExport() {
    setState("loading");
    try {
      const res = await fetch("/api/reports/weekly/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_label: bundle.week_label }),
      });
      if (res.status === 501) { setState("no-token"); return; }
      if (!res.ok) throw new Error(await res.text());
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank");
      setState("done");
    } catch {
      setState("no-token");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  if (state === "no-token") {
    return (
      <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
        Notion not connected. Add <code className="font-mono">NOTION_TOKEN</code> +{" "}
        <code className="font-mono">NOTION_REPORTS_PAGE_ID</code> to your env — see{" "}
        <a href="/docs/CREDENTIALS.md" className="underline">CREDENTIALS.md</a>.
      </div>
    );
  }

  return (
    <button
      onClick={handleExport}
      disabled={state === "loading"}
      className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 transition-colors"
    >
      <NotionIcon />
      {state === "loading" ? "Exporting…" : state === "done" ? "Opened in Notion ✓" : "Export to Notion"}
    </button>
  );
  void hasToken;
}

function NotionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect width="16" height="16" rx="3" fill="currentColor" fillOpacity="0.1" />
      <path d="M4 3.5h5.5L13 7v5.5H4V3.5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M9.5 3.5V7H13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent,
}: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="glass-card p-5 flex flex-col gap-1">
      <div className={`text-3xl font-bold tracking-tight ${accent ?? "text-[color:var(--foreground)]"}`}>
        {value}
      </div>
      <div className="text-sm font-medium text-[color:var(--foreground)]">{label}</div>
      {sub ? <div className="text-xs text-[color:var(--muted-foreground)]">{sub}</div> : null}
    </div>
  );
}

// ── Project row ───────────────────────────────────────────────────────────────
function ProjectRow({ p, showTtv, showDaysUntil }: { p: WeeklyProject; showTtv?: boolean; showDaysUntil?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--glass-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[color:var(--foreground)] truncate">{p.name}</div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
          {p.customer_display_name}
          {p.tam.length > 0 && (
            <span className="ml-2 opacity-60">· {p.tam.join(", ")}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {healthPill(p.health)}
        {showTtv && p.ttv_days !== null && (
          <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums">
            {p.ttv_days}d TTV
          </span>
        )}
        {showDaysUntil && p.days_until_live !== null && (
          <span className={`text-[11px] font-medium tabular-nums ${
            p.days_until_live <= 3
              ? "text-red-600 dark:text-red-400"
              : p.days_until_live <= 7
              ? "text-amber-600 dark:text-amber-400"
              : "text-[color:var(--muted-foreground)]"
          }`}>
            {p.days_until_live === 0 ? "today" : `in ${p.days_until_live}d`}
          </span>
        )}
        {p.go_live_date && (
          <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums">
            {fmtDate(p.go_live_date)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({ title, count, children, accent }: {
  title: string; count?: number; children: React.ReactNode; accent?: string;
}) {
  return (
    <section className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">{title}</div>
        {count !== undefined && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${accent ?? "bg-[var(--glass-border)] text-[color:var(--muted-foreground)]"}`}>
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function Empty({ label }: { label: string }) {
  return (
    <div className="text-xs text-[color:var(--muted-foreground)] italic py-2">{label}</div>
  );
}

// ── Workload chart ────────────────────────────────────────────────────────────
function WorkloadChart({ data, label }: { data: Array<{ person: string; active: number }>; label: string }) {
  const t = useChartTheme();
  const BAR_COLORS = [
    "#818cf8", "#6366f1", "#a78bfa", "#8b5cf6",
    "#34d399", "#10b981", "#60a5fa", "#3b82f6",
  ];
  if (data.length === 0) return <Empty label="No assigned projects" />;
  return (
    <>
      <div className="text-xs text-[color:var(--muted-foreground)] mb-3">{label}</div>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="person"
            tick={{ fontSize: 11, fill: t.axis }}
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <Tooltip contentStyle={t.tooltipStyle} formatter={(v) => [v, "Active projects"]} />
          <Bar dataKey="active" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

// ── Upcoming timeline ─────────────────────────────────────────────────────────
function UpcomingTimeline({ projects }: { projects: WeeklyProject[] }) {
  if (projects.length === 0) return <Empty label="No projects scheduled in the next 14 days." />;

  return (
    <div className="space-y-2">
      {projects.map((p) => {
        const pct = Math.max(0, Math.min(100, ((14 - (p.days_until_live ?? 14)) / 14) * 100));
        const urgent = (p.days_until_live ?? 99) <= 3;
        return (
          <div key={p.monday_item_id} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[color:var(--foreground)] truncate flex-1 min-w-0">
                <span className="font-medium">{p.customer_display_name}</span>
                <span className="text-[color:var(--muted-foreground)]"> · {p.name}</span>
              </div>
              <div className={`text-xs font-semibold ml-3 shrink-0 tabular-nums ${
                urgent ? "text-red-600 dark:text-red-400" : "text-[color:var(--muted-foreground)]"
              }`}>
                {p.days_until_live === 0 ? "Today" : `${fmtDate(p.go_live_date)}`}
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--glass-border)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${urgent ? "bg-red-500" : "bg-indigo-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── NPS badge ─────────────────────────────────────────────────────────────────
function NpsBadge({ nps }: { nps: WeeklyBundle["nps_this_quarter"] }) {
  if (!nps) return null;
  const score = nps.average;
  const color = score >= 50 ? "text-emerald-700 dark:text-emerald-400" : score >= 0 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
  return (
    <div className="glass-card p-5 flex items-center gap-4">
      <div className={`text-3xl font-bold tabular-nums tracking-tight ${color}`}>{score > 0 ? `+${score}` : score}</div>
      <div>
        <div className="text-sm font-medium text-[color:var(--foreground)]">NPS this quarter</div>
        <div className="text-xs text-[color:var(--muted-foreground)]">{nps.count} response{nps.count !== 1 ? "s" : ""} · {nps.quarter}</div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function WeeklyReportClient({ bundle }: { bundle: WeeklyBundle }) {
  const { totals } = bundle;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)] mb-1">
            Weekly Delivery Update
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[color:var(--foreground)]">
            {bundle.week_label}
          </h1>
          <p className="text-sm text-[color:var(--muted-foreground)] mt-1">
            Auto-generated from Monday.com · synced {timeAgo(bundle.last_sync)}
          </p>
        </div>
        <NotionExportButton bundle={bundle} />
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Shipped this week"
          value={totals.shipped_this_week}
          sub={totals.delivered_all_time > 0 ? `${totals.delivered_all_time} all time` : undefined}
          accent={totals.shipped_this_week > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
        />
        <StatCard
          label="In flight"
          value={totals.in_flight}
          sub="active projects"
        />
        <StatCard
          label="At risk"
          value={totals.at_risk}
          sub="need attention"
          accent={totals.at_risk > 0 ? "text-red-600 dark:text-red-400" : undefined}
        />
        <StatCard
          label="Go-live next 14d"
          value={totals.upcoming_14d}
          sub="scheduled"
          accent={totals.upcoming_14d > 0 ? "text-indigo-600 dark:text-indigo-400" : undefined}
        />
      </div>

      {/* Shipped this week */}
      <Section
        title="Shipped this week"
        count={totals.shipped_this_week}
        accent="bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
      >
        {bundle.shipped_this_week.length === 0 ? (
          <Empty label="No projects went live this week." />
        ) : (
          bundle.shipped_this_week.map((p) => (
            <ProjectRow key={p.monday_item_id} p={p} showTtv />
          ))
        )}
      </Section>

      {/* Upcoming go-lives */}
      <Section
        title="Upcoming go-lives — next 14 days"
        count={totals.upcoming_14d}
        accent="bg-indigo-500/12 text-indigo-700 dark:text-indigo-400"
      >
        <UpcomingTimeline projects={bundle.upcoming_14d} />
      </Section>

      {/* Team workload + At risk side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Team workload */}
        <Section title="Team workload — active projects">
          {bundle.workload_tam.length > 0 && (
            <WorkloadChart data={bundle.workload_tam} label="TAM / CSM" />
          )}
          {bundle.workload_dev.length > 0 && (
            <div className="mt-4">
              <WorkloadChart data={bundle.workload_dev} label="Engineering / SE" />
            </div>
          )}
          {bundle.workload_tam.length === 0 && bundle.workload_dev.length === 0 && (
            <Empty label="No team assignments found on active projects." />
          )}
        </Section>

        {/* At risk */}
        <Section
          title="At risk"
          count={totals.at_risk}
          accent={totals.at_risk > 0 ? "bg-red-500/12 text-red-700 dark:text-red-400" : undefined}
        >
          {bundle.at_risk.length === 0 ? (
            <div className="py-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <span className="text-lg">✓</span> All clear — no at-risk projects.
            </div>
          ) : (
            bundle.at_risk.map((p) => (
              <div key={p.monday_item_id} className="py-3 border-b border-[var(--glass-border)] last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[color:var(--foreground)] truncate">{p.name}</div>
                    <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">{p.customer_display_name}</div>
                  </div>
                  {healthPill(p.health)}
                </div>
                {p.latest_update && (
                  <div className="text-xs text-[color:var(--muted-foreground)] mt-1.5 line-clamp-2 italic">
                    {p.latest_update}
                  </div>
                )}
              </div>
            ))
          )}
        </Section>
      </div>

      {/* In-flight list + NPS */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="In flight" count={totals.in_flight}>
            {bundle.in_flight.length === 0 ? (
              <Empty label="No active projects." />
            ) : (
              <div className="max-h-96 overflow-y-auto -mx-1 px-1">
                {bundle.in_flight.map((p) => (
                  <ProjectRow key={p.monday_item_id} p={p} />
                ))}
              </div>
            )}
          </Section>
        </div>
        <div className="space-y-4">
          <NpsBadge nps={bundle.nps_this_quarter} />
          <div className="glass-card p-5">
            <div className="text-xs text-[color:var(--muted-foreground)] uppercase tracking-wider mb-3">Portfolio</div>
            <div className="space-y-2">
              {[
                { label: "Delivered all time", value: totals.delivered_all_time, color: "#34d399" },
                { label: "In flight", value: totals.in_flight, color: "#818cf8" },
                { label: "At risk", value: totals.at_risk, color: "#f87171" },
                { label: "Due next 14d", value: totals.upcoming_14d, color: "#818cf8" },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} />
                  <div className="text-xs text-[color:var(--muted-foreground)] flex-1">{row.label}</div>
                  <div className="text-xs font-semibold text-[color:var(--foreground)] tabular-nums">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-[11px] text-[color:var(--muted-foreground)] text-center pt-2">
        Generated by DeliveryOps · data from Monday.com · {new Date(bundle.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </div>
    </div>
  );
}
