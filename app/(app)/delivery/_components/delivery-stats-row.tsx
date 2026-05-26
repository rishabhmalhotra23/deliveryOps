"use client";

import { useState } from "react";
import Link from "next/link";

import { DrillDownPanel } from "@/app/_components/drilldown-panel";
import { StatBlock } from "@/app/_components/brand";
import { ProjectDetailPanel, type ProjectPanelItem } from "@/app/_components/project-detail-panel";
import type { DeliveryProject } from "@/lib/delivery/loader";
import { isDelivered as txIsDelivered, formatPeopleList } from "@/lib/delivery/taxonomy";

type Drill = "all" | "in-flight" | "delivered-all" | "delivered-q" | null;

function isCurrentQuarter(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    Math.floor(d.getUTCMonth() / 3) === Math.floor(now.getUTCMonth() / 3)
  );
}

export function DeliveryStatsRow({
  projects,
  totals,
}: {
  projects: DeliveryProject[];
  totals: {
    total: number;
    active_in_flight: number;
    delivered_all_time: number;
    delivered_this_quarter: number;
  };
}) {
  const [drill, setDrill] = useState<Drill>(null);
  const [project, setProject] = useState<ProjectPanelItem | null>(null);

  const inFlight = projects.filter((p) => p.fiscal_year === "active");
  const deliveredAll = projects.filter((p) => txIsDelivered(p.status, p.group_title));
  const deliveredQ = deliveredAll.filter((p) => isCurrentQuarter(p.go_live_date));

  return (
    <>
      <section className="grid gap-3 md:grid-cols-4">
        <StatBlock
          label="Projects"
          value={String(totals.total)}
          hint="all boards"
          emphasis
          onClick={() => setDrill("all")}
        />
        <StatBlock
          label="In-flight"
          value={String(totals.active_in_flight)}
          hint="active board"
          onClick={() => setDrill("in-flight")}
        />
        <StatBlock
          label="Delivered all-time"
          value={String(totals.delivered_all_time)}
          hint="Live / Delivered"
          onClick={() => setDrill("delivered-all")}
        />
        <StatBlock
          label="Delivered Q-to-date"
          value={String(totals.delivered_this_quarter)}
          hint="go-live this quarter"
          onClick={() => setDrill("delivered-q")}
        />
      </section>

      {drill ? (
        <DrillDownPanel
          title={
            drill === "all"
              ? "All projects"
              : drill === "in-flight"
                ? "In-flight projects"
                : drill === "delivered-all"
                  ? "Delivered all-time"
                  : "Delivered this quarter"
          }
          subtitle={
            drill === "all"
              ? `${projects.length} projects across every Monday board`
              : drill === "in-flight"
                ? `${inFlight.length} active project${inFlight.length === 1 ? "" : "s"} on the live board`
                : drill === "delivered-all"
                  ? `${deliveredAll.length} project${deliveredAll.length === 1 ? "" : "s"} marked Live or Delivered`
                  : `${deliveredQ.length} project${deliveredQ.length === 1 ? "" : "s"} that went live this quarter`
          }
          onClose={() => setDrill(null)}
          footer="Click a project to see Monday context, recent updates, and link to the customer page."
        >
          <ProjectList
            projects={
              drill === "all"
                ? projects
                : drill === "in-flight"
                  ? inFlight
                  : drill === "delivered-all"
                    ? deliveredAll
                    : deliveredQ
            }
            onSelect={(p) => setProject(p)}
          />
        </DrillDownPanel>
      ) : null}

      {project ? (
        <ProjectDetailPanel project={project} onClose={() => setProject(null)} />
      ) : null}
    </>
  );
}

function ProjectList({
  projects,
  onSelect,
}: {
  projects: DeliveryProject[];
  onSelect: (p: ProjectPanelItem) => void;
}) {
  if (projects.length === 0) {
    return <div className="text-sm text-[color:var(--muted-foreground)] py-6">No projects in this bucket.</div>;
  }
  const sorted = projects.slice().sort((a, b) => {
    return (b.go_live_date ?? "").localeCompare(a.go_live_date ?? "");
  });
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {sorted.map((p) => (
        <li key={p.monday_item_id} className="py-3">
          <button
            type="button"
            onClick={() =>
              onSelect({
                monday_item_id: p.monday_item_id,
                name: p.name,
                customer_key: p.customer_key,
                customer_display_name: p.customer_display_name,
                fiscal_year: p.fiscal_year,
                health: p.health,
                project_status: p.status,
                current_phase: p.phase,
                dev_platform: p.platform,
                go_live_date: p.go_live_date,
                kickoff_date: p.kickoff_date,
                fde: p.fde,
                partner: p.partner,
                ae_owner: p.ae_owner,
                group_title: p.group_title,
              })
            }
            className="w-full text-left hover:opacity-80 transition-opacity"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-sm font-medium text-[color:var(--foreground)] break-words"
                    title={p.customer_display_name}
                  >
                    {p.customer_display_name}
                  </span>
                  {p.fiscal_year ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]">
                      {p.fiscal_year === "active" ? "Active" : p.fiscal_year}
                    </span>
                  ) : null}
                  {p.status ? (
                    <Pill
                      tone={
                        p.status === "Live" || p.status === "Delivered"
                          ? "emerald"
                          : /risk|stuck|cancel/i.test(p.status)
                            ? "red"
                            : /hold|paused/i.test(p.status)
                              ? "amber"
                              : "indigo"
                      }
                    >
                      {p.status}
                    </Pill>
                  ) : null}
                </div>
                <div
                  className="text-xs text-[color:var(--muted-foreground)] break-words mt-0.5"
                  title={p.name}
                >
                  {p.name}
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-[color:var(--muted-foreground)]">
                  {p.phase ? <span>{p.phase}</span> : null}
                  {p.fde ? <span>FDE: {formatPeopleList(p.fde)}</span> : null}
                  {p.go_live_date ? <span>go-live {p.go_live_date}</span> : null}
                </div>
              </div>
              <div className="text-right shrink-0">
                {p.customer_key ? (
                  <Link
                    href={`/customers/${p.customer_key}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] underline"
                  >
                    open customer
                  </Link>
                ) : null}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Name rendering centralised in lib/delivery/taxonomy.ts.

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
