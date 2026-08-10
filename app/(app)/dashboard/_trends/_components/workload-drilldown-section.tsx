"use client";

// Client wrapper around the three workload-related charts.  Holds the
// drill-down panel state and dispatches based on which chart was clicked:
//   * FDE / Projects-by-stage  →  project list (read-only summary +
//                                 deep links to Monday + customer page)
//   * AE workload              →  customer list with inline-edit AE
//                                 dropdown that propagates everywhere
//                                 via /api/customers/[key]/manual-update

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AeWorkloadChart,
  ProjectsByGroupChart,
  TeamWorkloadChart,
} from "../charts";
import { DrillDownPanel } from "@/app/_components/drilldown-panel";
import { ProjectDetailPanel, type ProjectPanelItem } from "@/app/_components/project-detail-panel";
import { InlineEdit } from "@/app/_components/inline-edit";
import { formatMoney } from "@/app/_components/brand";
import { formatPersonName } from "@/lib/delivery/taxonomy";
import type {
  AnalyticsBundle,
  DrillDownCustomer,
  DrillDownProject,
} from "@/lib/analytics/loader";

type DrillKind = "fde" | "stage" | "ae";

interface DrillState {
  kind: DrillKind;
  key: string;
}

export function WorkloadDrilldownSection({
  bundle,
  knownAes,
}: {
  bundle: AnalyticsBundle;
  knownAes: string[];
}) {
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [project, setProject] = useState<ProjectPanelItem | null>(null);

  // Click → set drill state.  Memoised so the chart components don't see a
  // new function identity on every render.
  const open = useMemo(
    () => ({
      fde: (key: string) => setDrill({ kind: "fde", key }),
      stage: (key: string) => setDrill({ kind: "stage", key }),
      ae: (key: string) => setDrill({ kind: "ae", key }),
    }),
    []
  );

  return (
    <>
      {/* FDE workload — one chart for the whole delivery team (was previously
          split into TAM and Dev which forced the same person onto two bars). */}
      {bundle.by_fde.length > 0 ? (
        <ChartShell
          title="FDE workload"
          subtitle="Active projects per Forward Deployed Engineer · click a bar to drill in"
        >
          <TeamWorkloadChart data={bundle.by_fde} onBarClick={open.fde} />
        </ChartShell>
      ) : null}

      {/* Projects by stage + AE workload */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartShell
          title="Projects by stage"
          subtitle="Active in-flight pipeline · click a bar to see the projects"
        >
          <ProjectsByGroupChart data={bundle.projects_by_lifecycle} onBarClick={open.stage} />
        </ChartShell>
        <ChartShell
          title="AE workload"
          subtitle="ARR per Account Executive · click a bar to see the customers (and reassign their AE inline)"
        >
          <AeWorkloadChart data={bundle.by_ae} onBarClick={open.ae} />
        </ChartShell>
      </div>

      {drill ? (
        <DrillPanelDispatcher
          drill={drill}
          bundle={bundle}
          knownAes={knownAes}
          onClose={() => setDrill(null)}
          onSelectProject={(p) => setProject(p)}
        />
      ) : null}

      {project ? (
        <ProjectDetailPanel project={project} onClose={() => setProject(null)} />
      ) : null}
    </>
  );
}

// ─── Shared chart card chrome ──────────────────────────────────────────

function ChartShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card glass-card-hover p-6">
      <div className="mb-5">
        <div className="text-base font-semibold tracking-tight text-[color:var(--foreground)]">{title}</div>
        {subtitle ? <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ─── Drill-down dispatcher ─────────────────────────────────────────────

function DrillPanelDispatcher({
  drill,
  bundle,
  knownAes,
  onClose,
  onSelectProject,
}: {
  drill: DrillState;
  bundle: AnalyticsBundle;
  knownAes: string[];
  onClose: () => void;
  onSelectProject: (p: ProjectPanelItem) => void;
}) {
  if (drill.kind === "ae") {
    const customers = bundle.drilldowns.by_ae_items[drill.key] ?? [];
    const total = customers.reduce((s, c) => s + c.arr, 0);
    return (
      <DrillDownPanel
        title={`AE: ${drill.key}`}
        subtitle={`${customers.length} customer${customers.length === 1 ? "" : "s"} · ${formatMoney(total)} ARR`}
        onClose={onClose}
        footer="Reassign a customer to a different AE by clicking 'edit' on the AE field. Changes save immediately and propagate across DeliveryOps."
      >
        <CustomerList customers={customers} knownAes={knownAes} />
      </DrillDownPanel>
    );
  }

  const items =
    drill.kind === "fde"
      ? bundle.drilldowns.by_fde_items[drill.key] ?? []
      : bundle.drilldowns.projects_by_lifecycle_items[drill.key] ?? [];

  const title =
    drill.kind === "fde"
      ? `FDE: ${formatPersonName(drill.key)}`
      : `Stage: ${drill.key}`;

  return (
    <DrillDownPanel
      title={title}
      subtitle={`${items.length} project${items.length === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <>
          Project assignments (FDE, stage, status) are sourced from Monday.
          {" "}
          Click a project to see its details and updates. To change an
          assignment, open the customer page or the project on Monday — the
          next daily sync will reflect the change here.
        </>
      }
    >
      <ProjectList items={items} onSelectProject={onSelectProject} />
    </DrillDownPanel>
  );
}

// ─── List renderers ───────────────────────────────────────────────────

function ProjectList({
  items,
  onSelectProject,
}: {
  items: DrillDownProject[];
  onSelectProject: (p: ProjectPanelItem) => void;
}) {
  if (items.length === 0) {
    return <EmptyState>No projects in this bucket.</EmptyState>;
  }
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {items
        .slice()
        .sort((a, b) =>
          (a.customer_display_name ?? "").localeCompare(b.customer_display_name ?? "")
        )
        .map((p) => (
          <li key={p.monday_item_id} className="py-3">
            <button
              type="button"
              onClick={() =>
                onSelectProject({
                  monday_item_id: p.monday_item_id,
                  name: p.name,
                  customer_key: p.customer_key ?? undefined,
                  customer_display_name: p.customer_display_name ?? undefined,
                  fiscal_year: p.fiscal_year,
                  health: p.health,
                  project_status: p.status,
                  current_phase: p.phase,
                  dev_platform: p.platform,
                  go_live_date: p.go_live_date,
                  kickoff_date: p.kickoff_date,
                  fde: p.fde,
                  group_title: p.group_title,
                })
              }
              className="w-full text-left hover:opacity-80 transition-opacity"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm font-medium text-[color:var(--foreground)] break-words"
                    title={p.customer_display_name ?? undefined}
                  >
                    {p.customer_display_name ?? "—"}
                  </div>
                  <div
                    className="text-xs text-[color:var(--muted-foreground)] break-words mt-0.5"
                    title={p.name}
                  >
                    {p.name}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px] uppercase tracking-wider">
                    {p.status ? <Pill tone={statusTone(p.status)}>{p.status}</Pill> : null}
                    {p.health && /risk|off|stuck/i.test(p.health) ? (
                      <Pill tone="red">{p.health}</Pill>
                    ) : p.health ? (
                      <Pill tone="emerald">{p.health}</Pill>
                    ) : null}
                    {p.phase ? <Pill tone="neutral">{p.phase}</Pill> : null}
                    {p.platform ? <Pill tone="indigo">{p.platform}</Pill> : null}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {p.go_live_date ? (
                    <div className="text-xs tabular-nums text-[color:var(--foreground)]">
                      go-live {p.go_live_date}
                    </div>
                  ) : null}
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

function CustomerList({
  customers,
  knownAes,
}: {
  customers: DrillDownCustomer[];
  knownAes: string[];
}) {
  const router = useRouter();
  if (customers.length === 0) {
    return <EmptyState>No customers under this AE.</EmptyState>;
  }
  // Trigger a panel refresh after an inline edit so the new AE pill reflects
  // the change without requiring a full reload.
  function onSaved() {
    router.refresh();
  }
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {customers.map((c) => (
        <li key={c.id} className="py-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/customers/${c.key}`}
                className="text-sm font-medium text-[color:var(--foreground)] hover:underline break-words"
                title={c.display_name}
              >
                {c.display_name}
              </Link>
              {c.custom_category ? (
                <Pill tone="neutral">{c.custom_category}</Pill>
              ) : null}
              {c.partner ? (
                <Pill tone="indigo">via {c.partner}</Pill>
              ) : null}
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-[color:var(--muted-foreground)]">
              <span>ARR <span className="text-[color:var(--foreground)] font-semibold tabular-nums">{formatMoney(c.arr)}</span></span>
              {c.renewal_date ? (
                <span>Renews <span className="text-[color:var(--foreground)] tabular-nums">{c.renewal_date}</span></span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">AE</span>
              <span onClick={onSaved}>
                <InlineEdit
                  customerKey={c.key}
                  field="ae_owner"
                  initialValue={null /* the parent shows current AE via the panel title; inline-edit starts neutral so saving is intentional */}
                  label="AE"
                  placeholder="(reassign)"
                  suggestions={knownAes}
                />
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-[color:var(--muted-foreground)] py-6">{children}</div>
  );
}

// ─── Pill styling ─────────────────────────────────────────────────────

type Tone = "red" | "amber" | "emerald" | "indigo" | "neutral";
const TONE_CLASS: Record<Tone, string> = {
  red:     "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  amber:   "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  indigo:  "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  neutral: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "live" || s === "delivered") return "emerald";
  if (s.includes("risk") || s === "stuck" || s === "cancelled") return "red";
  if (s.includes("hold") || s.includes("paused")) return "amber";
  return "indigo";
}
