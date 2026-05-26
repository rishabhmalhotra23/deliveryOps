"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from "recharts";
import type { DeliveryProject, DeliveryFilterFacets } from "@/lib/delivery/loader";
import { formatPeopleList } from "@/lib/delivery/taxonomy";
import { ProjectDetailPanel, type ProjectPanelItem } from "@/app/_components/project-detail-panel";

interface DeliveryClientProps {
  projects: DeliveryProject[];
  facets: DeliveryFilterFacets;
}

const TABS = ["Kanban", "Table", "Q-on-Q"] as const;
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

// Distinct, semantically-appropriate colours for the stacked Q-on-Q bars.
const QOQ_COLORS = {
  delivered: "#34d399", // emerald  — shipped, value delivered
  in_flight: "#818cf8", // indigo   — active work in progress
  at_risk:   "#fb923c", // amber    — needs attention
  inactive:  "#6b7280", // slate    — cancelled / inactive
};

// ── Colour maps ───────────────────────────────────────────────────────────────

const HEALTH_CLASS: Record<string, string> = {
  "On Track":  "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Healthy:     "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Finished:    "bg-blue-500/12 text-blue-700 dark:text-blue-400 border-blue-500/25",
  Done:        "bg-blue-500/12 text-blue-700 dark:text-blue-400 border-blue-500/25",
  "At Risk":   "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  Blocked:     "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  Inactive:    "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

const STATUS_CLASS: Record<string, string> = {
  Live:          "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Delivered:     "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  "In Progress": "bg-blue-500/12 text-blue-700 dark:text-blue-400 border-blue-500/25",
  "On Hold":     "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  Inactive:      "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  Cancelled:     "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

const PLATFORM_CLASS: Record<string, string> = {
  V1: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  V2: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-400 border-indigo-500/25",
};

const FY_CLASS: Record<string, string> = {
  active:           "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
  inactive:         "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  "FY-2026":        "bg-[rgba(242,255,112,0.18)] text-[color:var(--brand-night)] dark:text-yellow-300 border-[rgba(242,255,112,0.4)]",
  "FY-2025":        "bg-purple-500/12 text-purple-700 dark:text-purple-400 border-purple-500/25",
  "FY-2024":        "bg-cyan-500/12 text-cyan-700 dark:text-cyan-400 border-cyan-500/25",
  "FY-2023":        "bg-orange-500/12 text-orange-700 dark:text-orange-400 border-orange-500/25",
  account_overview: "bg-teal-500/12 text-teal-700 dark:text-teal-400 border-teal-500/25",
  portfolio:        "bg-slate-500/12 text-slate-600 dark:text-slate-400 border-slate-500/25",
};

function chipClass(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
  return map[key] ?? "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm tracking-tight font-medium rounded-md transition-all ${
        active
          ? "bg-[rgba(242,255,112,0.12)] text-[color:var(--foreground)] border border-[rgba(242,255,112,0.25)]"
          : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
      }`}
    >
      {label}
    </button>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function DeliveryClient({ projects, facets }: DeliveryClientProps) {
  const [tab, setTab] = useState<Tab>("Kanban");
  const [customer, setCustomer] = useState("");
  const [ae, setAe] = useState("");
  const [fde, setFde] = useState("");
  const [partner, setPartner] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectPanelItem | null>(null);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (customer && p.customer_display_name !== customer) return false;
      if (ae && p.ae_owner !== ae) return false;
      if (partner && p.partner !== partner) return false;
      if (fiscalYear && p.fiscal_year !== fiscalYear) return false;
      // FDE filter: match against the canonical-cased name of any person
      // in the project's combined fde field (same form facets.fdes ships).
      if (fde) {
        if (!p.fde) return false;
        const names = p.fde.split(",").map((n) => formatPeopleList(n.trim()));
        if (!names.some((n) => n === fde)) return false;
      }
      if (s) {
        const hay = [
          p.name,
          p.customer_display_name,
          p.ae_owner ?? "",
          p.partner ?? "",
          p.health ?? "",
          p.status ?? "",
          p.fde ?? "",
          p.delivered_value ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [projects, customer, ae, fde, partner, fiscalYear, search]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="glass-card p-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-3 py-1.5 text-sm w-56"
        />
        <SelectFilter value={customer} setValue={setCustomer} label="Customer" options={facets.customers} />
        <SelectFilter value={ae} setValue={setAe} label="AE" options={facets.aes} />
        <SelectFilter value={fde} setValue={setFde} label="FDE" options={facets.fdes} />
        <SelectFilter value={partner} setValue={setPartner} label="Partner" options={facets.partners} />
        <SelectFilter value={fiscalYear} setValue={setFiscalYear} label="FY" options={facets.fiscal_years} />
        <div className="ml-auto data-label text-[color:var(--muted-foreground)] tabular-nums">
          {filtered.length} of {projects.length} projects
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 p-1 rounded-lg glass-card w-fit">
        {TABS.map((t) => (
          <TabButton key={t} label={t} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      {tab === "Kanban" && <Kanban projects={filtered} onSelect={setSelectedProject} />}
      {tab === "Table" && <Table projects={filtered} onSelect={setSelectedProject} />}
      {tab === "Q-on-Q" && <QonQ projects={filtered} />}

      {selectedProject ? (
        <ProjectDetailPanel project={selectedProject} onClose={() => setSelectedProject(null)} />
      ) : null}
    </div>
  );
}

function SelectFilter({
  value, setValue, label, options,
}: {
  value: string; setValue: (v: string) => void; label: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1.5 text-sm"
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{label}: {o}</option>)}
    </select>
  );
}

// ── Kanban ────────────────────────────────────────────────────────────────────

const STAGE_GROUPS = ["Active", "Pipeline", "Q1'26", "Q2'26", "Q3'26", "Q4'26", "On Hold", "Backlog"];
const FY_GROUPS = ["Q4'25", "Q3'25", "Q2'25", "Q1'25", "Q4'24", "Q3'24", "Q2'24", "Q1'24", "FY'23", "Churned", "Cancelled"];

function Kanban({ projects, onSelect }: { projects: DeliveryProject[]; onSelect: (p: DeliveryProject) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, DeliveryProject[]>();
    for (const p of projects) {
      const key = p.group_title ?? "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const all = [...STAGE_GROUPS, ...FY_GROUPS];
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = all.indexOf(a); const bi = all.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1; if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [projects]);

  if (projects.length === 0) {
    return <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">No projects match the current filters.</div>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 items-start">
      {groups.map(([group, items]) => (
        <div key={group} className="min-w-[280px] w-72 flex-shrink-0 glass-card p-3 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">{group}</div>
            <span className="data-label text-[color:var(--muted-foreground)] tabular-nums">{items.length}</span>
          </div>
          {items.map((p) => (
              <button
                key={p.monday_item_id}
                onClick={() => onSelect(p)}
                className="w-full text-left border border-[var(--glass-border)] rounded-md p-2.5 hover:border-[var(--brand-yellow)] transition-colors cursor-pointer"
              >
              <div
                className="text-sm font-medium text-[color:var(--foreground)] line-clamp-2 break-words"
                title={p.name}
              >
                {p.name}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mt-0.5">
                {p.customer_display_name}
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {p.fiscal_year ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(FY_CLASS, p.fiscal_year)}`}>
                    {p.fiscal_year === "active" ? "Active" : p.fiscal_year}
                  </span>
                ) : null}
                {p.health ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(HEALTH_CLASS, p.health)}`}>{p.health}</span>
                ) : null}
                {p.platform ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(PLATFORM_CLASS, p.platform)}`}>{p.platform}</span>
                ) : null}
              </div>
              {p.go_live_date ? (
                <div className="text-[10px] text-[color:var(--muted-foreground)] mt-1.5">Go-live: {p.go_live_date}</div>
              ) : null}
              {p.total_effort_days ? (
                <div className="text-[10px] text-[color:var(--muted-foreground)]">Effort: {p.total_effort_days}d</div>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

// Column descriptors — the single source of truth for headers, the per-row
// renderer, and how each column compares for sorting. Adding a new column
// means adding one entry here and Sortable + renderer come for free.
type SortDir = "asc" | "desc";
type SortKey =
  | "default"
  | "name"
  | "customer"
  | "fiscal_year"
  | "stage"
  | "health"
  | "status"
  | "phase"
  | "platform"
  | "fde"
  | "partner"
  | "complexity"
  | "effort"
  | "ttv"
  | "kickoff"
  | "golive"
  | "update";

// Default stage ordering: Active → Pipeline → Backlog → Finished → Cancelled.
// Monday's `group_title` is fuzzy across boards (Active Projects vs Active,
// Cancelled Projects vs Cancelled, etc.), so we coalesce variants. Anything
// unknown lands in the middle "Other" bucket so it doesn't crowd the top
// or the bottom.
const STAGE_BUCKET_ORDER: Record<string, number> = {
  Active: 0,
  "Active Projects": 0,
  "In Progress": 0,
  Pipeline: 1,
  "Upcoming Projects": 1,
  Backlog: 2,
  "On Hold": 3,
  Finished: 4,
  Completed: 4,
  "Completed Projects": 4,
  Delivered: 4,
  Live: 4,
  Done: 4,
  "Stalled Projects": 5,
  Stalled: 5,
  Cancelled: 6,
  "Cancelled Projects": 6,
  Churned: 6,
  Inactive: 6,
};

function stageBucket(p: DeliveryProject): number {
  // Group title is the primary signal; if Monday hasn't set one, fall back
  // to status (Live → Finished bucket, In Progress → Active bucket, …).
  const g = p.group_title ?? "";
  if (g in STAGE_BUCKET_ORDER) return STAGE_BUCKET_ORDER[g];
  // FY quarter labels like "Q2'26" — historical/upcoming buckets. Sort them
  // after every named bucket but before Cancelled.
  if (/^Q[1-4]'\d{2}$/.test(g) || /^FY['-]?\d{2,4}$/.test(g)) return 5;
  const s = p.status ?? "";
  if (s in STAGE_BUCKET_ORDER) return STAGE_BUCKET_ORDER[s];
  return 99;
}

function compareString(a: string | null | undefined, b: string | null | undefined): number {
  const av = (a ?? "").toLowerCase();
  const bv = (b ?? "").toLowerCase();
  if (av === bv) return 0;
  // Empties go last regardless of direction.
  if (!av) return 1;
  if (!bv) return -1;
  return av < bv ? -1 : 1;
}
function compareNumber(a: number | null | undefined, b: number | null | undefined): number {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === bv) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return av < bv ? -1 : 1;
}
function compareNumericText(a: string | null | undefined, b: string | null | undefined): number {
  const av = a != null ? Number(a) : null;
  const bv = b != null ? Number(b) : null;
  return compareNumber(
    av != null && Number.isFinite(av) ? av : null,
    bv != null && Number.isFinite(bv) ? bv : null,
  );
}
function compareDate(a: string | null | undefined, b: string | null | undefined): number {
  // ISO-style YYYY-MM-DD sorts lex-correctly, so we can lean on that and
  // get null-last for free.
  return compareString(a, b);
}

