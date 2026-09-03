"use client";

// The primary editing surface for the merged Delivery workspace. Every cell
// edits inline and fires the same PATCH the detail panel uses, so table and
// panel never diverge. Columns drag-reorder (header label) and drag-resize
// (header-edge handle), widths stored per wide/narrow variant so a wide-table
// drag can never leak into the narrow split-panel set. Sort cycles
// asc -> desc -> off on header click. Process + checkbox are sticky left;
// actions are sticky right; the header is sticky top over a real scrollport.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Delivery workspace
// panel (table view).
//
// Cell controls go through .dops-chip / .dops-field (app/globals.css) rather
// than inline colours: the global `.dark select/input` override uses
// !important, which beats a React inline style and would otherwise flatten
// every hue-coloured chip and every flat cell to the same grey.

import { useEffect, useRef, useState } from "react";
import type { Process, RosterEntry } from "@/lib/supabase/types";
import {
  MIGRATION_STAGES,
  PROCESS_HEALTHS,
  PROCESS_LIFECYCLES,
  PROCESS_PHASES,
  PROCESS_PLATFORMS,
} from "@/lib/supabase/types";
import { COLDEF_BY_KEY, formatMoney, staleDays, type ColKey } from "@/lib/delivery/columns";
import { chipVars, resolveHue, type ColorMap } from "@/lib/delivery/hues";
import {
  HEALTH_LABELS,
  LIFECYCLE_LABELS,
  MIGRATION_STAGE_LABELS,
  PHASE_LABELS,
  PLATFORM_LABELS,
} from "@/lib/delivery/labels";
import { RosterPicker } from "@/app/_components/roster-picker";
import type { DetailProcess } from "@/app/_components/process-detail";

const CHECK_W = 34;
const ACTIONS_W_WIDE = 66;
const ACTIONS_W_NARROW = 44;
const NAME_W_WIDE = 260;
const NAME_W_NARROW = 220;
const MIN_COL_W = 56;

function prefixFor(narrow: boolean): string {
  return narrow ? "n:" : "w:";
}

function widthFor(key: ColKey, narrow: boolean, colW: Record<string, number>): number {
  const def = COLDEF_BY_KEY[key];
  const custom = colW[`${prefixFor(narrow)}${key}`];
  if (custom) return custom;
  return (narrow && def.narrowW) || def.wideW;
}

function nameWidthFor(narrow: boolean, colW: Record<string, number>): number {
  return colW[`${prefixFor(narrow)}name`] || (narrow ? NAME_W_NARROW : NAME_W_WIDE);
}

export interface ProcessTableProps {
  rows: DetailProcess[];
  cols: ColKey[];
  colW: Record<string, number>;
  onColWChange: (storageKey: string, px: number) => void;
  onReorderCol: (from: ColKey, to: ColKey) => void;
  narrow: boolean;
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  openId: string | null;
  onOpenDetail: (id: string) => void;
  customerOptions: { id: string; display_name: string }[];
  sortKey: ColKey | null;
  sortDir: "asc" | "desc";
  onSort: (key: ColKey) => void;
  colorMap: ColorMap;
  onSave: (id: string, patch: Partial<Process>) => Promise<Process>;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  showRestore: boolean;
  emptyTitle: string;
  emptyHint: string;
  /** Provided only when filters/search are actually narrowing the list. */
  onClearFilters?: () => void;
}

