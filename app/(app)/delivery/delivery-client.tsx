"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@kognitos/lattice";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Legend } from "recharts";
import type { DeliveryProject, DeliveryFilterFacets } from "@/lib/delivery/loader";
import { ProjectDetailPanel, type ProjectPanelItem } from "@/app/_components/project-detail-panel";

interface DeliveryClientProps {
  projects: DeliveryProject[];
  facets: DeliveryFilterFacets;
}

const TABS = ["Kanban", "Table", "Q-on-Q"] as const;
type Tab = (typeof TABS)[number];

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
      if (s) {
        const hay = [
          p.name,
          p.customer_display_name,
          p.ae_owner ?? "",
          p.partner ?? "",
          p.health ?? "",
          p.status ?? "",
          p.tam ?? "",
          p.dev ?? "",
          p.delivered_value ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [projects, customer, ae, partner, fiscalYear, search]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="glass-card p-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-3 py-1.5 text-sm w-56"
        />
        <SelectFilter value={customer} setValue={setCustomer} label="Customer" options={facets.customers} />
        <SelectFilter value={ae} setValue={setAe} label="AE" options={facets.aes} />
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
      className="rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
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
              <div className="text-sm font-medium text-[color:var(--foreground)] truncate">{p.name}</div>
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

function Table({ projects, onSelect }: { projects: DeliveryProject[]; onSelect: (p: DeliveryProject) => void }) {
  if (projects.length === 0) {
    return <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">No projects match the current filters.</div>;
  }
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
            <tr>
              {["Project", "Customer", "FY", "Stage", "Health", "Status", "Phase", "Platform", "TAM", "Dev", "Partner", "Complexity", "Effort", "TTV", "Kickoff", "Go-live", "Latest update"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr
                key={p.monday_item_id}
                className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg)] transition-colors cursor-pointer"
                onClick={() => onSelect(p)}
              >
                <td className="px-3 py-2 font-medium text-[color:var(--foreground)] whitespace-nowrap max-w-[200px] truncate">
                  {p.name.replace(new RegExp(`^${p.customer_display_name}\\s*[-—]\\s*`), "")}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[color:var(--foreground)]">{p.customer_display_name}</td>
                <td className="px-3 py-2">
                  {p.fiscal_year ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(FY_CLASS, p.fiscal_year)}`}>
                      {p.fiscal_year === "active" ? "Active" : p.fiscal_year}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.group_title ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.health ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${chipClass(HEALTH_CLASS, p.health)}`}>{p.health}</span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.status ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${chipClass(STATUS_CLASS, p.status)}`}>{p.status}</span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap max-w-[140px] truncate">{p.phase ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.platform ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chipClass(PLATFORM_CLASS, p.platform)}`}>{p.platform}</span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap max-w-[120px] truncate">{shortName(p.tam)}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap max-w-[120px] truncate">{shortName(p.dev)}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.partner ?? "—"}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)]">{p.complexity ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                  {p.total_effort_days != null ? `${p.total_effort_days}d` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                  {p.ttv_days_text ? `${p.ttv_days_text}d` : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">{p.kickoff_date ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums font-medium text-[color:var(--foreground)] whitespace-nowrap">{p.go_live_date ?? "—"}</td>
                <td className="px-3 py-2 text-[color:var(--muted-foreground)] max-w-[200px] truncate italic text-[11px]">
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
  // Use calendar quarter notation for simplicity — matches Monday group names
  return `${d.getUTCFullYear()} Q${calQ}`;
  void fy; void fyQ; // kept for future FY alignment
}

function isDelivered(p: DeliveryProject): boolean {
  const s = (p.status ?? "").toLowerCase();
  return s === "live" || s === "delivered";
}

function QonQ({ projects }: { projects: DeliveryProject[] }) {
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

  // Effort chart: total person-days delivered per quarter.
  const effortData = useMemo(() => {
    const efforts = new Map<string, number>();
    for (const p of projects) {
      if (!isDelivered(p) || !p.total_effort_days) continue;
      const q = quarterLabel(p.go_live_date);
      if (!q) continue;
      efforts.set(q, (efforts.get(q) ?? 0) + p.total_effort_days);
    }
    return Array.from(efforts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([quarter, effort]) => ({ quarter, effort }));
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
      {/* Projects by quarter */}
      <div className="glass-card p-5">
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Projects by calendar quarter</div>
        <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
          Delivered vs in-flight vs at risk (all FY boards)
        </div>
        <ChartContainer
          config={{
            delivered: { label: "Delivered / Live", color: "var(--chart-1)" },
            in_flight: { label: "In flight",        color: "var(--chart-2)" },
            at_risk:   { label: "At risk",           color: "var(--chart-3)" },
            inactive:  { label: "Inactive / Cancelled", color: "var(--chart-4)" },
          }}
        >
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="quarter" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="delivered" stackId="a" fill="var(--color-delivered)" />
            <Bar dataKey="in_flight" stackId="a" fill="var(--color-in_flight)" />
            <Bar dataKey="at_risk"   stackId="a" fill="var(--color-at_risk)" />
            <Bar dataKey="inactive"  stackId="a" fill="var(--color-inactive)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </div>

      {/* Effort by quarter */}
      {effortData.length > 0 ? (
        <div className="glass-card p-5">
          <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">Total effort delivered (person-days)</div>
          <div className="text-sm font-semibold text-[color:var(--foreground)] mb-4 tracking-tight">
            Only delivered/live projects with Total Effort set on Monday
          </div>
          <ChartContainer config={{ effort: { label: "Person-days", color: "var(--chart-5)" } }}>
            <BarChart data={effortData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="quarter" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="effort" fill="var(--color-effort)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
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

function shortName(s: string | null | undefined): string {
  if (!s) return "—";
  const raw = s.includes("@") ? s.split("@")[0].replace(/[._]/g, " ") : s;
  const parts = raw.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : raw;
}
