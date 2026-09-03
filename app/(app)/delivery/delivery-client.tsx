"use client";

// The merged Delivery workspace. V2 Migration is no longer its own page — it's
// a second section here ("Active work" / "V2 migration") over the same
// `processes` rows, switchable between table and board. Row click no longer
// opens the detail panel (cells edit in place); the panel opens deliberately
// from a row's ⤢ button, mounted either as a 420px sticky split column or an
// 880px centre overlay depending on the toolbar toggle.
// Approved design: 2026-09-03-v2-delivery-redesign.html (CLAUDE-CODE-PROMPT.md).

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProcessesOverview, ProcessRow, V2MigrationOverview, V2ProcessRow } from "@/lib/processes/loader";
import type { Process, ProcessNoteKind } from "@/lib/supabase/types";
import { MIGRATION_STAGE_LABELS } from "@/lib/supabase/types";
import { PageHeader } from "@/app/_components/brand";
import { ProcessTable } from "@/app/_components/process-table";
import { ProcessBoard } from "@/app/_components/process-board";
import { ProcessDetail, type DetailProcess } from "@/app/_components/process-detail";
import { ConfigureDialog } from "@/app/_components/configure-dialog";
import { BulkActionBar, type BulkResult } from "@/app/_components/bulk-action-bar";
import { NewProcessModal } from "./_components/new-process-modal";
import { useViewPrefs, type FilterField } from "@/lib/delivery/prefs";
import { COLDEFS, NARROW_COLS, CARD_FIELDS, type ColKey } from "@/lib/delivery/columns";

type Section = "active" | "v2";
type ViewMode = "table" | "board";

const FILTER_LABEL: Record<FilterField, string> = {
  stage: "Stage",
  owner: "FDE",
  customer: "Customer",
  health: "Health",
  partner: "Partner",
  platform: "Platform",
  lifecycle: "Lifecycle",
  phase: "Phase",
  tam: "TAM",
};

const ALL_FILTER_FIELDS: FilterField[] = ["stage", "owner", "customer", "health", "partner", "platform", "lifecycle", "phase", "tam"];

function matchesFilters(row: DetailProcess, values: Partial<Record<FilterField, string>>): boolean {
  if (values.stage && row.migration_stage !== values.stage) return false;
  if (values.owner && row.fde_owner !== values.owner) return false;
  if (values.customer && row.customer_display_name !== values.customer) return false;
  if (values.health && row.health !== values.health) return false;
  if (values.partner && row.partner !== values.partner) return false;
  if (values.platform && row.platform !== values.platform) return false;
  if (values.lifecycle && row.lifecycle !== values.lifecycle) return false;
  if (values.phase && row.phase !== values.phase) return false;
  if (values.tam && row.tam_owner !== values.tam) return false;
  return true;
}

