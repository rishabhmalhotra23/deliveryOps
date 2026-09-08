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
  PROCESS_PLATFORMS,
} from "@/lib/supabase/types";
import { COLDEF_BY_KEY, formatMoney, minColWidth, staleDays, type ColKey } from "@/lib/delivery/columns";
import { chipVars, resolveHue, type ColorMap } from "@/lib/delivery/hues";
import { vocabLabel, vocabOptions, type VocabMap } from "@/lib/delivery/vocab";
import {
  HEALTH_LABELS,
  LIFECYCLE_LABELS,
  MIGRATION_STAGE_LABELS,
  PLATFORM_LABELS,
} from "@/lib/delivery/labels";
import { RosterPicker } from "@/app/_components/roster-picker";
import { CustomerPicker } from "@/app/_components/customer-picker";
import type { DetailProcess } from "@/app/_components/process-detail";
import { planPositions } from "@/lib/delivery/reorder";

export interface TablePositionWrite {
  id: string;
  table_position: number;
}

/** Table-order wrapper over the shared planPositions() math — the board's
 *  planReorder() is the same call against board_position. See
 *  lib/delivery/reorder.ts for why the two orders need two columns. */
export function planRowReorder(
  rows: DetailProcess[],
  dragged: DetailProcess,
  rawSlot: number | undefined
): TablePositionWrite[] {
  return planPositions(rows, dragged, rawSlot, (r) => r.table_position).map(
    ({ id, position }) => ({ id, table_position: position })
  );
}

