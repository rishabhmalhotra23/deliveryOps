"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from "recharts";
import type { ProcessesOverview, ProcessRow } from "@/lib/processes/loader";
import { ACTIVE_LANES, ACTIVE_LANE_LABELS, viewForLifecycle } from "@/lib/processes/loader";
import { ProcessDrawer } from "@/app/_components/process-drawer";
import { DeliveryStatsRow } from "./_components/delivery-stats-row";

interface DeliveryClientProps {
  overview: ProcessesOverview;
}

const TABS = ["Active Work", "Delivered", "Archive", "All", "Q-on-Q"] as const;
type Tab = (typeof TABS)[number];

// ── Chart theme ───────────────────────────────────────────────────────────────
function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return {
    grid:   dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
    axis:   dark ? "#71717a" : "#9ca3af",
    tooltipStyle: {
      background: dark ? "#1c1c24" : "#ffffff",
      border:     dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #e5e7eb",
      borderRadius: 10,
      padding: "8px 12px",
      fontSize: 12,
      color: dark ? "#f0f0f0" : "#18181b",
      boxShadow: dark ? "0 8px 32px rgba(0,0,0,0.6)" : "0 8px 32px rgba(0,0,0,0.12)",
    },
  };
}

const QOQ_COLORS = {
  delivered: "#34d399",
  in_flight: "#818cf8",
  at_risk:   "#fb923c",
  inactive:  "#6b7280",
};

function label(s: string | null): string {
  return s ? s.replace(/_/g, " ") : "—";
}

function formatQuarterTick(q: unknown): string {
  const s = typeof q === "string" ? q : String(q ?? "");
  const m = s.match(/^(\d{4})\s+Q([1-4])$/);
  if (!m) return s;
  return `Q${m[2]}'${m[1].slice(2)}`;
}