export function ProcessTable({
  rows,
  cols,
  colW,
  onColWChange,
  onReorderCol,
  narrow,
  selected,
  onSelectionChange,
  openId,
  onOpenDetail,
  customerOptions,
  sortKey,
  sortDir,
  onSort,
  colorMap,
  onSave,
  onArchive,
  onRestore,
  showRestore,
  emptyTitle,
  emptyHint,
  onClearFilters,
}: ProcessTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<string>("70vh");
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<ColKey | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number; up: boolean } | null>(null);

  // The page is document-scrolled, so a fixed `calc(100vh - 200px)` either
  // left the table extending below the fold (two scrollbars, and the sticky
  // header scrolled out of view while rows were still visible) or wasted
  // space. Measure the real distance from the top of the table instead.
  useEffect(() => {
    function measure() {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - Math.max(0, top - window.scrollY) - 24;
      setMaxH(`${Math.max(320, available)}px`);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [narrow, cols.length]);

  useEffect(() => {
    if (!menuFor) return;
    function close() {
      setMenuFor(null);
    }
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuFor]);

  const nameW = nameWidthFor(narrow, colW);
  const actionsW = narrow ? ACTIONS_W_NARROW : ACTIONS_W_WIDE;
  const colWidths = cols.map((k) => widthFor(k, narrow, colW));
  const gridTemplate = `${CHECK_W}px ${nameW}px ${colWidths.map((w) => `${w}px`).join(" ")} ${actionsW}px`;
  const minWidth = CHECK_W + nameW + colWidths.reduce((a, b) => a + b, 0) + actionsW;

  // Resizing stays available in the narrow (split-panel) variant — that's the
  // whole reason widths are stored under a separate `n:` prefix. Only the cap
  // differs, since the scrollport itself is narrower there.
  function startResize(e: React.MouseEvent, key: string, startW: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const cap = scrollRef.current ? Math.max(240, scrollRef.current.clientWidth - 140) : 2000;
    function onMove(ev: MouseEvent) {
      const next = Math.min(cap, Math.max(MIN_COL_W, startW + (ev.clientX - startX)));
      onColWChange(`${prefixFor(narrow)}${key}`, next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleRow(id: string, shift: boolean) {
    const next = new Set(selected);
    if (shift && lastChecked) {
      const ids = rows.map((r) => r.id);
      const a = ids.indexOf(lastChecked);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
        onSelectionChange(next);
        return;
      }
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLastChecked(id);
    onSelectionChange(next);
  }

  function openMenu(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const up = rect.bottom + 140 > window.innerHeight;
    setMenuFor({ id, x: Math.max(8, rect.right - 160), y: up ? rect.top - 4 : rect.bottom + 4, up });
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  // Union/difference over the *visible* rows, so toggling select-all while a
  // filter is active can't silently drop a selection made before it.
  function toggleAll() {
    const next = new Set(selected);
    if (allSelected) rows.forEach((r) => next.delete(r.id));
    else rows.forEach((r) => next.add(r.id));
    onSelectionChange(next);
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="rounded-xl border overflow-auto relative"
        style={{ borderColor: "var(--brand-metal-line)", background: "var(--surface-1, var(--card))", maxHeight: maxH }}
      >
        <div style={{ minWidth }}>
        {/* Header */}
        <div
          className="grid sticky top-0 z-20 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]"
          style={{ gridTemplateColumns: gridTemplate, background: "var(--surface-2, var(--muted))", borderBottom: "1px solid var(--brand-metal-line)" }}
        >
          <div className="sticky left-0 z-10 flex items-center justify-center" style={{ background: "inherit" }}>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && someSelected;
              }}
              onChange={toggleAll}
              aria-label={allSelected ? "Clear selection" : "Select all rows"}
              title={allSelected ? "Clear selection" : "Select all"}
              style={{ accentColor: "var(--brand-yellow)" }}
            />
          </div>
          <div className="sticky z-10 relative flex items-center px-2 py-2" style={{ left: CHECK_W, background: "inherit" }}>
            Process
            <ResizeHandle onMouseDown={(e) => startResize(e, "name", nameW)} />
          </div>
          {cols.map((key, i) => {
            const def = COLDEF_BY_KEY[key];
            const active = sortKey === key;
            return (
              <div
                key={key}
                draggable={!narrow}
                onDragStart={() => setDragCol(key)}
                onDragEnd={() => setDragCol(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragCol && dragCol !== key) onReorderCol(dragCol, key);
                  setDragCol(null);
                }}
                className={`relative flex items-center px-2 py-2 select-none ${narrow ? "" : "cursor-grab"}`}
              >
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className={`inline-flex items-center gap-1 hover:text-[color:var(--foreground)] truncate ${active ? "text-[color:var(--foreground)]" : ""}`}
                >
                  <span className="truncate">{def.label}</span>
                  {active ? <span className="text-[9px] opacity-90">{sortDir === "asc" ? "↑" : "↓"}</span> : null}
                </button>
                <ResizeHandle onMouseDown={(e) => startResize(e, key, colWidths[i])} />
              </div>
            );
          })}
          <div className="sticky right-0 z-10" style={{ background: "inherit" }} />
        </div>

        {/* Rows */}
        {rows.map((row, i) => {
          const isOpen = row.id === openId;
          const isSelected = selected.has(row.id);
          const stickyBg = isOpen
            ? "var(--row-open-bg)"
            : isSelected
              ? "var(--row-selected-bg)"
              : "var(--surface-1, var(--card))";
          return (
            <div
              key={row.id}
              className={`dops-row-in dops-row grid text-sm ${isOpen || isSelected ? "" : "dops-row-plain"}`}
              style={
                {
                  gridTemplateColumns: gridTemplate,
                  animationDelay: `${Math.min(i, 14) * 22}ms`,
                  borderBottom: "1px solid var(--brand-metal-line)",
                  "--row-bg": stickyBg,
                  background: "var(--row-bg)",
                } as React.CSSProperties
              }
            >
              <div className="sticky left-0 z-10 flex items-center justify-center py-1.5" style={{ background: "var(--row-bg)" }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => toggleRow(row.id, (e.nativeEvent as MouseEvent).shiftKey)}
                  aria-label={`Select ${row.process_name}`}
                  style={{ accentColor: "var(--brand-yellow)" }}
                />
              </div>
              <div className="sticky z-10 py-1.5 pr-2 min-w-0" style={{ left: CHECK_W, background: "var(--row-bg)" }}>
                <NameCell row={row} onSave={onSave} onOpenDetail={onOpenDetail} />
              </div>
              {cols.map((key) => (
                <div key={key} className="flex items-center px-2 py-1.5 min-w-0">
                  <Cell colKey={key} row={row} customerOptions={customerOptions} colorMap={colorMap} onSave={onSave} onOpenDetail={onOpenDetail} />
                </div>
              ))}
              <div className="sticky right-0 z-10 flex items-center justify-center gap-0.5 py-1.5" style={{ background: "var(--row-bg)" }}>
                {!narrow ? (
                  <button
                    type="button"
                    title="Open full record"
                    onClick={() => onOpenDetail(row.id)}
                    className="dops-press w-6 h-6 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                  >
                    ⤢
                  </button>
                ) : null}
                <button
                  type="button"
                  title="More actions"
                  onClick={(e) => openMenu(e, row.id)}
                  className="dops-press w-6 h-6 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                >
                  ⋮
                </button>
              </div>
            </div>
          );
        })}


        </div>
        {/* Outside the min-width wrapper: inside it, `text-center` centred
            the message across the full ~1600px column total, leaving it half
            off-screen until you scrolled sideways. */}
        {rows.length === 0 ? (
          <div className="sticky left-0 px-6 py-12 text-center">
            <div className="text-[13px] text-[color:var(--foreground)]">{emptyTitle}</div>
            <div className="text-[12px] text-[color:var(--muted-foreground)] mt-1">{emptyHint}</div>
            {onClearFilters ? (
              <button
                type="button"
                onClick={onClearFilters}
                className="dops-press mt-3 rounded-full border px-3 py-1.5 text-[12px]"
                style={{ borderColor: "var(--brand-metal-line)" }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Rendered outside the scrollport on purpose: a position:fixed menu
          nested inside an overflow:auto ancestor gets clipped once the table
          is scrolled. */}
      {menuFor
        ? (() => {
            const row = rows.find((r) => r.id === menuFor.id);
            if (!row) return null;
            return (
              <div
                className="dops-rise-in fixed z-50 w-40 rounded-md border shadow-lg py-1 text-[12.5px]"
                style={{
                  left: menuFor.x,
                  top: menuFor.up ? Math.max(8, menuFor.y - 120) : Math.min(menuFor.y, window.innerHeight - 158),
                  background: "var(--surface-3, var(--card))",
                  borderColor: "var(--brand-metal-line)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button type="button" onClick={() => { onOpenDetail(row.id); setMenuFor(null); }} className="w-full text-left px-3 py-1.5 hover:bg-[var(--glass-bg)]">
                  Open record
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/processes/${row.id}`);
                    setMenuFor(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--glass-bg)]"
                >
                  Copy link
                </button>
                {showRestore ? (
                  <button type="button" onClick={() => { onRestore(row.id); setMenuFor(null); }} className="w-full text-left px-3 py-1.5 hover:bg-[var(--glass-bg)]">
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { onArchive(row.id); setMenuFor(null); }}
                    className="w-full text-left px-3 py-1.5 text-red-500 hover:bg-red-500/10"
                  >
                    Archive
                  </button>
                )}
              </div>
            );
          })()
        : null}
    </>
  );
}

/** 12px invisible hit-zone on a header cell's right edge. z-index keeps it
 *  above the neighbouring cell's content so the grab target never gets
 *  covered at a column boundary. */
function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onDragStart={(e) => e.preventDefault()}
      className="absolute right-0 top-0 bottom-0 w-3 z-20 cursor-col-resize hover:bg-[var(--yellow-line)]"
      title="Drag to resize"
    />
  );
}

function NameCell({
  row,
  onSave,
  onOpenDetail,
}: {
  row: DetailProcess;
  onSave: (id: string, patch: Partial<Process>) => Promise<Process>;
  onOpenDetail: (id: string) => void;
}) {
  const [draft, setDraft] = useState(row.process_name);
  const [flashed, setFlashed] = useState(false);
  useEffect(() => setDraft(row.process_name), [row.process_name]);

  async function commit() {
    if (!draft.trim() || draft === row.process_name) {
      setDraft(row.process_name);
      return;
    }
    try {
      await onSave(row.id, { process_name: draft.trim() });
      setFlashed(true);
      setTimeout(() => setFlashed(false), 1200);
    } catch {
      // Revert rather than keep showing a name the database never accepted.
      // The error itself is surfaced by the page-level handler.
      setDraft(row.process_name);
    }
  }

  return (
    <div className="min-w-0">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={`dops-field font-medium truncate ${flashed ? "dops-field-saved" : ""}`}
        title={row.process_name}
      />
      {row.blockers ? (
        <button
          type="button"
          onClick={() => onOpenDetail(row.id)}
          title={row.blockers}
          className="flex items-center gap-1 text-[10.5px] truncate max-w-full text-left px-1"
          style={{ color: "var(--status-bad)" }}
        >
          <span className="shrink-0">⚑</span>
          <span className="truncate">{row.blockers}</span>
          <span className="shrink-0 text-[color:var(--muted-foreground)]">· blocker note</span>
        </button>
      ) : null}
    </div>
  );
}

function Cell({
  colKey,
  row,
  customerOptions,
  colorMap,
  onSave,
  onOpenDetail,
}: {
  colKey: ColKey;
  row: DetailProcess;
  customerOptions: { id: string; display_name: string }[];
  colorMap: ColorMap;
  onSave: (id: string, patch: Partial<Process>) => Promise<Process>;
  onOpenDetail: (id: string) => void;
}) {
  const [flashed, setFlashed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  // `revision` remounts the uncontrolled (defaultValue) inputs after a failed
  // save so they snap back to the stored value instead of displaying an edit
  // that never persisted.
  async function save(patch: Partial<Process>) {
    setBusy(true);
    try {
      await onSave(row.id, patch);
      setFlashed(true);
      setTimeout(() => setFlashed(false), 1200);
    } catch {
      setRevision((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const field = `dops-field ${flashed ? "dops-field-saved" : ""}`;
  const chip = `dops-chip ${flashed ? "dops-chip-saved" : ""}`;

  switch (colKey) {
    case "customer":
      return (
        <select disabled={busy} value={row.customer_id ?? ""} onChange={(e) => save({ customer_id: e.target.value || null })} className={`${field} text-[13px]`}>
          <option value="">—</option>
          {customerOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </select>
      );
    case "stage":
      return (
        <select
          disabled={busy}
          value={row.migration_stage}
          onChange={(e) => save({ migration_stage: e.target.value as Process["migration_stage"] })}
          className={chip}
          style={chipVars(resolveHue("stage", row.migration_stage, colorMap))}
        >
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "lifecycle":
      return (
        <select disabled={busy} value={row.lifecycle} onChange={(e) => save({ lifecycle: e.target.value as Process["lifecycle"] })} className={`${field} text-[13px]`}>
          {LIFECYCLE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {LIFECYCLE_LABELS[o]}
            </option>
          ))}
        </select>
      );
    case "phase":
      return (
        <select disabled={busy} value={row.phase ?? ""} onChange={(e) => save({ phase: (e.target.value || null) as Process["phase"] })} className={`${field} text-[13px]`}>
          <option value="">—</option>
          {PHASE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {PHASE_LABELS[o]}
            </option>
          ))}
        </select>
      );
    case "health":
      if (!row.health) {
        return (
          <select disabled={busy} value="" onChange={(e) => save({ health: e.target.value as Process["health"] })} className={`${field} text-[13px]`}>
            <option value="">—</option>
            {HEALTH_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {HEALTH_LABELS[o]}
              </option>
            ))}
          </select>
        );
      }
      return (
        <select
          disabled={busy}
          value={row.health}
          onChange={(e) => save({ health: e.target.value as Process["health"] })}
          className={chip}
          style={chipVars(resolveHue("health", row.health, colorMap))}
        >
          {HEALTH_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {HEALTH_LABELS[o]}
            </option>
          ))}
        </select>
      );
    case "platform":
      return (
        <select disabled={busy} value={row.platform} onChange={(e) => save({ platform: e.target.value as Process["platform"] })} className={`${field} text-[13px]`}>
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {PLATFORM_LABELS[o]}
            </option>
          ))}
        </select>
      );
    case "owner":
      return (
        <RosterPicker kind="person" role="fde" dense valueLabel={row.fde_owner} onPick={(entry: RosterEntry) => save({ fde_owner_id: entry.id })} onClear={() => save({ fde_owner_id: null })} />
      );
    case "tam":
      return (
        <RosterPicker kind="person" role="tam" dense valueLabel={row.tam_owner} onPick={(entry: RosterEntry) => save({ tam_owner_id: entry.id })} onClear={() => save({ tam_owner_id: null })} />
      );
    case "partner":
      return (
        <RosterPicker kind="partner_org" dense valueLabel={row.partner} onPick={(entry: RosterEntry) => save({ partner_id: entry.id })} onClear={() => save({ partner_id: null })} />
      );
    case "pct": {
      const pct = row.completion_pct != null ? Math.round(row.completion_pct * 100) : null;
      return (
        <div className="w-full">
          <input
            key={`${row.id}-pct-${row.completion_pct ?? "x"}-${revision}`}
            disabled={busy}
            type="number"
            defaultValue={pct ?? ""}
            onBlur={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value) / 100;
              if (v !== row.completion_pct) save({ completion_pct: v });
            }}
            className={`${field} text-right font-mono text-[13px]`}
          />
          <div className="h-[3px] rounded-full mt-0.5 mx-1" style={{ background: "var(--brand-metal-line)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${pct ?? 0}%`, background: pct === 100 ? "var(--status-good)" : "var(--yellow-ink)", transition: "width 420ms cubic-bezier(.2,.8,.3,1)" }}
            />
          </div>
        </div>
      );
    }
    case "arr":
      return (
        <input
          key={`${row.id}-arr-${row.arr ?? "x"}-${revision}`}
          disabled={busy}
          type="number"
          defaultValue={row.arr ?? ""}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            if (v !== row.arr) save({ arr: v });
          }}
          title={formatMoney(row.arr)}
          className={`${field} text-right font-mono text-[13px]`}
        />
      );
    case "effort":
      return (
        <input
          key={`${row.id}-effort-${row.total_effort_hours ?? "x"}-${revision}`}
          disabled={busy}
          type="number"
          defaultValue={row.total_effort_hours ?? ""}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            if (v !== row.total_effort_hours) save({ total_effort_hours: v });
          }}
          className={`${field} text-right font-mono text-[13px]`}
        />
      );
    case "kickoff":
      return (
        <input
          key={`${row.id}-kickoff-${row.kickoff_date ?? "x"}-${revision}`}
          disabled={busy}
          type="date"
          defaultValue={row.kickoff_date ?? ""}
          onBlur={(e) => {
            const v = e.target.value || null;
            if (v !== row.kickoff_date) save({ kickoff_date: v });
          }}
          className={`${field} font-mono text-[12.5px]`}
        />
      );
    case "golive":
      return (
        <input
          key={`${row.id}-golive-${row.go_live_date ?? "x"}-${revision}`}
          disabled={busy}
          type="date"
          defaultValue={row.go_live_date ?? ""}
          onBlur={(e) => {
            const v = e.target.value || null;
            if (v !== row.go_live_date) save({ go_live_date: v });
          }}
          className={`${field} font-mono text-[12.5px] font-medium`}
        />
      );
    case "tickets":
      return (
        <button
          type="button"
          onClick={() => onOpenDetail(row.id)}
          className="text-[11px] px-1.5 py-0.5 rounded border text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:border-[color:var(--brand-yellow)]"
          style={{ borderColor: "var(--brand-metal-line)" }}
        >
          {row.linear_ticket_ids.length > 0 ? `${row.linear_ticket_ids.length} tix` : "attach"}
        </button>
      );
    case "stale": {
      const days = staleDays(row.updated_at);
      const color = days > 30 ? "var(--status-bad)" : days > 14 ? "var(--status-warn)" : "var(--muted-foreground)";
      return (
        <span className="text-[12.5px] font-mono px-1" style={{ color }}>
          {days}d
        </span>
      );
    }
    default:
      return null;
  }
}

// Derived from the enum + shared labels rather than a hand-kept copy, so a
// new stage can't silently render as a blank option.
const STAGE_OPTIONS: { value: Process["migration_stage"]; label: string }[] = MIGRATION_STAGES.map((value) => ({
  value,
  label: MIGRATION_STAGE_LABELS[value],
}));

const LIFECYCLE_OPTIONS = PROCESS_LIFECYCLES;
const PHASE_OPTIONS = PROCESS_PHASES;
const HEALTH_OPTIONS = PROCESS_HEALTHS;
const PLATFORM_OPTIONS = PROCESS_PLATFORMS;
