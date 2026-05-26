"use client";

import Link from "next/link";
import { useState } from "react";

import { DrillDownPanel } from "@/app/_components/drilldown-panel";
import { formatMoney } from "@/app/_components/brand";
import { ProjectDetailPanel, type ProjectPanelItem } from "@/app/_components/project-detail-panel";
import type {
  ActiveProjectRow,
  ArrBreakdownRow,
  NpsResponseRow,
  OpenOpportunityRow,
} from "@/lib/dashboard/stats-drilldown";

type Drill = "arr" | "active" | "nps" | "pipeline" | null;

const COLOR = {
  arr: "#818cf8",
  active: "#34d399",
  nps_high: "#34d399",
  nps_mid:  "#fbbf24",
  nps_low:  "#f43f5e",
  pipeline: "#fb923c",
};

export function AnalyticsKpiRow({
  totals,
  arrRows,
  activeProjects,
  npsResponses,
  oppsRows,
}: {
  totals: {
    customers: number;
    total_arr: number;
    projects_total: number;
    projects_in_progress: number;
    projects_delivered: number;
    nps_average: number | null;
    nps_responses: number;
    open_opportunities: number;
    open_cases: number;
  };
  arrRows: ArrBreakdownRow[];
  activeProjects: ActiveProjectRow[];
  npsResponses: NpsResponseRow[];
  oppsRows: OpenOpportunityRow[];
}) {
  const [drill, setDrill] = useState<Drill>(null);
  const [project, setProject] = useState<ProjectPanelItem | null>(null);

  const npsColor =
    totals.nps_average == null
      ? COLOR.nps_mid
      : totals.nps_average >= 8
        ? COLOR.nps_high
        : totals.nps_average >= 6
          ? COLOR.nps_mid
          : COLOR.nps_low;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi
          label="Total ARR"
          value={formatMoney(totals.total_arr)}
          sub={`${totals.customers} customers`}
          color={COLOR.arr}
          featured
          onClick={() => setDrill("arr")}
        />
        <Kpi
          label="Active projects"
          value={String(totals.projects_in_progress)}
          sub={`${totals.projects_total} total · ${totals.projects_delivered} delivered`}
          color={COLOR.active}
          onClick={() => setDrill("active")}
        />
        <Kpi
          label="Average NPS"
          value={totals.nps_average != null ? totals.nps_average.toFixed(1) : "—"}
          sub={`${totals.nps_responses} responses`}
          color={npsColor}
          onClick={() => setDrill("nps")}
        />
        <Kpi
          label="Open pipeline"
          value={String(totals.open_opportunities)}
          sub={`${totals.open_cases} open cases`}
          color={COLOR.pipeline}
          onClick={() => setDrill("pipeline")}
        />
      </div>

      {drill === "arr" ? (
        <DrillDownPanel
          title="Total ARR"
          subtitle={
            <>
              <span className="text-[color:var(--foreground)] font-semibold">{formatMoney(totals.total_arr)}</span>{" "}
              across {arrRows.length} active customers · sorted by ARR desc
            </>
          }
          onClose={() => setDrill(null)}
          footer="Past-state customers (Churned / Dropped / Past) are excluded from the active-book total."
        >
          <ArrList rows={arrRows} />
        </DrillDownPanel>
      ) : null}

      {drill === "active" ? (
        <DrillDownPanel
          title="Active projects"
          subtitle={`${activeProjects.length} project${activeProjects.length === 1 ? "" : "s"} currently in flight (status = In Progress)`}
          onClose={() => setDrill(null)}
        >
          <ActiveProjectsList projects={activeProjects} onSelect={(p) => setProject(p)} />
        </DrillDownPanel>
      ) : null}

      {drill === "nps" ? (
        <DrillDownPanel
          title="NPS responses"
          subtitle={
            <>
              {npsResponses.length} response{npsResponses.length === 1 ? "" : "s"} ·{" "}
              {totals.nps_average != null ? (
                <>
                  average{" "}
                  <span className="text-[color:var(--foreground)] font-semibold">
                    {totals.nps_average.toFixed(1)}
                  </span>
                </>
              ) : (
                "average not available"
              )}
            </>
          }
          onClose={() => setDrill(null)}
          footer="Sorted newest-first by quarter."
        >
          <NpsList rows={npsResponses} />
        </DrillDownPanel>
      ) : null}

      {drill === "pipeline" ? (
        <DrillDownPanel
          title="Open pipeline"
          subtitle={
            <>
              {oppsRows.length} open ·{" "}
              <span className="text-[color:var(--foreground)] font-semibold">
                {formatMoney(oppsRows.reduce((s, o) => s + (o.amount ?? 0), 0))}
              </span>{" "}
              total
            </>
          }
          onClose={() => setDrill(null)}
        >
          <PipelineList rows={oppsRows} />
        </DrillDownPanel>
      ) : null}

      {project ? (
        <ProjectDetailPanel project={project} onClose={() => setProject(null)} />
      ) : null}
    </>
  );
}