function TabButton({ label: l, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm tracking-tight font-medium rounded-md transition-all ${
        active
          ? "bg-[rgba(242,255,112,0.12)] text-[color:var(--foreground)] border border-[rgba(242,255,112,0.25)]"
          : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
      }`}
    >
      {l}
    </button>
  );
}

function Flags({ row }: { row: ProcessRow }) {
  return (
    <>
      {row.needs_classification ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-700 border-amber-500/25">
          needs classification
        </span>
      ) : null}
      {row.needs_attention ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-700 border-red-500/25">
          needs attention
        </span>
      ) : null}
      {row.open_suggestion_count > 0 ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[rgba(242,255,112,0.18)] border-[rgba(242,255,112,0.4)]">
          {row.open_suggestion_count} suggestion{row.open_suggestion_count > 1 ? "s" : ""}
        </span>
      ) : null}
    </>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function DeliveryClient({ overview }: DeliveryClientProps) {
  const [tab, setTab] = useState<Tab>("Active Work");
  const [customer, setCustomer] = useState("");
  const [fde, setFde] = useState("");
  const [partner, setPartner] = useState("");
  const [search, setSearch] = useState("");
  const [selectedProcess, setSelectedProcess] = useState<ProcessRow | null>(null);

  // Filters apply to the table views (Delivered / Archive / All), not to the
  // Active board — the board's four lanes are already a small, fixed set and
  // don't need a second filter layer on top.
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return overview.all.filter((p) => {
      if (customer && p.customer_display_name !== customer) return false;
      if (fde && p.fde_owner !== fde) return false;
      if (partner && p.partner !== partner) return false;
      if (s) {
        const hay = [p.process_name, p.customer_display_name, p.fde_owner ?? "", p.partner ?? "", p.blockers ?? "", p.notes ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [overview.all, customer, fde, partner, search]);

  const delivered = useMemo(() => filtered.filter((p) => viewForLifecycle(p.lifecycle) === "delivered"), [filtered]);
  const archive = useMemo(() => filtered.filter((p) => viewForLifecycle(p.lifecycle) === "archive"), [filtered]);

  return (
    <div className="space-y-4">
      <DeliveryStatsRow counts={overview.counts} onSelectTab={setTab} />

      {/* Filter bar — applies to Delivered / Archive / All */}
      <div className="glass-card p-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search processes…"
          className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-3 py-1.5 text-sm w-56"
        />
        <SelectFilter value={customer} setValue={setCustomer} label="Customer" options={overview.facets.customers} />
        <SelectFilter value={fde} setValue={setFde} label="FDE" options={overview.facets.fdeOwners} />
        <SelectFilter value={partner} setValue={setPartner} label="Partner" options={overview.facets.partners} />
        {tab !== "Active Work" && tab !== "Q-on-Q" ? (
          <div className="ml-auto data-label text-[color:var(--muted-foreground)] tabular-nums">
            {filtered.length} of {overview.all.length} processes
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1 p-1 rounded-lg glass-card w-fit flex-wrap">
        {TABS.map((t) => (
          <TabButton key={t} label={t} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      {tab === "Active Work" && <Board lanes={overview.lanes} onSelect={setSelectedProcess} />}
      {tab === "Delivered" && <ProcessTable rows={delivered} onSelect={setSelectedProcess} />}
      {tab === "Archive" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] px-2 py-1 rounded-full border border-[var(--glass-border)]">
              Cancelled · {overview.counts.archiveBreakdown.cancelled}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-full border border-[var(--glass-border)]">
              Churned · {overview.counts.archiveBreakdown.churned}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-full border border-[var(--glass-border)]">
              Retired · {overview.counts.archiveBreakdown.retired}
            </span>
          </div>
          <ProcessTable rows={archive} onSelect={setSelectedProcess} />
        </div>
      )}
      {tab === "All" && <ProcessTable rows={filtered} onSelect={setSelectedProcess} />}
      {tab === "Q-on-Q" && <QonQ overview={overview} />}

      {selectedProcess ? (
        <ProcessDrawer
          process={selectedProcess}
          customerDisplayName={selectedProcess.customer_display_name}
          onClose={() => setSelectedProcess(null)}
        />
      ) : null}
    </div>
  );
}

function SelectFilter({
  value, setValue, label: l, options,
}: {
  value: string; setValue: (v: string) => void; label: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1.5 text-sm"
    >
      <option value="">{l}: all</option>
      {options.map((o) => <option key={o} value={o}>{l}: {o}</option>)}
    </select>
  );
}

// ── Active work board ────────────────────────────────────────────────────────
// Four fixed lanes, read-only cards — all editing happens in the drawer. No
// drag-and-drop: a lane change is a lifecycle edit in the drawer, which asks
// for whatever that lane requires. Per docs/mockups/ia-step-1.5.html panel 4.

const HEALTH_BORDER: Record<string, string> = {
  on_track: "border-t-emerald-400",
  at_risk: "border-t-amber-400",
  off_track: "border-t-red-400",
};

function Board({
  lanes,
  onSelect,
}: {
  lanes: ProcessesOverview["lanes"];
  onSelect: (p: ProcessRow) => void;
}) {
  const total = Object.values(lanes).reduce((n, l) => n + l.length, 0);

  if (total === 0) {
    return (
      <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">
        No active processes yet — run the Monday-archive importer to populate this board.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
      {ACTIVE_LANES.map((lane) => (
        <div key={lane}>
          <div className="flex items-baseline justify-between px-1 pb-2">
            <span className="text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">
              {ACTIVE_LANE_LABELS[lane]}
            </span>
            <span className="text-[11.5px] text-[color:var(--muted-foreground)] tabular-nums">
              {lanes[lane].length}
            </span>
          </div>
          <div className="space-y-2">
            {lanes[lane].map((card) => {
              const staleDays = Math.round((Date.now() - new Date(card.updated_at).getTime()) / 86_400_000);
              return (
                <button
                  key={card.id}
                  onClick={() => onSelect(card)}
                  className={`w-full text-left glass-card-hover p-3 border-t-2 ${
                    HEALTH_BORDER[card.health ?? ""] ?? "border-t-[var(--glass-border)]"
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    {card.customer_display_name}
                  </div>
                  <div className="text-sm font-medium text-[color:var(--foreground)] mt-0.5 line-clamp-2">
                    {card.process_name}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Flags row={card} />
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        staleDays > 60
                          ? "bg-red-500/10 text-red-700 border-red-500/25"
                          : staleDays > 30
                            ? "bg-amber-500/10 text-amber-700 border-amber-500/25"
                            : "border-[var(--glass-border)] text-[color:var(--muted-foreground)]"
                      }`}
                    >
                      {staleDays}d
                    </span>
                  </div>
                  <div className="text-[11px] text-[color:var(--muted-foreground)] mt-1.5">
                    {card.fde_owner ?? "unassigned"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Process table — Delivered / Archive / All ──────────────────────────────────

type SortKey = "default" | "name" | "customer" | "lifecycle" | "health" | "phase" | "platform" | "fde" | "partner" | "complexity" | "effort" | "ttv" | "kickoff" | "golive" | "updated";
type SortDir = "asc" | "desc";

function compareString(a: string | null | undefined, b: string | null | undefined): number {
  const av = (a ?? "").toLowerCase();
  const bv = (b ?? "").toLowerCase();
  if (av === bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av < bv ? -1 : 1;
}
function compareNumber(a: number | null | undefined, b: number | null | undefined): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

interface ColDef {
  key: SortKey;
  label: string;
  align?: "left" | "right";
}
const TABLE_COLS: ColDef[] = [
  { key: "name", label: "Process" },
  { key: "customer", label: "Customer" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "phase", label: "Phase" },
  { key: "health", label: "Health" },
  { key: "platform", label: "Platform" },
  { key: "fde", label: "FDE" },
  { key: "partner", label: "Partner" },
  { key: "complexity", label: "Complexity" },
  { key: "effort", label: "Effort", align: "right" },
  { key: "ttv", label: "TTV", align: "right" },
  { key: "kickoff", label: "Kickoff" },
  { key: "golive", label: "Go-live" },
  { key: "updated", label: "Last touched" },
];

function sortRows(rows: ProcessRow[], key: SortKey, dir: SortDir): ProcessRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const sorted = rows.slice();
  if (key === "default") {
    sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return sorted;
  }
  const cmp: Record<Exclude<SortKey, "default">, (a: ProcessRow, b: ProcessRow) => number> = {
    name:      (a, b) => compareString(a.process_name, b.process_name),
    customer:  (a, b) => compareString(a.customer_display_name, b.customer_display_name),
    lifecycle: (a, b) => compareString(a.lifecycle, b.lifecycle),
    health:    (a, b) => compareString(a.health, b.health),
    phase:     (a, b) => compareString(a.phase, b.phase),
    platform:  (a, b) => compareString(a.platform, b.platform),
    fde:       (a, b) => compareString(a.fde_owner, b.fde_owner),
    partner:   (a, b) => compareString(a.partner, b.partner),
    complexity:(a, b) => compareString(a.complexity, b.complexity),
    effort:    (a, b) => compareNumber(a.total_effort_hours, b.total_effort_hours),
    ttv:       (a, b) => compareNumber(a.ttv_days, b.ttv_days),
    kickoff:   (a, b) => compareString(a.kickoff_date, b.kickoff_date),
    golive:    (a, b) => compareString(a.go_live_date, b.go_live_date),
    updated:   (a, b) => compareString(a.updated_at, b.updated_at),
  };
  sorted.sort((a, b) => sign * cmp[key](a, b));
  return sorted;
}

function ProcessTable({ rows, onSelect }: { rows: ProcessRow[]; onSelect: (p: ProcessRow) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  function clickHeader(k: SortKey) {
    if (sortKey === k) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey("default"); setSortDir("asc"); }
    } else {
      setSortKey(k);
      setSortDir(["effort", "ttv", "golive", "kickoff", "updated"].includes(k) ? "desc" : "asc");
    }
  }

  if (rows.length === 0) {
    return <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">No processes match the current filters.</div>;
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[color:var(--muted-foreground)] border-b border-[var(--glass-border)] bg-[var(--glass-bg)]/30">
        <span>
          Sorted by{" "}
          <span className="text-[color:var(--foreground)] font-medium">
            {sortKey === "default"
              ? "last touched (most recent first)"
              : `${TABLE_COLS.find((c) => c.key === sortKey)?.label} ${sortDir === "asc" ? "↑" : "↓"}`}
          </span>
        </span>
        {sortKey !== "default" ? (
          <button
            type="button"
            onClick={() => { setSortKey("default"); setSortDir("asc"); }}
            className="ml-auto underline hover:text-[color:var(--foreground)]"
          >
            Reset to default
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
            <tr>
              {TABLE_COLS.map((c) => {
                const active = sortKey === c.key;
                const indicator = active ? (sortDir === "asc" ? "↑" : "↓") : "";
                return (
                  <th key={c.key} className={`px-3 py-2 text-[10px] uppercase tracking-wider whitespace-nowrap text-${c.align ?? "left"}`}>
                    <button
                      type="button"
                      onClick={() => clickHeader(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-[color:var(--foreground)] ${active ? "text-[color:var(--foreground)]" : ""}`}
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {c.label}
                      {indicator ? <span className="text-[9px] opacity-80">{indicator}</span> : <span className="text-[9px] opacity-30">↕</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.id}
                className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg)] transition-colors cursor-pointer align-top"
                onClick={() => onSelect(p)}
              >
                <td className="px-3 py-2 font-medium text-[color:var(--foreground)] min-w-[200px] whitespace-normal break-words leading-snug" title={p.process_name}>
                  {p.process_name}
                  <div className="flex flex-wrap gap-1 mt-1"><Flags row={p} /></div>
                </td>
                <td className="px-3 py-2 text-[color:var(--foreground)] min-w-[140px] whitespace-normal break-words leading-snug">
                  {p.customer_display_name}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)]">{label(p.lifecycle)}</span>
                </td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] min-w-[120px] whitespace-normal break-words leading-snug">
                  {label(p.phase)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.health ? (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        p.health === "on_track"
                          ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/25"
                          : p.health === "at_risk"
                            ? "bg-amber-500/10 text-amber-700 border-amber-500/25"
                            : "bg-red-500/10 text-red-700 border-red-500/25"
                      }`}
                    >
                      {label(p.health)}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{p.platform.toUpperCase()}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.fde_owner ?? "—"}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.partner ?? "—"}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.complexity ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                  {p.total_effort_hours != null ? `${p.total_effort_hours}h` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                  {p.ttv_days != null ? `${p.ttv_days}d` : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">{p.kickoff_date ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums font-medium text-[color:var(--foreground)] whitespace-nowrap">{p.go_live_date ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                  {new Date(p.updated_at).toLocaleDateString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Q-on-Q ────────────────────────────────────────────────────────────────────
// Rebuilt on `processes` data. The old "on-time delivery rate" chart is
// dropped — it compared go_live_date against Monday's timeline_end, which
// 0021 deliberately didn't carry forward (no target/planned date exists on
// processes today).

function QonQ({ overview }: { overview: ProcessesOverview }) {
  const t = useChartTheme();
  const { byQuarter, avgTtvByQuarter, byCustomer } = overview.qonq;
  const allQuarters = useMemo(
    () => Array.from(new Set(byCustomer.flatMap((c) => Object.keys(c.byQ)))).sort(),
    [byCustomer]
  );

  if (byQuarter.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">
        No processes with go-live or kickoff dates yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-5">
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Processes by calendar quarter</div>
        <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
          Delivered vs in-flight vs at risk (all processes)
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={byQuarter} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={formatQuarterTick} />
            <YAxis tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={t.tooltipStyle} labelFormatter={formatQuarterTick} />
            <Legend
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              formatter={(v: string) => {
                const labels: Record<string, string> = {
                  delivered: "Delivered / Live",
                  in_flight: "In flight",
                  at_risk:   "At risk",
                  inactive:  "Archive",
                };
                return labels[v] ?? v;
              }}
            />
            <Bar dataKey="delivered" stackId="a" fill={QOQ_COLORS.delivered} name="delivered" />
            <Bar dataKey="in_flight" stackId="a" fill={QOQ_COLORS.in_flight} name="in_flight" />
            <Bar dataKey="at_risk"   stackId="a" fill={QOQ_COLORS.at_risk}   name="at_risk" />
            <Bar dataKey="inactive"  stackId="a" fill={QOQ_COLORS.inactive}  name="inactive" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {avgTtvByQuarter.length > 0 ? (
        <div className="glass-card p-5">
          <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Average TTV</div>
          <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
            Days from kickoff to go-live · per quarter (lower is better) — from the generated ttv_days column
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={avgTtvByQuarter} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ttvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
              <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={formatQuarterTick} />
              <YAxis tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}d`} />
              <Tooltip
                contentStyle={t.tooltipStyle}
                labelFormatter={formatQuarterTick}
                formatter={(value, _name, item) => {
                  const r = item?.payload as { avgTtv: number; count: number } | undefined;
                  if (!r) return [`${value}d`, "Avg TTV"];
                  return [`${r.avgTtv}d · across ${r.count} process${r.count === 1 ? "" : "es"}`, "Avg TTV"];
                }}
              />
              <Area type="monotone" dataKey="avgTtv" stroke="#6366f1" strokeWidth={2} fill="url(#ttvGrad)" dot={{ r: 3, fill: "#6366f1" }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {byCustomer.length > 0 ? (
        <div className="glass-card overflow-hidden">
          <div className="p-4 border-b border-[var(--glass-border)]">
            <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Delivered per customer</div>
            <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">Top 15, by quarter</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Customer</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Total</th>
                  {allQuarters.map((q) => (
                    <th key={q} className="px-3 py-2 text-[10px] uppercase tracking-wider text-right whitespace-nowrap">
                      {formatQuarterTick(q)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCustomer.map((row) => (
                  <tr key={row.customer} className="border-t border-[var(--glass-border)]">
                    <td className="px-3 py-2 font-medium text-[color:var(--foreground)]">{row.customer}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{row.total}</td>
                    {allQuarters.map((q) => (
                      <td key={q} className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                        {row.byQ[q] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
