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

function LinearTickets({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="text-[color:var(--muted-foreground)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
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
    </div>
  );
}

type SortKey = "default" | "name" | "customer" | "stage" | "fde" | "parity" | "handover" | "validation" | "completion" | "arr";
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
  { key: "customer", label: "Customer" },
  { key: "stage", label: "Stage" },
  { key: "fde", label: "FDE" },
  { key: "parity", label: "Parity" },
  { key: "handover", label: "Handover" },
  { key: "validation", label: "Validation" },
  { key: "completion", label: "Completion", align: "right" },
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
    customer: (a, b) => compareString(a.customer_display_name, b.customer_display_name),
    stage: (a, b) => compareString(a.migration_stage, b.migration_stage),
    fde: (a, b) => compareString(a.fde_owner, b.fde_owner),
    parity: (a, b) => compareString(a.date_parity_complete, b.date_parity_complete),
    handover: (a, b) => compareString(a.date_customer_handover, b.date_customer_handover),
    validation: (a, b) => compareString(a.date_customer_validation, b.date_customer_validation),
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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return overview.rows.filter((p) => {
      if (stage && p.migration_stage !== stage) return false;
      if (customer && p.customer_display_name !== customer) return false;
      if (fde && p.fde_owner !== fde) return false;
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
      setSortDir(["parity", "handover", "validation", "completion", "arr"].includes(k) ? "desc" : "asc");
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
          {overview.facets.fdeOwners.map((o) => (
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
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Blockers</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg)] transition-colors cursor-pointer align-top"
                    onClick={() => setSelectedProcess(p)}
                  >
                    <td className="px-3 py-2 font-medium text-[color:var(--foreground)] min-w-[200px] whitespace-normal break-words leading-snug">
                      {p.process_name}
                    </td>
                    <td className="px-3 py-2 text-[color:var(--foreground)] min-w-[120px] whitespace-normal break-words leading-snug">
                      {p.customer_display_name}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StageBadge stage={p.migration_stage} />
                    </td>
                    <td className="px-3 py-2 text-[color:var(--muted-foreground)] whitespace-nowrap">{p.fde_owner ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">{p.date_parity_complete ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">{p.date_customer_handover ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">{p.date_customer_validation ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                      {p.completion_pct != null ? `${Math.round(p.completion_pct * 100)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] whitespace-nowrap">
                      {p.arr != null ? `$${p.arr.toLocaleString("en-US")}` : "—"}
                    </td>
                    <td className="px-3 py-2 min-w-[140px]">
                      <LinearTickets ids={p.linear_ticket_ids} />
                    </td>
                    <td className="px-3 py-2 text-[color:var(--muted-foreground)] min-w-[160px] whitespace-normal break-words leading-snug">
                      {p.blockers ?? "—"}
                    </td>
                  </tr>
                ))}
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
