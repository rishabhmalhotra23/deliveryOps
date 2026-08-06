"use client";

import { useMemo, useState } from "react";
import type { V2MigrationOverview } from "@/lib/processes/loader";
import { V2_STAGES, MIGRATION_STAGE_LABELS } from "@/lib/processes/loader";
import type { ProcessRow } from "@/lib/processes/loader";
import type { MigrationStage } from "@/lib/supabase/types";
import { ProcessDrawer } from "@/app/_components/process-drawer";
import { StatBlock } from "@/app/_components/brand";

interface V2MigrationClientProps {
  overview: V2MigrationOverview;
}

// The Excel/Monday sources spell the same 3 active FDEs several ways
// ("Karthik Nagabhushana" / "Karthik N", a bare email, a full name). This is
// a display-only normalization for this page — the underlying fde_owner
// value (and every other page that reads it) is untouched.
const FDE_ALIASES: Record<string, string> = {
  ayush: "Ayush",
  "ayush ghosh": "Ayush",
  "ayush.ghosh@kognitos.com": "Ayush",
  "karthik n": "Karthik",
  "karthik nagabhushana": "Karthik",
  rishabh: "Rishabh",
  "rishabh malhotra": "Rishabh",
};

function fdeLabel(raw: string | null): string {
  if (!raw) return "Unassigned";
  return FDE_ALIASES[raw.trim().toLowerCase()] ?? raw;
}

const STAGE_BADGE: Record<MigrationStage, string> = {
  not_required: "border-[var(--glass-border)] text-[color:var(--muted-foreground)]",
  in_development: "bg-indigo-500/10 text-indigo-700 border-indigo-500/25",
  engg_pending: "bg-orange-500/10 text-orange-700 border-orange-500/25",
  parity_testing: "bg-blue-500/10 text-blue-700 border-blue-500/25",
  customer_validation: "bg-amber-500/10 text-amber-700 border-amber-500/25",
  live_on_v2: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
  v2_native: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
  migrated_pending_commercial: "bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/25",
};

function StageBadge({ stage }: { stage: MigrationStage }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${STAGE_BADGE[stage]}`}>
      {MIGRATION_STAGE_LABELS[stage]}
    </span>
  );
}

// One column instead of three near-empty ones: the furthest milestone this
// process has actually reached, in the order work moves through. Sparse
// per-column dates were exactly what made the old layout hard to scan — most
// cells were "—" in any one of the three date columns.
const MILESTONES: { key: keyof ProcessRow; label: string }[] = [
  { key: "went_live_at", label: "Live" },
  { key: "date_customer_validation", label: "Validated" },
  { key: "date_customer_handover", label: "Handed over" },
  { key: "date_parity_complete", label: "Parity done" },
];

function latestMilestone(row: ProcessRow): { label: string; date: string } | null {
  for (const m of MILESTONES) {
    const v = row[m.key] as string | null;
    if (v) return { label: m.label, date: v.slice(0, 10) };
  }
  return null;
}

function formatMoney(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

// Collapsed to a count by default — Conectiv's migration alone carries 25
// tickets, which turned "Linear" into an unreadable wall of chips. Expands
// in place on click; no modal, no navigating away from the table.
function LinearTickets({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return <span className="text-[color:var(--muted-foreground)]">—</span>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:border-[color:var(--brand-yellow)]"
      >
        {ids.length} ticket{ids.length > 1 ? "s" : ""}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-1 max-w-[220px]">
      {ids.map((id) => (
        <a
          key={id}
          href={`https://linear.app/kognitos/issue/${id}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)] hover:border-[color:var(--brand-yellow)] hover:text-[color:var(--foreground)] text-[color:var(--muted-foreground)]"
        >
          {id}
        </a>
      ))}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
        }}
        className="text-[10px] px-1 text-[color:var(--muted-foreground)] underline"
      >
        collapse
      </button>
    </div>
  );
}

type SortKey = "default" | "name" | "stage" | "fde" | "milestone" | "completion" | "arr";
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

const COLS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Process" },
  { key: "stage", label: "Stage" },
  { key: "fde", label: "FDE" },
  { key: "milestone", label: "Latest milestone" },
  { key: "completion", label: "Progress", align: "right" },
  { key: "arr", label: "ARR", align: "right" },
];