// Wide enough for the drag grip and the checkbox side by side. Was 34 (just
// the checkbox) before rows became draggable.
const CHECK_W = 52;
const ACTIONS_W_WIDE = 66;
const ACTIONS_W_NARROW = 44;
const NAME_W_WIDE = 260;
const NAME_W_NARROW = 220;

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
  /** Editable labels/order/retirement for the chip vocabularies (0042). */
  vocab?: VocabMap;
  onSave: (id: string, patch: Partial<Process>) => Promise<Process>;
  /** Commits a hand-dragged row order. Only ever called while `sortKey` is
   *  null — a manual order and a column sort can't both be in effect, so the
   *  grip is disabled whenever a sort is active. */
  onReorderRows: (writes: TablePositionWrite[]) => Promise<void>;
  /** Set false where this table renders a SUBSET of the list rather than all
   *  of it — Historical's per-quarter groups. `table_position` is one global
   *  sequence, and planRowReorder derives new positions from the rows it can
   *  see, so a drag inside a 12-row quarter group would renumber against
   *  those 12 and silently scramble the flat order that Active work and V2
   *  migration read. A hand order across quarter boundaries has no meaning
   *  anyway. */
  allowRowDrag?: boolean;
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
  vocab = {},
  onSave,
  onReorderRows,
  allowRowDrag = true,
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
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropRowSlot, setDropRowSlot] = useState<number | null>(null);
  // A hand order is only meaningful over the unsorted list; a column sort
  // would immediately override it, so the grip goes inert instead of silently
  // writing positions nobody can see. Same for a table showing a subset —
  // see allowRowDrag.
  const canDragRows = sortKey === null && allowRowDrag;
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

  // Whether rows are hidden below the fold of the INNER scrollport. The
  // measured maxHeight above has a 320px floor, so on a laptop the table
  // routinely showed ~8 of its rows with the rest reachable only by scrolling
  // inside the table — with no scrollbar gutter, no fade and no count, which
  // is what made "the number on top is not same as actual projects" look like
  // a counting bug rather than a clipped viewport. Drives the fade and the
  // row-count footer below.
  const [rowsBelow, setRowsBelow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function check() {
      const node = scrollRef.current;
      if (!node) return;
      // 4px of slack: sub-pixel row heights make scrollHeight exceed
      // clientHeight by a fraction on tables that actually fit.
      setRowsBelow(node.scrollHeight - node.clientHeight > 4);
    }
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxH, rows.length, cols.length, narrow]);

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
  async function commitRowDrop(slot: number) {
    const dragged = rows.find((r) => r.id === dragRow);
    setDragRow(null);
    setDropRowSlot(null);
    if (!dragged) return;
    const writes = planRowReorder(rows, dragged, slot);
    if (writes.length > 0) await onReorderRows(writes);
  }

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
    // Per-column floor. A flat 56px let "Migration stage" shrink to a sliver
    // while "Effort" still had slack. `name` has no ColDef, so it keeps a
    // sensible fixed floor of its own.
    const floor = key === "name" ? 160 : minColWidth(COLDEF_BY_KEY[key as ColKey]);
    function onMove(ev: MouseEvent) {
      const next = Math.min(cap, Math.max(floor, startW + (ev.clientX - startX)));
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
      <div className="relative">
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
                // Was `!narrow`, so column reorder went dead whenever the
                // split panel was open — which is exactly when you most want
                // to move a column into the reduced width.
                draggable
                onDragStart={() => setDragCol(key)}
                onDragEnd={() => setDragCol(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragCol && dragCol !== key) onReorderCol(dragCol, key);
                  setDragCol(null);
                }}
                // `align` was declared on 4 ColDefs and never read — the
                // numeric columns right-aligned their values but left-aligned
                // their headers, so "ARR" sat over empty space with the
                // figures against the far edge. Honoured now rather than
                // deleted from the model.
                className={`relative flex items-center px-2 py-2 select-none cursor-grab ${
                  def.align === "right" ? "justify-end" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className={`inline-flex items-center gap-1 min-w-0 hover:text-[color:var(--foreground)] ${active ? "text-[color:var(--foreground)]" : ""}`}
                >
                  {/* min-w-0 on both: a flex item won't shrink below its text
                      without it, so `truncate` never ellipsized and a narrow
                      column guillotined the header ("Migration stag"). */}
                  <span className="truncate min-w-0">{def.label}</span>
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
              className={`dops-row-in dops-row group/row grid text-sm ${isOpen || isSelected ? "" : "dops-row-plain"} ${
                dragRow === row.id ? "dops-row-dragging" : ""
              }`}
              style={
                {
                  gridTemplateColumns: gridTemplate,
                  animationDelay: `${Math.min(i, 14) * 22}ms`,
                  // The drop indicator is a border rather than an inserted
                  // element: the row is a CSS grid whose column template is
                  // shared with the header, and a full-width marker row would
                  // have to re-declare every column just to draw a 2px line.
                  borderTop:
                    dropRowSlot === i ? "2px solid var(--brand-yellow)" : "2px solid transparent",
                  borderBottom:
                    dropRowSlot === i + 1 && i === rows.length - 1
                      ? "2px solid var(--brand-yellow)"
                      : "1px solid var(--brand-metal-line)",
                  "--row-bg": stickyBg,
                  background: "var(--row-bg)",
                } as React.CSSProperties
              }
              onDragOver={(e) => {
                if (!canDragRows || !dragRow) return;
                e.preventDefault();
                // Above or below the row's midpoint decides which gap the
                // marker shows, so the line always lands where the pointer is.
                const box = e.currentTarget.getBoundingClientRect();
                setDropRowSlot(e.clientY < box.top + box.height / 2 ? i : i + 1);
              }}
              onDrop={(e) => {
                if (!canDragRows || !dragRow) return;
                e.preventDefault();
                void commitRowDrop(dropRowSlot ?? i);
              }}
            >
              <div className="sticky left-0 z-10 flex items-center justify-center gap-0.5 py-1.5" style={{ background: "var(--row-bg)" }}>
                <span
                  draggable={canDragRows}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", row.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragRow(row.id);
                  }}
                  onDragEnd={() => {
                    setDragRow(null);
                    setDropRowSlot(null);
                  }}
                  title={
                    canDragRows
                      ? "Drag to reorder"
                      : allowRowDrag
                        ? "Clear the sort to reorder by hand"
                        : "Rows can't be reordered inside a quarter group"
                  }
                  aria-hidden
                  className={`select-none text-[11px] leading-none tracking-[-1px] transition-opacity ${
                    canDragRows
                      ? "cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-60 hover:!opacity-100"
                      : "cursor-not-allowed opacity-20"
                  }`}
                  style={{ color: "var(--muted-foreground)" }}
                >
                  ⠿
                </span>
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
                // overflow-hidden, not just min-w-0: min-w-0 lets the box
                // shrink but clips nothing, so any control wider than its
                // fixed Npx grid track painted straight over the next
                // column. That was the reported "column width is
                // overlapping with other columns".
                <div key={key} className="flex items-center px-2 py-1.5 min-w-0 overflow-hidden">
                  <Cell colKey={key} row={row} customerOptions={customerOptions} colorMap={colorMap} vocab={vocab} onSave={onSave} onOpenDetail={onOpenDetail} />
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
      {/* Sits outside the scrollport so it doesn't drift with horizontal
          scroll, and only when rows are actually hidden. */}
      {rowsBelow ? (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 bottom-0 h-7 rounded-b-xl"
          style={{ background: "linear-gradient(to bottom, transparent, var(--surface-1, var(--card)))" }}
        />
      ) : null}
      </div>

      {/* Row count, so the section tab's number is always accounted for. The
          tab counts post-filter now, and this says how many of those are on
          screen — the two together mean a mismatch can't be silent. */}
      {rows.length > 0 ? (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[color:var(--muted-foreground)]"
        >
          <span>
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
          {rowsBelow ? (
            <span style={{ marginLeft: "auto", color: "var(--yellow-ink)" }}>
              Scroll inside the table to see the rest ↓
            </span>
          ) : (
            <span style={{ marginLeft: "auto" }}>all shown</span>
          )}
        </div>
      ) : null}

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

/** Invisible hit-zone on a header cell's right edge, straddling the boundary
 *  so it stays grabbable without eating the neighbour.
 *
 *  Was `w-3 z-20 right-0` — 12px sitting entirely inside its own cell and
 *  above the header's own z-10 sticky cells, so it covered the last 12px of
 *  the adjacent header label. Now 8px centred on the boundary (-right-1) and
 *  below the sticky cells. */
function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onDragStart={(e) => e.preventDefault()}
      className="absolute -right-1 top-0 bottom-0 w-2 z-[5] cursor-col-resize hover:bg-[var(--yellow-line)]"
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
  vocab,
  onSave,
  onOpenDetail,
}: {
  colKey: ColKey;
  row: DetailProcess;
  customerOptions: { id: string; display_name: string }[];
  colorMap: ColorMap;
  /** Editable labels/order/retirement for the chip vocabularies (0042). */
  vocab?: VocabMap;
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
        <CustomerPicker
          value={row.customer_id}
          valueLabel={row.customer_display_name}
          options={customerOptions}
          onPick={(id) => save({ customer_id: id })}
          className={`${field} text-[13px]`}
          disabled={busy}
        />
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
          {vocabOptions("stage", MIGRATION_STAGES, vocab, row.migration_stage).map((o) => (
            <option key={o} value={o}>
              {vocabLabel("stage", o, vocab)}
            </option>
          ))}
        </select>
      );
    case "lifecycle":
      // A chip, not a flat field: uncoloured, Discovery / In development /
      // UAT were visually identical, so the column that says where a process
      // actually is read as dead text. Same hue system as stage and health,
      // so Configure -> Colours recolours it too.
      return (
        <select
          disabled={busy}
          value={row.lifecycle}
          onChange={(e) => save({ lifecycle: e.target.value as Process["lifecycle"] })}
          className={chip}
          style={chipVars(resolveHue("lifecycle", row.lifecycle, colorMap))}
        >
          {vocabOptions("lifecycle", PROCESS_LIFECYCLES, vocab, row.lifecycle).map((o) => (
            <option key={o} value={o}>
              {vocabLabel("lifecycle", o, vocab)}
            </option>
          ))}
        </select>
      );
    case "engg":
      return (
        <RosterPicker
          kind="person"
          role="engg"
          dense
          valueLabel={row.engg_owner}
          onPick={(entry: RosterEntry) => save({ engg_owner_id: entry.id })}
          onClear={() => save({ engg_owner_id: null })}
        />
      );
    case "health":
      if (!row.health) {
        return (
          <select disabled={busy} value="" onChange={(e) => save({ health: e.target.value as Process["health"] })} className={`${field} text-[13px]`}>
            <option value="">—</option>
            {vocabOptions("health", PROCESS_HEALTHS, vocab, row.health).map((o) => (
              <option key={o} value={o}>
                {vocabLabel("health", o, vocab)}
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
          {vocabOptions("health", PROCESS_HEALTHS, vocab, row.health).map((o) => (
            <option key={o} value={o}>
              {vocabLabel("health", o, vocab)}
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

const PLATFORM_OPTIONS = PROCESS_PLATFORMS;
