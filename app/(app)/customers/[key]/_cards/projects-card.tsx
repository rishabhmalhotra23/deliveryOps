"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Badge,
  EmptyState,
} from "@kognitos/lattice";
import type { ProjectsCardProps } from "@/lib/customers/view-model";
import { ProjectDetailPanel, type ProjectPanelItem } from "@/app/_components/project-detail-panel";
import {
  isDelivered as txIsDelivered,
  isStalled as txIsStalled,
  isCancelledOrInactive as txIsCancelled,
  formatPeopleList,
} from "@/lib/delivery/taxonomy";

// ── Status/health colour maps ────────────────────────────────────────────────

const HEALTH_CLASS: Record<string, string> = {
  "On Track":  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Healthy:     "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Finished:    "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
  Done:        "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
  "At Risk":   "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25",
  Blocked:     "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25",
  Inactive:    "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

const STATUS_CLASS: Record<string, string> = {
  Live:          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  Delivered:     "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  "In Progress": "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
  "On Hold":     "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25",
  Inactive:      "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  Cancelled:     "bg-red-500/8 text-red-700 dark:text-red-400 border-red-500/20",
};

const FY_CLASS: Record<string, string> = {
  active:           "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
  inactive:         "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  "FY-2026":        "bg-[rgba(242,255,112,0.15)] text-[color:var(--brand-night)] dark:text-yellow-300 border-[rgba(242,255,112,0.35)]",
  "FY-2025":        "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/25",
  "FY-2024":        "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/25",
  "FY-2023":        "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/25",
  account_overview: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  portfolio:        "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
};

const PLATFORM_CLASS: Record<string, string> = {
  V1: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  V2: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/25",
};

function chipClass(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
  return map[key] ?? "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
}

function Chip({ label }: { label: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]">
      {label}
    </span>
  );
}
function ColorChip({ label, cls }: { label: string; cls: string }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

type Project = ProjectsCardProps["projects"][0];

// Thin adapters around the taxonomy classifiers — they expect status/group/
// fiscal_year directly, but ProjectsCardProps stores them as project_status
// and group_title.
function isDelivered(p: Project): boolean {
  return txIsDelivered(p.project_status, p.group_title);
}
function isActive(p: Project): boolean {
  // The customer-card "Active" view also surfaces account-overview "Active
  // Projects" and "Upcoming Projects" rows — kept as a customer-page-only
  // extension of the taxonomy's isActiveBoard.
  if (p.fiscal_year === "active") return !isDelivered(p);
  if (p.fiscal_year === "account_overview") {
    const g = (p.group_title ?? "").toLowerCase();
    if (g.includes("active") || g.includes("upcoming")) return true;
  }
  return false;
}
function isStalled(p: Project): boolean {
  return txIsStalled(p.project_status, p.group_title);
}
function isCancelledOrInactive(p: Project): boolean {
  return txIsCancelled(p.project_status, p.group_title, p.fiscal_year);
}

// ── Main card ───────────────────────────────────────────────────────────────

export function ProjectsCard({
  customerName,
  projects,
  mondaySyncedAt,
  className,
}: ProjectsCardProps & { className?: string }) {
  const [selectedProject, setSelectedProject] = useState<ProjectPanelItem | null>(null);

  function toPanel(p: ProjectsCardProps["projects"][0]): ProjectPanelItem {
    return {
      monday_item_id: p.monday_item_id,
      name: p.name,
      customer_display_name: customerName,
      fiscal_year: p.fiscal_year,
      health: p.health,
      project_status: p.project_status,
      current_phase: p.current_phase,
      dev_platform: p.dev_platform,
      complexity: p.complexity,
      kickoff_date: p.kickoff_date,
      go_live_date: p.go_live_date,
      total_effort_days: p.total_effort_days,
      ttv_days_text: p.ttv_days_text,
      delivered_value: p.delivered_value,
      latest_update: p.latest_update,
      fde: p.fde,
      partner: p.partner,
      group_title: p.group_title,
    };
  }
  if (projects.length === 0) {
    return (
      <div className={`glass-card glass-card-hover p-5 ${className ?? ""}`}>
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-2">Projects</div>
        <EmptyState
          icon="FolderOpen"
          title="No projects yet"
          description="Projects from Monday appear here once matched to this customer."
        />
      </div>
    );
  }

  const active  = projects.filter(isActive);
  const historical = projects.filter((p) => !isActive(p) && isDelivered(p));
  const stalled = projects.filter((p) => !isActive(p) && !isDelivered(p) && isStalled(p));
  const inactive = projects.filter((p) => !isActive(p) && !isDelivered(p) && !isStalled(p) && isCancelledOrInactive(p));
  // Account Overview "Upcoming" shows separately from "Active" in the board
  // but we merge it into active for the customer page (it's planned work).

  // Active: group by Monday board group
  const GROUP_ORDER = ["Active", "Pipeline", "On Hold", "Backlog"];
  const grouped = new Map<string, Project[]>();
  for (const p of active) {
    const k = p.group_title ?? "Other";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(p);
  }
  const orderedGroups = [
    ...GROUP_ORDER.filter((g) => grouped.has(g)).map((g) => [g, grouped.get(g)!] as const),
    ...[...grouped.entries()].filter(([g]) => !GROUP_ORDER.includes(g)),
  ];

  // Historical: sort by go_live_date descending
  const sortedHistorical = [...historical].sort(
    (a, b) => ((a.go_live_date ?? "") < (b.go_live_date ?? "") ? 1 : -1)
  );

  const totalCount = projects.length;
  const headerSummary = [
    `${totalCount} total`,
    active.length > 0 ? `${active.length} in-flight` : null,
    historical.length > 0 ? `${historical.length} delivered` : null,
    stalled.length > 0 ? `${stalled.length} stalled` : null,
    inactive.length > 0 ? `${inactive.length} inactive` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={`glass-card glass-card-hover overflow-hidden ${className ?? ""}`}>
      <div className="px-5 py-4 border-b border-[var(--glass-border)] flex items-center justify-between">
        <div>
          <div className="eyebrow text-[color:var(--muted-foreground)]">Projects</div>
          <div className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">
            {headerSummary}
          </div>
        </div>
        {mondaySyncedAt ? (
          <span className="data-label text-[color:var(--muted-foreground)]">synced {relTime(mondaySyncedAt)}</span>
        ) : null}
      </div>

      <div className="p-4 space-y-3">
        {/* ── In-flight ── */}
        {orderedGroups.length > 0 ? (
          <Accordion type="multiple" defaultValue={orderedGroups.map(([g]) => g)}>
            {orderedGroups.map(([groupName, list]) => (
              <AccordionItem value={groupName} key={groupName}>
                <AccordionTrigger>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{groupName}</span>
                    <Badge variant="outline" className="text-xs">{list.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pt-1">
                  {list.map((p) => (
                    <ProjectRow key={p.monday_item_id} project={p} customerName={customerName} onSelect={() => setSelectedProject(toPanel(p))} />
                  ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : null}

        {/* ── Historical / delivered ── */}
        {sortedHistorical.length > 0 ? (
          <Accordion type="single" collapsible defaultValue="delivered">
            <AccordionItem value="delivered">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Delivered / historical</span>
                  <Badge variant="success" className="text-xs">{sortedHistorical.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-1">
                  {sortedHistorical.map((p) => (
                    <ProjectRow key={p.monday_item_id} project={p} customerName={customerName} onSelect={() => setSelectedProject(toPanel(p))} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}

        {/* ── Stalled ── */}
        {stalled.length > 0 ? (
          <Accordion type="single" collapsible>
            <AccordionItem value="stalled">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Stalled</span>
                  <Badge variant="warning" className="text-xs">{stalled.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-1">
                  {stalled.map((p) => (
                    <ProjectRow key={p.monday_item_id} project={p} customerName={customerName} onSelect={() => setSelectedProject(toPanel(p))} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}

        {/* ── Inactive / cancelled ── */}
        {inactive.length > 0 ? (          <Accordion type="single" collapsible>
            <AccordionItem value="inactive">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[color:var(--muted-foreground)]">Inactive / cancelled</span>
                  <Badge variant="secondary" className="text-xs">{inactive.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-1">
                  {inactive.map((p) => (
                    <ProjectRow key={p.monday_item_id} project={p} customerName={customerName} onSelect={() => setSelectedProject(toPanel(p))} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>

      {selectedProject ? (
        <ProjectDetailPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          showCustomerLink={false}
        />
      ) : null}
    </div>
  );
}

// ── Individual project row ───────────────────────────────────────────────────

function ProjectRow({
  project: p,
  customerName,
  onSelect,
}: {
  project: Project;
  customerName: string;
  onSelect?: () => void;
}) {
  const cleanName = p.name.replace(new RegExp(`^${escapeRegex(customerName)}\\s*[-—]\\s*`), "");
  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 space-y-2 hover:border-[var(--brand-yellow)] transition-colors cursor-pointer"
    >
      {/* Row 1: name + status chips */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium text-[color:var(--foreground)] min-w-0 truncate flex-1">
          {cleanName}
        </div>
        <div className="flex items-center gap-1 flex-wrap shrink-0">
          {p.fiscal_year ? (
            <ColorChip label={p.fiscal_year === "active" ? "Active" : p.fiscal_year} cls={chipClass(FY_CLASS, p.fiscal_year)} />
          ) : null}
          {p.dev_platform ? (
            <ColorChip label={p.dev_platform} cls={chipClass(PLATFORM_CLASS, p.dev_platform)} />
          ) : null}
          {p.health ? (
            <ColorChip label={p.health} cls={chipClass(HEALTH_CLASS, p.health)} />
          ) : null}
          {p.project_status ? (
            <ColorChip label={p.project_status} cls={chipClass(STATUS_CLASS, p.project_status)} />
          ) : null}
        </div>
      </div>

      {/* Row 2: metadata grid */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {p.current_phase ? <Meta label="Phase">{p.current_phase}</Meta> : null}
        {p.complexity ? <Meta label="Complexity">{p.complexity}</Meta> : null}
        {p.kickoff_date ? <Meta label="Kickoff">{p.kickoff_date}</Meta> : null}
        {p.go_live_date ? <Meta label="Go-live"><span className="font-medium text-[color:var(--foreground)]">{p.go_live_date}</span></Meta> : null}
        {p.total_effort_days ? <Meta label="Effort">{p.total_effort_days}d</Meta> : null}
        {p.ttv_days_text ? <Meta label="TTV">{p.ttv_days_text}d</Meta> : null}
        {p.partner ? <Meta label="Partner">{p.partner}</Meta> : null}
        {p.fde ? <Meta label="FDE">{formatPeopleList(p.fde, { expand: true })}</Meta> : null}
      </div>

      {/* Row 3: delivered value */}
      {p.delivered_value ? (
        <div className="text-xs text-[color:var(--muted-foreground)] border-t border-[var(--glass-border)] pt-1.5">
          <span className="font-medium text-[color:var(--foreground)]">Value: </span>
          {p.delivered_value}
        </div>
      ) : null}

      {/* Row 4: latest update (truncated — full updates in panel) */}
      {p.latest_update ? (
        <div className="text-xs text-[color:var(--muted-foreground)] italic line-clamp-2">
          {p.latest_update}
        </div>
      ) : null}
    </button>
  );
}

// Also render the slide-over at the card root.
// The card exports both the list and the panel trigger via `onSelect`.
// The panel render is in the parent (ProjectsCard) which holds the state.

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="text-xs text-[color:var(--muted-foreground)]">
      {label}: <span className="text-[color:var(--foreground)]">{children}</span>
    </span>
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

void Chip;