function sortRows(rows: ProcessRow[], key: SortKey, dir: SortDir): ProcessRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const sorted = rows.slice();
  if (key === "default") {
    sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return sorted;
  }
  const cmp: Record<Exclude<SortKey, "default">, (a: ProcessRow, b: ProcessRow) => number> = {
    name: (a, b) => compareString(a.process_name, b.process_name),
    stage: (a, b) => compareString(a.migration_stage, b.migration_stage),
    fde: (a, b) => compareString(fdeLabel(a.fde_owner), fdeLabel(b.fde_owner)),
    milestone: (a, b) => compareString(latestMilestone(a)?.date, latestMilestone(b)?.date),
    completion: (a, b) => compareNumber(a.completion_pct, b.completion_pct),
    arr: (a, b) => compareNumber(a.arr, b.arr),
  };
  sorted.sort((a, b) => sign * cmp[key](a, b));
  return sorted;
}

export function V2MigrationClient({ overview }: V2MigrationClientProps) {
  const [stage, setStage] = useState<MigrationStage | "">("");
  const [customer, setCustomer] = useState("");
  const [fde, setFde] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedProcess, setSelectedProcess] = useState<ProcessRow | null>(null);

  const fdeOptions = useMemo(
    () => Array.from(new Set(overview.rows.map((r) => fdeLabel(r.fde_owner)))).sort(),
    [overview.rows]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return overview.rows.filter((p) => {
      if (stage && p.migration_stage !== stage) return false;
      if (customer && p.customer_display_name !== customer) return false;
      if (fde && fdeLabel(p.fde_owner) !== fde) return false;
      if (s) {
        const hay = [p.process_name, p.customer_display_name, p.fde_owner ?? "", p.blockers ?? "", ...p.linear_ticket_ids]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [overview.rows, stage, customer, fde, search]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  function clickHeader(k: SortKey) {
    if (sortKey === k) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey("default"); setSortDir("asc"); }
    } else {
      setSortKey(k);
      setSortDir(["milestone", "completion", "arr"].includes(k) ? "desc" : "asc");
    }
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
        {V2_STAGES.map((s) => (
          <StatBlock
            key={s}
            label={MIGRATION_STAGE_LABELS[s]}
            value={String(overview.counts.byStage[s])}
            emphasis={stage === s}
            onClick={() => setStage(stage === s ? "" : s)}
          />
        ))}
      </section>

      <div className="glass-card p-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search processes, tickets…"
          className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-3 py-1.5 text-sm w-56"
        />
        <select
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1.5 text-sm"
        >
          <option value="">Customer: all</option>
          {overview.facets.customers.map((o) => (
            <option key={o} value={o}>Customer: {o}</option>
          ))}
        </select>
        <select
          value={fde}
          onChange={(e) => setFde(e.target.value)}
          className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1.5 text-sm"
        >
          <option value="">FDE: all</option>
          {fdeOptions.map((o) => (
            <option key={o} value={o}>FDE: {o}</option>
          ))}
        </select>
        {stage ? (
          <button
            type="button"
            onClick={() => setStage("")}
            className="text-xs underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
          >
            clear stage filter
          </button>
        ) : null}
        <div className="ml-auto data-label text-[color:var(--muted-foreground)] tabular-nums">
          {filtered.length} of {overview.counts.total} processes
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="glass-card p-6 text-sm text-[color:var(--muted-foreground)]">
          No processes match the current filters.
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
                <tr>
                  {COLS.map((c) => {
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
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Linear</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const milestone = latestMilestone(p);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg)] transition-colors cursor-pointer align-top"
                      onClick={() => setSelectedProcess(p)}
                    >
                      <td className="px-3 py-2 min-w-[220px] whitespace-normal break-words leading-snug">
                        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          {p.customer_display_name}
                        </div>
                        <div className="font-medium text-[color:var(--foreground)] mt-0.5">{p.process_name}</div>
                        {p.blockers ? (
                          <div className="text-[11px] text-red-700 mt-1 line-clamp-2" title={p.blockers}>
                            ⚑ {p.blockers}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StageBadge stage={p.migration_stage} />
                      </td>
                      <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{fdeLabel(p.fde_owner)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {milestone ? (
                          <>
                            <span className="text-[color:var(--foreground)] font-medium tabular-nums">{milestone.date}</span>
                            <span className="text-[11px] text-[color:var(--muted-foreground)] ml-1.5">{milestone.label}</span>
                          </>
                        ) : (
                          <span className="text-[color:var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                        {p.completion_pct != null ? `${Math.round(p.completion_pct * 100)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                        {formatMoney(p.arr)}
                      </td>
                      <td className="px-3 py-2 min-w-[100px]">
                        <LinearTickets ids={p.linear_ticket_ids} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedProcess ? (
        <ProcessDrawer
          process={selectedProcess}
          customerDisplayName={selectedProcess.customer_display_name}
          facets={overview.facets}
          onClose={() => setSelectedProcess(null)}
        />
      ) : null}
    </div>
  );
}