function sortProjects(
  projects: DeliveryProject[],
  key: SortKey,
  dir: SortDir
): DeliveryProject[] {
  const sign = dir === "asc" ? 1 : -1;
  const sorted = projects.slice();
  if (key === "default") {
    // Stage bucket asc, then go-live date desc inside each bucket so the most
    // recent / soonest project rises to the top of its group.
    sorted.sort((a, b) => {
      const sb = stageBucket(a) - stageBucket(b);
      if (sb !== 0) return sb;
      return compareDate(b.go_live_date, a.go_live_date);
    });
    return sorted;
  }
  const cmp: Record<Exclude<SortKey, "default">, (a: DeliveryProject, b: DeliveryProject) => number> = {
    name:        (a, b) => compareString(a.name, b.name),
    customer:    (a, b) => compareString(a.customer_display_name, b.customer_display_name),
    fiscal_year: (a, b) => compareString(a.fiscal_year, b.fiscal_year),
    stage:       (a, b) => stageBucket(a) - stageBucket(b) || compareString(a.group_title, b.group_title),
    health:      (a, b) => compareString(a.health, b.health),
    status:      (a, b) => compareString(a.status, b.status),
    phase:       (a, b) => compareString(a.phase, b.phase),
    platform:    (a, b) => compareString(a.platform, b.platform),
    fde:         (a, b) => compareString(a.fde, b.fde),
    partner:     (a, b) => compareString(a.partner, b.partner),
    complexity:  (a, b) => compareString(a.complexity, b.complexity),
    effort:      (a, b) => compareNumber(a.total_effort_days, b.total_effort_days),
    ttv:         (a, b) => compareNumericText(a.ttv_days_text, b.ttv_days_text),
    kickoff:     (a, b) => compareDate(a.kickoff_date, b.kickoff_date),
    golive:      (a, b) => compareDate(a.go_live_date, b.go_live_date),
    update:      (a, b) => compareString(a.latest_update, b.latest_update),
  };
  sorted.sort((a, b) => sign * cmp[key](a, b));
  return sorted;
}