function matchesSearch(row: DetailProcess, q: string): boolean {
  if (!q) return true;
  const hay = [row.process_name, row.customer_display_name, row.fde_owner ?? "", row.partner ?? "", row.blockers ?? "", row.notes ?? "", ...row.linear_ticket_ids]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function compareBy(key: ColKey, a: DetailProcess, b: DetailProcess): number {
  switch (key) {
    case "customer":
      return a.customer_display_name.localeCompare(b.customer_display_name);
    case "stage":
      return a.migration_stage.localeCompare(b.migration_stage);
    case "lifecycle":
      return a.lifecycle.localeCompare(b.lifecycle);
    case "phase":
      return (a.phase ?? "").localeCompare(b.phase ?? "");
    case "owner":
      return (a.fde_owner ?? "").localeCompare(b.fde_owner ?? "");
    case "tam":
      return (a.tam_owner ?? "").localeCompare(b.tam_owner ?? "");
    case "partner":
      return (a.partner ?? "").localeCompare(b.partner ?? "");
    case "health":
      return (a.health ?? "").localeCompare(b.health ?? "");
    case "platform":
      return a.platform.localeCompare(b.platform);
    case "pct":
      return (a.completion_pct ?? -1) - (b.completion_pct ?? -1);
    case "arr":
      return (a.arr ?? -1) - (b.arr ?? -1);
    case "effort":
      return (a.total_effort_hours ?? -1) - (b.total_effort_hours ?? -1);
    case "kickoff":
      return (a.kickoff_date ?? "").localeCompare(b.kickoff_date ?? "");
    case "golive":
      return (a.go_live_date ?? "").localeCompare(b.go_live_date ?? "");
    case "tickets":
      return a.linear_ticket_ids.length - b.linear_ticket_ids.length;
    case "stale":
      return a.updated_at.localeCompare(b.updated_at);
    default:
      return 0;
  }
}

function optionsForField(field: FilterField, section: Section, rows: DetailProcess[], processesOverview: ProcessesOverview, v2Overview: V2MigrationOverview): string[] {
  const facets = section === "v2" ? v2Overview.facets : processesOverview.facets;
  switch (field) {
    case "customer":
      return facets.customers;
    case "owner":
      return facets.fdeOwners;
    case "tam":
      return facets.tamOwners;
    case "partner":
      return facets.partners;
    case "stage":
      return Array.from(new Set(rows.map((r) => r.migration_stage))).sort();
    case "health":
      return Array.from(new Set(rows.map((r) => r.health).filter((v): v is NonNullable<typeof v> => !!v))).sort();
    case "lifecycle":
      return Array.from(new Set(rows.map((r) => r.lifecycle))).sort();
    case "phase":
      return Array.from(new Set(rows.map((r) => r.phase).filter((v): v is NonNullable<typeof v> => !!v))).sort();
    case "platform":
      return Array.from(new Set(rows.map((r) => r.platform))).sort();
    default:
      return [];
  }
}

function optionLabel(field: FilterField, value: string): string {
  if (field === "stage") return MIGRATION_STAGE_LABELS[value as keyof typeof MIGRATION_STAGE_LABELS] ?? value;
  if (field === "platform") return value.toUpperCase();
  return value.replace(/_/g, " ");
}

interface DeliveryClientProps {
  processesOverview: ProcessesOverview;
  v2Overview: V2MigrationOverview;
}

export function DeliveryClient({ processesOverview, v2Overview }: DeliveryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [section, setSection] = useState<Section>(searchParams.get("section") === "v2" ? "v2" : "active");
  const [viewBySection, setViewBySection] = useState<Record<Section, ViewMode>>({ active: "board", v2: "table" });
  const [prefs, setPrefs] = useViewPrefs();

  const [allRows, setAllRows] = useState<ProcessRow[]>(processesOverview.all);
  const [v2Rows, setV2Rows] = useState<V2ProcessRow[]>(v2Overview.rows);
  useEffect(() => setAllRows(processesOverview.all), [processesOverview]);
  useEffect(() => setV2Rows(v2Overview.rows), [v2Overview]);

  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Partial<Record<FilterField, string>>>({});
  const [openPopover, setOpenPopover] = useState<FilterField | "add" | "fields" | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const view = viewBySection[section];
  const baseRows: DetailProcess[] = section === "v2" ? v2Rows : allRows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseRows.filter((r) => matchesSearch(r, q) && matchesFilters(r, filterValues));
  }, [baseRows, search, filterValues]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => sign * compareBy(sortKey, a, b));
  }, [filtered, sortKey, sortDir]);

  function onSort(key: ColKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey(null);
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function applyUpdate(updated: Process) {
    setAllRows((cur) => cur.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setV2Rows((cur) => cur.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    router.refresh();
  }

  async function saveField(id: string, patch: Partial<Process>): Promise<Process> {
    const res = await fetch(`/api/processes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    applyUpdate(json.process as Process);
    return json.process as Process;
  }

  function removeRows(ids: string[]) {
    setAllRows((cur) => cur.filter((r) => !ids.includes(r.id)));
    setV2Rows((cur) => cur.filter((r) => !ids.includes(r.id)));
    setSelected((cur) => {
      const next = new Set(cur);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (openId && ids.includes(openId)) setOpenId(null);
    router.refresh();
  }

  async function bulkPatch(ids: string[], patch: Partial<Process>): Promise<BulkResult> {
    const res = await fetch("/api/processes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, patch }),
    });
    const json = (await res.json()) as BulkResult;
    for (const p of json.updated ?? []) applyUpdate(p);
    return json;
  }

  async function bulkArchive(ids: string[]) {
    await fetch("/api/processes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "delete" }),
    });
    removeRows(ids);
  }

  async function bulkNote(ids: string[], body: string, kind: ProcessNoteKind) {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/processes/${id}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, kind }),
        })
      )
    );
  }

  function handleCreated(process: Process) {
    setCreating(false);
    router.refresh();
    const asRow = { ...process, customer_display_name: process.account, open_suggestion_count: 0, needs_classification: false };
    setAllRows((cur) => [asRow, ...cur]);
  }

  const visibleCols = openId && prefs.pattern === "split" ? NARROW_COLS : prefs.cols;
  const narrow = openId != null && prefs.pattern === "split";

  const openProcess = openId ? sorted.find((r) => r.id === openId) ?? baseRows.find((r) => r.id === openId) ?? null : null;

  const columnCountLabel = view === "table" ? `${visibleCols.length} columns` : "Card fields";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Delivery"
        title="Every process, every customer, every stage."
        subtitle={`${processesOverview.counts.total} processes, native to DeliveryOps — Active work and V2 migration are the same records, two lenses.`}
        actions={
          <button type="button" onClick={() => setCreating(true)} className="btn-primary rounded-full px-4 py-2 text-sm font-semibold">
            New process
          </button>
        }
      />

      {/* Section tabs */}
      <div className="flex items-center gap-4 border-b" style={{ borderColor: "var(--glass-border)" }}>
        {(
          [
            { key: "active" as Section, label: "Active work", count: processesOverview.counts.active },
            { key: "v2" as Section, label: "V2 migration", count: v2Overview.counts.total },
          ]
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setSection(s.key);
              setOpenPopover(null);
              setSelected(new Set());
              setOpenId(null);
              router.replace(s.key === "v2" ? "/delivery?section=v2" : "/delivery");
            }}
            className="pb-2 text-sm tracking-tight flex items-center gap-1.5"
            style={{
              color: section === s.key ? "var(--foreground)" : "var(--muted-foreground)",
              fontWeight: section === s.key ? 600 : 400,
              borderBottom: section === s.key ? "2px solid var(--yellow-ink)" : "2px solid transparent",
            }}
          >
            {s.label}
            <span className="font-mono text-[11px] opacity-70">{s.count}</span>
          </button>
        ))}
        {section === "v2" ? (
          <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)] pb-2">same records, migration lens</span>
        ) : null}
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border p-2.5 flex flex-wrap items-center gap-2" style={{ borderColor: "var(--glass-border)", background: "var(--surface-1, var(--card))" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search processes…"
          className="rounded-md border px-3 py-1.5 text-sm bg-[var(--glass-bg)] text-[color:var(--foreground)] w-56"
          style={{ borderColor: "var(--glass-border)" }}
        />

        {prefs.filterKeys.map((key) => (
          <FilterChip
            key={key}
            fieldKey={key}
            value={filterValues[key] ?? null}
            open={openPopover === key}
            onToggleOpen={() => setOpenPopover((cur) => (cur === key ? null : key))}
            options={optionsForField(key, section, baseRows, processesOverview, v2Overview)}
            onPick={(v) => {
              setFilterValues((cur) => ({ ...cur, [key]: v ?? undefined }));
              setOpenPopover(null);
            }}
            onRemove={() => {
              setPrefs((cur) => ({ ...cur, filterKeys: cur.filterKeys.filter((k) => k !== key) }));
              setFilterValues((cur) => {
                const next = { ...cur };
                delete next[key];
                return next;
              });
            }}
          />
        ))}

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPopover((cur) => (cur === "add" ? null : "add"))}
            className="rounded-md border border-dashed px-2.5 py-1.5 text-[12.5px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            style={{ borderColor: "var(--glass-border)" }}
          >
            + Filter
          </button>
          {openPopover === "add" ? (
            <div
              className="dops-rise-in absolute z-30 mt-1 w-40 rounded-md border shadow-lg py-1"
              style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
            >
              {ALL_FILTER_FIELDS.filter((f) => !prefs.filterKeys.includes(f)).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setPrefs((cur) => ({ ...cur, filterKeys: [...cur.filterKeys, f] }));
                    setOpenPopover(f);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)]"
                >
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
            <button
              type="button"
              onClick={() => setViewBySection((cur) => ({ ...cur, [section]: "table" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={view === "table" ? { background: "rgba(242,255,112,0.18)" } : undefined}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewBySection((cur) => ({ ...cur, [section]: "board" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={view === "board" ? { background: "rgba(242,255,112,0.18)" } : undefined}
            >
              Board
            </button>
          </div>

          <button type="button" onClick={() => setConfigureOpen(true)} title="Configure" className="w-8 h-8 rounded-md flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]">
            ⚙
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenPopover((cur) => (cur === "fields" ? null : "fields"))}
              className="rounded-md border px-2.5 py-1.5 text-[12.5px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
              style={{ borderColor: "var(--glass-border)" }}
            >
              {columnCountLabel}
            </button>
            {openPopover === "fields" ? (
              <FieldsMenu
                view={view}
                cols={prefs.cols}
                cardFields={prefs.cardFields}
                onToggle={(key) => {
                  if (view === "table") {
                    setPrefs((cur) => ({
                      ...cur,
                      cols: cur.cols.includes(key) ? cur.cols.filter((c) => c !== key) : [...cur.cols, key],
                    }));
                  } else {
                    setPrefs((cur) => ({
                      ...cur,
                      cardFields: cur.cardFields.includes(key) ? cur.cardFields.filter((c) => c !== key) : [...cur.cardFields, key],
                    }));
                  }
                }}
                onResetWidths={() => setPrefs((cur) => ({ ...cur, colW: {} }))}
                hasCustomWidths={Object.keys(prefs.colW).length > 0}
              />
            ) : null}
          </div>

          <span className="text-[11.5px] font-mono text-[color:var(--muted-foreground)]">
            {sorted.length} of {baseRows.length}
          </span>

          <div className="w-px h-5" style={{ background: "var(--glass-border)" }} />

          <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
            <button
              type="button"
              onClick={() => setPrefs((cur) => ({ ...cur, pattern: "split" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={prefs.pattern === "split" ? { background: "rgba(242,255,112,0.18)" } : undefined}
            >
              Split panel
            </button>
            <button
              type="button"
              onClick={() => setPrefs((cur) => ({ ...cur, pattern: "overlay" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={prefs.pattern === "overlay" ? { background: "rgba(242,255,112,0.18)" } : undefined}
            >
              Overlay
            </button>
          </div>
        </div>
      </div>

      {Object.keys(filterValues).length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.entries(filterValues) as [FilterField, string][]).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border"
              style={{ background: "rgba(242,255,112,0.10)", borderColor: "rgba(242,255,112,0.35)" }}
            >
              {FILTER_LABEL[k]} · {optionLabel(k, v)}
              <button
                type="button"
                onClick={() =>
                  setFilterValues((cur) => {
                    const next = { ...cur };
                    delete next[k];
                    return next;
                  })
                }
                className="opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setFilterValues({})} className="text-[11px] underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
            Clear all
          </button>
        </div>
      ) : null}

      {/* Body */}
      <div className={openId && prefs.pattern === "split" ? "grid gap-3" : ""} style={openId && prefs.pattern === "split" ? { gridTemplateColumns: "minmax(560px,1fr) minmax(360px,420px)" } : undefined}>
        <div className="min-w-0">
          {view === "table" ? (
            <ProcessTable
              rows={sorted}
              cols={visibleCols}
              colW={prefs.colW}
              onColWChange={(key, px) => setPrefs((cur) => ({ ...cur, colW: { ...cur.colW, [key]: px } }))}
              onReorderCol={(from, to) =>
                setPrefs((cur) => {
                  const next = cur.cols.filter((c) => c !== from);
                  const idx = next.indexOf(to);
                  next.splice(idx < 0 ? next.length : idx, 0, from);
                  return { ...cur, cols: next };
                })
              }
              narrow={narrow}
              selected={selected}
              onSelectionChange={setSelected}
              openId={openId}
              onOpenDetail={setOpenId}
              customerOptions={section === "v2" ? v2Overview.facets.customerOptions : processesOverview.facets.customerOptions}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              colorMap={prefs.colorMap}
              onSave={saveField}
              onArchive={(id) => void bulkArchive([id])}
              onRestore={() => {}}
              showRestore={false}
            />
          ) : (
            <ProcessBoard
              mode={section}
              rows={sorted}
              cardFields={prefs.cardFields}
              colorMap={prefs.colorMap}
              onSave={saveField}
              onOpenDetail={setOpenId}
              onCreateInLane={() => setCreating(true)}
            />
          )}
        </div>

        {openId && prefs.pattern === "split" && openProcess ? (
          <div className="rounded-xl border sticky self-start" style={{ top: 132, maxHeight: "calc(100vh - 148px)", borderColor: "var(--glass-border)", background: "var(--surface-1, var(--card))" }}>
            <ProcessDetail
              process={openProcess}
              list={sorted}
              onSelectId={setOpenId}
              customerOptions={section === "v2" ? v2Overview.facets.customerOptions : processesOverview.facets.customerOptions}
              onUpdated={applyUpdate}
              onArchived={(id) => removeRows([id])}
              onClose={() => setOpenId(null)}
              onAddColumn={(col) => setPrefs((cur) => ({ ...cur, cols: cur.cols.includes(col) ? cur.cols : [...cur.cols, col], cardFields: cur.cardFields.includes(col) ? cur.cardFields : [...cur.cardFields, col] }))}
            />
          </div>
        ) : null}
      </div>

      {openId && prefs.pattern === "overlay" && openProcess ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 grid place-items-start justify-center overflow-y-auto py-16 px-4"
          onClick={() => setOpenId(null)}
          onKeyDown={(e) => e.key === "Escape" && setOpenId(null)}
        >
          <div
            className="dops-rise-in w-full rounded-xl border shadow-2xl"
            style={{ maxWidth: 880, borderColor: "var(--glass-border)", background: "var(--surface-1, var(--card))", maxHeight: "calc(100vh - 128px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <ProcessDetail
              process={openProcess}
              list={sorted}
              onSelectId={setOpenId}
              customerOptions={section === "v2" ? v2Overview.facets.customerOptions : processesOverview.facets.customerOptions}
              onUpdated={applyUpdate}
              onArchived={(id) => removeRows([id])}
              onClose={() => setOpenId(null)}
              onAddColumn={(col) => setPrefs((cur) => ({ ...cur, cols: cur.cols.includes(col) ? cur.cols : [...cur.cols, col], cardFields: cur.cardFields.includes(col) ? cur.cardFields : [...cur.cardFields, col] }))}
            />
          </div>
        </div>
      ) : null}

      <BulkActionBar
        selectedIds={Array.from(selected)}
        onClearSelection={() => setSelected(new Set())}
        onBulkPatch={bulkPatch}
        onBulkArchive={bulkArchive}
        onBulkNote={bulkNote}
      />

      {configureOpen ? (
        <ConfigureDialog colorMap={prefs.colorMap} onColorMapChange={(next) => setPrefs((cur) => ({ ...cur, colorMap: next }))} onClose={() => setConfigureOpen(false)} />
      ) : null}

      {creating ? (
        <NewProcessModal customerOptions={processesOverview.facets.customerOptions} onClose={() => setCreating(false)} onCreated={handleCreated} />
      ) : null}
    </div>
  );
}

function FilterChip({
  fieldKey,
  value,
  open,
  onToggleOpen,
  options,
  onPick,
  onRemove,
}: {
  fieldKey: FilterField;
  value: string | null;
  open: boolean;
  onToggleOpen: () => void;
  options: string[];
  onPick: (v: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] text-[color:var(--foreground)]"
        style={{ borderColor: "var(--glass-border)" }}
      >
        {FILTER_LABEL[fieldKey]} · {value ? optionLabel(fieldKey, value) : "any"}
        <span onClick={(e) => { e.stopPropagation(); onRemove(); }} className="opacity-50 hover:opacity-100">
          ×
        </span>
      </button>
      {open ? (
        <div
          className="dops-rise-in absolute z-30 mt-1 w-52 max-h-64 overflow-auto rounded-md border shadow-lg py-1"
          style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
        >
          <button type="button" onClick={() => onPick(null)} className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
            any
          </button>
          {options.map((o) => (
            <button key={o} type="button" onClick={() => onPick(o)} className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)] truncate">
              {optionLabel(fieldKey, o)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldsMenu({
  view,
  cols,
  cardFields,
  onToggle,
  onResetWidths,
  hasCustomWidths,
}: {
  view: ViewMode;
  cols: ColKey[];
  cardFields: ColKey[];
  onToggle: (key: ColKey) => void;
  onResetWidths: () => void;
  hasCustomWidths: boolean;
}) {
  const active = view === "table" ? cols : cardFields;
  const universe = view === "table" ? COLDEFS : COLDEFS.filter((c) => CARD_FIELDS.includes(c.key));
  return (
    <div
      className="dops-rise-in absolute right-0 z-30 mt-1 w-52 rounded-md border shadow-lg py-1.5"
      style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
    >
      <div className="px-3 py-1 text-[10.5px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {view === "table" ? "Show as columns" : "Show on cards"}
      </div>
      <div className="max-h-64 overflow-auto">
        {universe.map((def) => (
          <button key={def.key} type="button" onClick={() => onToggle(def.key)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)]">
            <span
              className="w-[13px] h-[13px] rounded-[3.5px] border flex items-center justify-center shrink-0"
              style={{ borderColor: "var(--glass-border)", background: active.includes(def.key) ? "var(--brand-yellow)" : "transparent" }}
            >
              {active.includes(def.key) ? <span style={{ color: "#171717", fontSize: 9 }}>✓</span> : null}
            </span>
            {def.label}
          </button>
        ))}
      </div>
      {view === "table" && hasCustomWidths ? (
        <button type="button" onClick={onResetWidths} className="w-full text-left px-3 py-1.5 text-[11.5px] border-t text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]" style={{ borderColor: "var(--glass-border)" }}>
          Reset column widths
        </button>
      ) : null}
    </div>
  );
}