// ─── KPI button ────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  color,
  featured,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  featured?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl p-5 flex flex-col justify-between min-h-[110px] text-left w-full transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-lg ${
        featured ? "lg:min-h-[130px]" : ""
      }`}
      style={{
        background: featured
          ? `color-mix(in srgb, ${color} 14%, transparent)`
          : "rgba(255, 255, 255, 0.07)",
        border: `1px solid color-mix(in srgb, ${color} ${featured ? "30" : "18"}%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-[color:var(--muted-foreground)] uppercase tracking-wider">
          {label}
        </div>
        <span aria-hidden="true" className="text-[10px] text-[color:var(--muted-foreground)]">↗</span>
      </div>
      <div>
        <div
          className="font-bold tabular-nums leading-none"
          style={{ fontSize: featured ? "2.5rem" : "2rem", color }}
        >
          {value}
        </div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-1.5">{sub}</div>
      </div>
    </button>
  );
}

// ─── Lists ────────────────────────────────────────────────────────────

function ArrList({ rows }: { rows: ArrBreakdownRow[] }) {
  if (rows.length === 0) return <Empty>No customers in this bucket.</Empty>;
  const total = rows.reduce((s, r) => s + r.arr, 0);
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {rows.map((r) => (
        <li key={r.customer_key} className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/customers/${r.customer_key}`}
              className="text-sm font-medium text-[color:var(--foreground)] truncate hover:underline"
            >
              {r.customer_display_name}
            </Link>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-[color:var(--muted-foreground)]">
              <CategoryPill category={r.category} />
              {r.ae_owner ? <span>AE · {r.ae_owner}</span> : null}
              {r.partner ? <span>via {r.partner}</span> : null}
              {r.renewal_date ? <span>renews {r.renewal_date}</span> : null}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-semibold tabular-nums text-[color:var(--foreground)]">
              {formatMoney(r.arr)}
            </div>
            <div className="text-[10px] text-[color:var(--muted-foreground)] tabular-nums">
              {total > 0 ? `${((r.arr / total) * 100).toFixed(1)}% of total` : ""}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActiveProjectsList({
  projects,
  onSelect,
}: {
  projects: ActiveProjectRow[];
  onSelect: (p: ProjectPanelItem) => void;
}) {
  if (projects.length === 0) return <Empty>No projects currently in flight.</Empty>;
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {projects.map((p) => (
        <li key={p.monday_item_id} className="py-3">
          <button
            type="button"
            onClick={() =>
              onSelect({
                monday_item_id: p.monday_item_id,
                name: p.name,
                customer_key: p.customer_key ?? undefined,
                customer_display_name: p.customer_display_name ?? undefined,
                fiscal_year: p.fiscal_year,
                health: p.health,
                project_status: p.status,
                current_phase: p.phase,
                go_live_date: p.go_live_date,
                kickoff_date: p.kickoff_date,
                fde: p.fde,
                group_title: p.group_title,
              })
            }
            className="w-full text-left hover:opacity-80 transition-opacity"
          >
            <div className="text-sm font-medium text-[color:var(--foreground)] truncate">
              {p.customer_display_name ?? "—"}
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)] truncate mt-0.5">{p.name}</div>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-[color:var(--muted-foreground)]">
              {p.phase ? <span>{p.phase}</span> : null}
              {p.health ? <Pill tone={/risk|stuck/i.test(p.health) ? "red" : "emerald"}>{p.health}</Pill> : null}
              {p.go_live_date ? <span>go-live {p.go_live_date}</span> : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NpsList({ rows }: { rows: NpsResponseRow[] }) {
  if (rows.length === 0) return <Empty>No NPS responses yet.</Empty>;
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {rows.map((r) => {
        const tone =
          r.score == null
            ? ("neutral" as const)
            : r.score >= 9
              ? ("emerald" as const)
              : r.score >= 7
                ? ("amber" as const)
                : ("red" as const);
        return (
          <li key={r.monday_item_id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {r.customer_key ? (
                    <Link
                      href={`/customers/${r.customer_key}`}
                      className="text-sm font-medium text-[color:var(--foreground)] truncate hover:underline"
                    >
                      {r.customer_display_name ?? "—"}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-[color:var(--foreground)] truncate">
                      {r.customer_display_name ?? "—"}
                    </span>
                  )}
                  <Pill tone={tone}>{r.score}</Pill>
                  {r.category ? (
                    <Pill
                      tone={
                        r.category === "Promoter"
                          ? "emerald"
                          : r.category === "Detractor"
                            ? "red"
                            : "amber"
                      }
                    >
                      {r.category}
                    </Pill>
                  ) : null}
                  {r.quarter ? (
                    <span className="text-xs text-[color:var(--muted-foreground)]">{r.quarter}</span>
                  ) : null}
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                  {r.respondent}
                </div>
                {r.feedback ? (
                  <div className="text-xs italic text-[color:var(--muted-foreground)] mt-1.5 line-clamp-3">
                    “{r.feedback}”
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PipelineList({ rows }: { rows: OpenOpportunityRow[] }) {
  if (rows.length === 0) return <Empty>No open opportunities.</Empty>;
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {rows.map((o) => (
        <li key={o.sf_id} className="py-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[color:var(--foreground)] truncate">
              {o.customer_key ? (
                <Link href={`/customers/${o.customer_key}`} className="hover:underline">
                  {o.customer_display_name ?? o.name}
                </Link>
              ) : (
                o.name
              )}
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)] truncate mt-0.5">{o.name}</div>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-[color:var(--muted-foreground)]">
              {o.stage_name ? <span>{o.stage_name}</span> : null}
              {o.close_date ? <span>closes {o.close_date}</span> : null}
              {o.owner_name ? <span>{o.owner_name}</span> : null}
              {o.probability != null ? (
                <Pill
                  tone={o.probability >= 75 ? "emerald" : o.probability >= 50 ? "amber" : "neutral"}
                >
                  {o.probability}%
                </Pill>
              ) : null}
            </div>
          </div>
          <div className="text-sm font-semibold tabular-nums text-[color:var(--foreground)] shrink-0">
            {formatMoney(o.amount)}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Pills ─────────────────────────────────────────────────────────────

type Tone = "red" | "amber" | "emerald" | "indigo" | "neutral";
const TONE_CLASS: Record<Tone, string> = {
  red:     "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  amber:   "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  indigo:  "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  neutral: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${TONE_CLASS[tone]}`}>{children}</span>;
}

function CategoryPill({ category }: { category: string }) {
  const tone: Tone = /risk/i.test(category)
    ? "red"
    : /renewal/i.test(category)
      ? "amber"
      : /strategic|growth/i.test(category)
        ? "emerald"
        : /partner/i.test(category)
          ? "indigo"
          : "neutral";
  return <Pill tone={tone}>{category}</Pill>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-[color:var(--muted-foreground)] py-6">{children}</div>;
}