interface ColDef {
  key: SortKey;
  label: string;
  align?: "left" | "right";
}
const TABLE_COLS: ColDef[] = [
  { key: "name", label: "Project" },
  { key: "customer", label: "Customer" },
  { key: "fiscal_year", label: "FY" },
  { key: "stage", label: "Stage" },
  { key: "health", label: "Health" },
  { key: "status", label: "Status" },
  { key: "phase", label: "Phase" },
  { key: "platform", label: "Platform" },
  { key: "fde", label: "FDE" },
  { key: "partner", label: "Partner" },
  { key: "complexity", label: "Complexity" },
  { key: "effort", label: "Effort", align: "right" },
  { key: "ttv", label: "TTV", align: "right" },
  { key: "kickoff", label: "Kickoff" },
  { key: "golive", label: "Go-live" },
  { key: "update", label: "Latest update" },
];

function Table({ projects, onSelect }: { projects: DeliveryProject[]; onSelect: (p: DeliveryProject) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(
    () => sortProjects(projects, sortKey, sortDir),
    [projects, sortKey, sortDir]
  );

  function clickHeader(k: SortKey) {
    if (sortKey === k) {
      // Toggle direction; a third click returns to the default ordering so
      // the user can always get "back to neutral" without a Reset button.
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey("default"); setSortDir("asc"); }
    } else {
      setSortKey(k);
      // String + date columns are nicer asc-first; numeric columns lead desc.
      const descFirst: SortKey[] = ["effort", "ttv", "golive", "kickoff"];
      setSortDir(descFirst.includes(k) ? "desc" : "asc");
    }
  }

  if (projects.length === 0) {
    return <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">No projects match the current filters.</div>;
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[color:var(--muted-foreground)] border-b border-[var(--glass-border)] bg-[var(--glass-bg)]/30">
        <span>
          Sorted by{" "}
          <span className="text-[color:var(--foreground)] font-medium">
            {sortKey === "default"
              ? "stage (Active → Pipeline → Backlog → Finished → Cancelled), then go-live desc"
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
                  <th
                    key={c.key}
                    className={`px-3 py-2 text-[10px] uppercase tracking-wider whitespace-nowrap text-${
                      c.align ?? "left"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => clickHeader(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-[color:var(--foreground)] ${
                        active ? "text-[color:var(--foreground)]" : ""
                      }`}
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {c.label}
                      {indicator ? (
                        <span className="text-[9px] opacity-80">{indicator}</span>
                      ) : (
                        <span className="text-[9px] opacity-30">↕</span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Cell sizing rules:
                - Long-text columns (Project, Customer, Phase, FDE, Latest update)
                  use `min-w-[…]` + `whitespace-normal` so they wrap inside a
                  comfortable column width.  No hard max-w / truncate so all
                  content stays readable.
                - Short / numeric / chip columns keep `whitespace-nowrap` so a
                  single line is preserved.
                Tooltips on the long cells give the full string on hover. */}
            {sorted.map((p) => (
              <tr
                key={p.monday_item_id}
                className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg)] transition-colors cursor-pointer align-top"
                onClick={() => onSelect(p)}
              >
                <td
                  className="px-3 py-2 font-medium text-[color:var(--foreground)] min-w-[180px] whitespace-normal break-words leading-snug"
                  title={p.name}
                >
                  {p.name.replace(new RegExp(`^${p.customer_display_name}\\s*[-—]\\s*`), "")}
                </td>
                <td
                  className="px-3 py-2 text-[color:var(--foreground)] min-w-[140px] whitespace-normal break-words leading-snug"
                  title={p.customer_display_name}
                >
                  {p.customer_display_name}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.fiscal_year ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(FY_CLASS, p.fiscal_year)}`}>
                      {p.fiscal_year === "active" ? "Active" : p.fiscal_year}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.group_title ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.health ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${chipClass(HEALTH_CLASS, p.health)}`}>{p.health}</span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.status ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${chipClass(STATUS_CLASS, p.status)}`}>{p.status}</span>
                  ) : "—"}
                </td>
                <td
                  className="px-3 py-2 text-[color:var(--muted-foreground)] min-w-[140px] whitespace-normal break-words leading-snug"
                  title={p.phase ?? undefined}
                >
                  {p.phase ?? "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.platform ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(PLATFORM_CLASS, p.platform)}`}>{p.platform}</span>
                  ) : "—"}
                </td>
                <td
                  className="px-3 py-2 text-[color:var(--muted-foreground)] min-w-[180px] whitespace-normal break-words leading-snug"
                  title={p.fde ?? undefined}
                >
                  {formatPeopleList(p.fde, { expand: true }) || "—"}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.partner ?? "—"}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.complexity ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                  {p.total_effort_days != null ? `${p.total_effort_days}d` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                  {p.ttv_days_text ? `${p.ttv_days_text}d` : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">{p.kickoff_date ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums font-medium text-[color:var(--foreground)] whitespace-nowrap">{p.go_live_date ?? "—"}</td>
                <td
                  className="px-3 py-2 text-[color:var(--muted-foreground)] min-w-[260px] max-w-[420px] whitespace-normal break-words italic text-[11px] leading-snug"
                  title={p.latest_update ?? undefined}
                >
                  {p.latest_update ?? "—"}
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

function quarterLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fy = d.getUTCMonth() < 1 // Kognitos FY starts February
    ? d.getUTCFullYear() - 1
    : d.getUTCFullYear();
  const calQ = Math.floor(d.getUTCMonth() / 3) + 1;
  // Map calendar quarter → FY quarter (FY starts ~Feb):
  // Q1 (Feb-Apr) → FY Q1, Q2 (May-Jul) → FY Q2, Q3 (Aug-Oct) → FY Q3, Q4 (Nov-Jan) → FY Q4
  const fyQ = d.getUTCMonth() >= 1
    ? Math.floor((d.getUTCMonth() - 1) / 3) + 1
    : 4;
  // Underlying key is "YYYY QN" so it stays lex-sortable + matches Monday
  // group names. Display labels are formatted with formatQuarterTick().
  return `${d.getUTCFullYear()} Q${calQ}`;
  void fy; void fyQ; // kept for future FY alignment
}

// Display formatter: "2023 Q2" → "Q2'23". Keeps chart axes compact and
// consistent with the analytics page (Q2'23 / Q3'24 etc.). Accepts unknown
// because Recharts' tickFormatter / labelFormatter pass ReactNode-typed
// values; we coerce to string and pattern-match.
function formatQuarterTick(q: unknown): string {
  const s = typeof q === "string" ? q : String(q ?? "");
  const m = s.match(/^(\d{4})\s+Q([1-4])$/);
  if (!m) return s;
  return `Q${m[2]}'${m[1].slice(2)}`;
}

import { isDelivered as txIsDelivered } from "@/lib/delivery/taxonomy";
function isDelivered(p: DeliveryProject): boolean {
  return txIsDelivered(p.status);
}

function QonQ({ projects }: { projects: DeliveryProject[] }) {
  const t = useChartTheme();

  const data = useMemo(() => {
    const counts = new Map<string, { quarter: string; delivered: number; in_flight: number; at_risk: number; inactive: number }>();
    for (const p of projects) {
      const q = quarterLabel(p.go_live_date) ?? quarterLabel(p.kickoff_date);
      if (!q) continue;
      const row = counts.get(q) ?? { quarter: q, delivered: 0, in_flight: 0, at_risk: 0, inactive: 0 };
      if (isDelivered(p)) row.delivered++;
      else if ((p.health ?? "").toLowerCase().includes("risk")) row.at_risk++;
      else if ((p.fiscal_year ?? "") === "inactive") row.inactive++;
      else row.in_flight++;
      counts.set(q, row);
    }
    return Array.from(counts.values()).sort((a, b) => a.quarter.localeCompare(b.quarter));
  }, [projects]);

  // Per-customer delivered counts (all time), top 15.
  const perCustomer = useMemo(() => {
    const counts = new Map<string, Record<string, number>>();
    for (const p of projects) {
      if (!isDelivered(p)) continue;
      const q = quarterLabel(p.go_live_date);
      if (!q) continue;
      const row = counts.get(p.customer_display_name) ?? {};
      row[q] = (row[q] ?? 0) + 1;
      counts.set(p.customer_display_name, row);
    }
    return Array.from(counts.entries())
      .map(([customer, byQ]) => ({
        customer,
        total: Object.values(byQ).reduce((a, b) => a + b, 0),
        byQ,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [projects]);

  const allQuarters = useMemo(() => {
    const s = new Set<string>();
    for (const p of projects) {
      const q = quarterLabel(p.go_live_date);
      if (q) s.add(q);
    }
    return Array.from(s).sort();
  }, [projects]);

  // On-time delivery rate per quarter.
  // "On-time" = go_live_date <= timeline_end (the planned end on Monday).
  // Projects without a planned end-date are excluded — we can't measure
  // on-timeness against a missing target.
  const onTimeData = useMemo(() => {
    const buckets = new Map<string, { onTime: number; late: number }>();
    for (const p of projects) {
      if (!isDelivered(p) || !p.go_live_date || !p.timeline_end) continue;
      const q = quarterLabel(p.go_live_date);
      if (!q) continue;
      const actual = new Date(p.go_live_date).getTime();
      const planned = new Date(p.timeline_end).getTime();
      if (Number.isNaN(actual) || Number.isNaN(planned)) continue;
      const row = buckets.get(q) ?? { onTime: 0, late: 0 };
      if (actual <= planned) row.onTime++;
      else row.late++;
      buckets.set(q, row);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([quarter, { onTime, late }]) => ({
        quarter,
        onTime,
        late,
        total: onTime + late,
        onTimePct: Math.round((onTime / (onTime + late)) * 100),
      }));
  }, [projects]);

  // Average TTV (kickoff → go-live, in days) per quarter.
  const avgTtvData = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const p of projects) {
      if (!isDelivered(p) || !p.kickoff_date || !p.go_live_date) continue;
      const q = quarterLabel(p.go_live_date);
      if (!q) continue;
      const start = new Date(p.kickoff_date).getTime();
      const end = new Date(p.go_live_date).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
      const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
      const arr = buckets.get(q) ?? [];
      arr.push(days);
      buckets.set(q, arr);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([quarter, days]) => ({
        quarter,
        avgTtv: Math.round(days.reduce((a, b) => a + b, 0) / days.length),
        count: days.length,
      }));
  }, [projects]);

  if (data.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">
        No projects with go-live or kickoff dates yet — Q-on-Q will populate once the sync runs.
        Historical FY boards (FY-2023 → FY-2026) have {projects.length} projects loaded.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Projects by quarter — stacked bar with distinct semantic colours */}
      <div className="glass-card p-5">
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Projects by calendar quarter</div>
        <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
          Delivered vs in-flight vs at risk (all FY boards)
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
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
                  inactive:  "Inactive / Cancelled",
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

      {/* Team performance — two charts side-by-side: predictability + speed */}
      {(onTimeData.length > 0 || avgTtvData.length > 0) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* On-time delivery rate */}
          {onTimeData.length > 0 ? (
            <div className="glass-card p-5">
              <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">On-time delivery rate</div>
              <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
                % of delivered projects that hit their planned go-live
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={onTimeData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
                  <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={formatQuarterTick} />
                  <YAxis
                    tick={{ fontSize: 11, fill: t.axis }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={t.tooltipStyle}
                    labelFormatter={formatQuarterTick}
                    formatter={(value, _name, item) => {
                      const r = item?.payload as { onTime: number; late: number; total: number } | undefined;
                      if (!r) return [`${value}%`, "On-time"];
                      return [`${value}% — ${r.onTime} of ${r.total} on time (${r.late} late)`, "On-time"];
                    }}
                  />
                  <Bar dataKey="onTimePct" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {/* Avg TTV */}
          {avgTtvData.length > 0 ? (
            <div className="glass-card p-5">
              <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Average TTV</div>
              <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
                Days from kickoff to go-live · per quarter (lower is better)
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={avgTtvData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
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
                      return [`${r.avgTtv}d · across ${r.count} project${r.count === 1 ? "" : "s"}`, "Avg TTV"];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="avgTtv"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#ttvGrad)"
                    dot={{ r: 3, fill: "#6366f1" }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Per-customer Q-on-Q table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="eyebrow text-[color:var(--muted-foreground)] mb-0.5">
            Delivered Q-on-Q · per customer (top 15 by volume)
          </div>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            Each cell = projects delivered/gone-live in that quarter. Pulls from FY-2023 through FY-2026.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">Customer</th>
                {allQuarters.map((q) => (
                  <th key={q} className="text-right px-3 py-2 text-[10px] uppercase tracking-wider tabular-nums whitespace-nowrap">{q}</th>
                ))}
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody>
              {perCustomer.map((row) => (
                <tr key={row.customer} className="border-t border-[var(--glass-border)]">
                  <td className="px-3 py-2 text-[color:var(--foreground)] whitespace-nowrap">{row.customer}</td>
                  {allQuarters.map((q) => (
                    <td key={q} className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                      {row.byQ[q] ? (
                        <span className="inline-block min-w-[20px] text-center text-[color:var(--foreground)] font-medium">
                          {row.byQ[q]}
                        </span>
                      ) : ""}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[color:var(--foreground)]">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Name rendering is centralised in lib/delivery/taxonomy.ts —
// formatPersonName / formatPeopleList apply consistent case and the
// PM suffix for non-FDE program managers.
