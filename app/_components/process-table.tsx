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

import { useEffect, useMemo, useRef, useState } from "react";
import type { Process, RosterEntry } from "@/lib/supabase/types";
import { COLDEF_BY_KEY, formatMoney, staleDays, type ColKey } from "@/lib/delivery/columns";
import { resolveHue, type ColorMap } from "@/lib/delivery/hues";
import { RosterPicker } from "@/app/_components/roster-picker";
import type { DetailProcess } from "@/app/_components/process-detail";

const CHECK_W = 34;
const ACTIONS_W_WIDE = 66;
const ACTIONS_W_NARROW = 44;

function widthFor(key: ColKey, narrow: boolean, colW: Record<string, number>): number {
  const def = COLDEF_BY_KEY[key];
  const prefix = narrow ? "n:" : "w:";
  const custom = colW[`${prefix}${key}`];
  if (custom) return custom;
  return (narrow && def.narrowW) || def.wideW;
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
}: ProcessTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<ColKey | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number; up: boolean } | null>(null);

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

  const nameW = narrow ? 220 : 260;
  const actionsW = narrow ? ACTIONS_W_NARROW : ACTIONS_W_WIDE;
  const colWidths = cols.map((k) => widthFor(k, narrow, colW));
  const gridTemplate = `${CHECK_W}px ${nameW}px ${colWidths.map((w) => `${w}px`).join(" ")} ${actionsW}px`;
  const minWidth = CHECK_W + nameW + colWidths.reduce((a, b) => a + b, 0) + actionsW;

  function startResize(e: React.MouseEvent, key: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthFor(key, narrow, colW);
    const cap = scrollRef.current ? Math.max(200, scrollRef.current.clientWidth - 140) : 2000;
    function onMove(ev: MouseEvent) {
      const next = Math.min(cap, Math.max(56, startW + (ev.clientX - startX)));
      onColWChange(`${narrow ? "n:" : "w:"}${key}`, next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
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
    setMenuFor({ id, x: rect.right - 160, y: up ? rect.top - 4 : rect.bottom + 4, up });
  }

  return (
    <div
      ref={scrollRef}
      className="rounded-xl border overflow-auto relative"
      style={{ borderColor: "var(--glass-border)", background: "var(--surface-1, var(--card))", maxHeight: "calc(100vh - 200px)" }}
    >
      <div style={{ minWidth }}>
        {/* Header */}
        <div
          className="grid sticky top-0 z-20 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]"
          style={{ gridTemplateColumns: gridTemplate, background: "var(--surface-2, var(--muted))", borderBottom: "1px solid var(--glass-border)" }}
        >
          <div className="sticky left-0 z-10 flex items-center justify-center" style={{ background: "inherit" }} />
          <div className="sticky z-10 flex items-center px-2 py-2" style={{ left: CHECK_W, background: "inherit" }}>
            Process
          </div>
          {cols.map((key) => {
            const def = COLDEF_BY_KEY[key];
            const active = sortKey === key;
            return (
              <div
                key={key}
                draggable={!narrow}
                onDragStart={() => setDragCol(key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragCol && dragCol !== key) onReorderCol(dragCol, key);
                  setDragCol(null);
                }}
                className="relative flex items-center px-2 py-2 cursor-grab select-none"
              >
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className={`inline-flex items-center gap-1 hover:text-[color:var(--foreground)] truncate ${active ? "text-[color:var(--foreground)]" : ""}`}
                >
                  <span className="truncate">{def.label}</span>
                  {active ? <span className="text-[9px] opacity-90">{sortDir === "asc" ? "↑" : "↓"}</span> : null}
                </button>
                {!narrow ? (
                  <div
                    onMouseDown={(e) => startResize(e, key)}
                    className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-[rgba(242,255,112,0.25)]"
                  />
                ) : null}
              </div>
            );
          })}
          <div className="sticky right-0 z-10" style={{ background: "inherit" }} />
        </div>

        {/* Rows */}
        {rows.map((row, i) => {
          const isOpen = row.id === openId;
          const isSelected = selected.has(row.id);
          const stickyBg = isOpen ? "var(--row-open-bg)" : isSelected ? "rgba(242,255,112,0.08)" : "var(--surface-1, var(--card))";
          return (
            <div
              key={row.id}
              className="dops-row-in grid text-sm"
              style={{
                gridTemplateColumns: gridTemplate,
                animationDelay: `${Math.min(i, 14) * 22}ms`,
                borderBottom: "1px solid var(--glass-border)",
                background: stickyBg,
              }}
            >
              <div className="sticky left-0 z-10 flex items-center justify-center py-1.5" style={{ background: stickyBg }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => toggleRow(row.id, (e.nativeEvent as MouseEvent).shiftKey)}
                  style={{ accentColor: "var(--brand-yellow)" }}
                />
              </div>
              <div className="sticky z-10 py-1.5 pr-2 min-w-0" style={{ left: CHECK_W, background: stickyBg }}>
                <NameCell row={row} onSave={onSave} />
              </div>
              {cols.map((key) => (
                <div key={key} className="flex items-center px-2 py-1.5 min-w-0">
                  <Cell colKey={key} row={row} customerOptions={customerOptions} colorMap={colorMap} onSave={onSave} onOpenDetail={onOpenDetail} />
                </div>
              ))}
              <div className="sticky right-0 z-10 flex items-center justify-center gap-0.5 py-1.5" style={{ background: stickyBg }}>
                {!narrow ? (
                  <button
                    type="button"
                    title="Open full record"
                    onClick={() => onOpenDetail(row.id)}
                    className="w-6 h-6 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                  >
                    ⤢
                  </button>
                ) : null}
                <button
                  type="button"
                  title="More actions"
                  onClick={(e) => openMenu(e, row.id)}
                  className="w-6 h-6 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                >
                  ⋮
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {menuFor
        ? (() => {
            const row = rows.find((r) => r.id === menuFor.id);
            if (!row) return null;
            return (
              <div
                className="dops-rise-in fixed z-50 w-40 rounded-md border shadow-lg py-1 text-[12.5px]"
                style={{ left: menuFor.x, top: menuFor.up ? menuFor.y - 120 : menuFor.y, background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
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
    </div>
  );
}

function NameCell({ row, onSave }: { row: DetailProcess; onSave: (id: string, patch: Partial<Process>) => Promise<Process> }) {
  const [draft, setDraft] = useState(row.process_name);
  useEffect(() => setDraft(row.process_name), [row.process_name]);
  return (
    <div className="min-w-0">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && draft !== row.process_name && onSave(row.id, { process_name: draft.trim() })}
        className="w-full bg-transparent font-medium text-[color:var(--foreground)] truncate focus:outline-none"
        title={row.process_name}
      />
      {row.blockers ? (
        <button
          type="button"
          title={row.blockers}
          className="flex items-center gap-1 text-[10.5px] truncate max-w-full text-left"
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

  async function save(patch: Partial<Process>) {
    setBusy(true);
    try {
      await onSave(row.id, patch);
      setFlashed(true);
      setTimeout(() => setFlashed(false), 1200);
    } finally {
      setBusy(false);
    }
  }

  const borderStyle = { border: flashed ? "1px solid rgba(242,255,112,0.55)" : "1px solid transparent" };

  switch (colKey) {
    case "customer":
      return (
        <select
          disabled={busy}
          value={row.customer_id ?? ""}
          onChange={(e) => save({ customer_id: e.target.value || null })}
          className="w-full bg-transparent text-[13px] text-[color:var(--foreground)] rounded px-1 focus:outline-none hover:bg-[var(--glass-bg)]"
          style={borderStyle}
        >
          <option value="">—</option>
          {customerOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </select>
      );
    case "stage": {
      const hue = resolveHue("stage", row.migration_stage, colorMap);
      return (
        <select
          disabled={busy}
          value={row.migration_stage}
          onChange={(e) => save({ migration_stage: e.target.value as Process["migration_stage"] })}
          className="w-full text-[11px] font-medium rounded px-1.5 py-0.5 focus:outline-none"
          style={{ color: `var(--st-${hue}-fg)`, background: `var(--st-${hue}-bg)`, border: `1px solid var(--st-${hue}-bd)` }}
        >
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "lifecycle":
      return (
        <select
          disabled={busy}
          value={row.lifecycle}
          onChange={(e) => save({ lifecycle: e.target.value as Process["lifecycle"] })}
          className="w-full bg-transparent text-[13px] text-[color:var(--foreground)] rounded px-1 focus:outline-none hover:bg-[var(--glass-bg)]"
          style={borderStyle}
        >
          {LIFECYCLE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      );
    case "phase":
      return (
        <select
          disabled={busy}
          value={row.phase ?? ""}
          onChange={(e) => save({ phase: (e.target.value || null) as Process["phase"] })}
          className="w-full bg-transparent text-[13px] text-[color:var(--muted-foreground)] rounded px-1 focus:outline-none hover:bg-[var(--glass-bg)]"
          style={borderStyle}
        >
          <option value="">—</option>
          {PHASE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      );
    case "health": {
      if (!row.health) {
        return (
          <select
            disabled={busy}
            value=""
            onChange={(e) => save({ health: e.target.value as Process["health"] })}
            className="w-full bg-transparent text-[13px] text-[color:var(--muted-foreground)] rounded px-1 focus:outline-none hover:bg-[var(--glass-bg)]"
            style={borderStyle}
          >
            <option value="">—</option>
            {HEALTH_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        );
      }
      const hue = resolveHue("health", row.health, colorMap);
      return (
        <select
          disabled={busy}
          value={row.health}
          onChange={(e) => save({ health: e.target.value as Process["health"] })}
          className="w-full text-[11px] font-medium rounded px-1.5 py-0.5 focus:outline-none"
          style={{ color: `var(--st-${hue}-fg)`, background: `var(--st-${hue}-bg)`, border: `1px solid var(--st-${hue}-bd)` }}
        >
          {HEALTH_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      );
    }
    case "platform":
      return (
        <select
          disabled={busy}
          value={row.platform}
          onChange={(e) => save({ platform: e.target.value as Process["platform"] })}
          className="w-full bg-transparent text-[13px] text-[color:var(--foreground)] rounded px-1 focus:outline-none hover:bg-[var(--glass-bg)]"
          style={borderStyle}
        >
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o.toUpperCase()}
            </option>
          ))}
        </select>
      );
    case "owner":
      return (
        <RosterPicker
          kind="person"
          role="fde"
          dense
          valueLabel={row.fde_owner}
          onPick={(entry: RosterEntry) => save({ fde_owner_id: entry.id })}
          onClear={() => save({ fde_owner_id: null })}
        />
      );
    case "tam":
      return (
        <RosterPicker
          kind="person"
          role="tam"
          dense
          valueLabel={row.tam_owner}
          onPick={(entry: RosterEntry) => save({ tam_owner_id: entry.id })}
          onClear={() => save({ tam_owner_id: null })}
        />
      );
    case "partner":
      return (
        <RosterPicker
          kind="partner_org"
          dense
          valueLabel={row.partner}
          onPick={(entry: RosterEntry) => save({ partner_id: entry.id })}
          onClear={() => save({ partner_id: null })}
        />
      );
    case "pct": {
      const pct = row.completion_pct != null ? Math.round(row.completion_pct * 100) : null;
      return (
        <div className="w-full">
          <input
            disabled={busy}
            type="number"
            defaultValue={pct ?? ""}
            onBlur={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value) / 100;
              if (v !== row.completion_pct) save({ completion_pct: v });
            }}
            className="w-full bg-transparent text-right font-mono text-[13px] text-[color:var(--foreground)] rounded px-1 focus:outline-none"
            style={borderStyle}
          />
          <div className="h-[3px] rounded-full mt-0.5" style={{ background: "var(--glass-border)" }}>
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
          disabled={busy}
          type="number"
          defaultValue={row.arr ?? ""}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            if (v !== row.arr) save({ arr: v });
          }}
          title={formatMoney(row.arr)}
          className="w-full bg-transparent text-right font-mono text-[13px] text-[color:var(--foreground)] rounded px-1 focus:outline-none"
          style={borderStyle}
        />
      );
    case "effort":
      return (
        <input
          disabled={busy}
          type="number"
          defaultValue={row.total_effort_hours ?? ""}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            if (v !== row.total_effort_hours) save({ total_effort_hours: v });
          }}
          className="w-full bg-transparent text-right font-mono text-[13px] text-[color:var(--muted-foreground)] rounded px-1 focus:outline-none"
          style={borderStyle}
        />
      );
    case "kickoff":
      return (
        <input
          disabled={busy}
          type="date"
          defaultValue={row.kickoff_date ?? ""}
          onBlur={(e) => {
            const v = e.target.value || null;
            if (v !== row.kickoff_date) save({ kickoff_date: v });
          }}
          className="w-full bg-transparent font-mono text-[12.5px] text-[color:var(--muted-foreground)] rounded px-1 focus:outline-none"
          style={borderStyle}
        />
      );
    case "golive":
      return (
        <input
          disabled={busy}
          type="date"
          defaultValue={row.go_live_date ?? ""}
          onBlur={(e) => {
            const v = e.target.value || null;
            if (v !== row.go_live_date) save({ go_live_date: v });
          }}
          className="w-full bg-transparent font-mono text-[12.5px] font-medium text-[color:var(--foreground)] rounded px-1 focus:outline-none"
          style={borderStyle}
        />
      );
    case "tickets":
      return (
        <button
          type="button"
          onClick={() => onOpenDetail(row.id)}
          className="text-[11px] px-1.5 py-0.5 rounded border text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:border-[color:var(--brand-yellow)]"
          style={{ borderColor: "var(--glass-border)" }}
        >
          {row.linear_ticket_ids.length > 0 ? `${row.linear_ticket_ids.length} tix` : "attach"}
        </button>
      );
    case "stale": {
      const days = staleDays(row.updated_at);
      const color = days > 30 ? "var(--status-bad)" : days > 14 ? "var(--status-warn)" : "var(--muted-foreground)";
      return (
        <span className="text-[12.5px]" style={{ color }}>
          {days}d
        </span>
      );
    }
    default:
      return null;
  }
}

const STAGE_OPTIONS: { value: Process["migration_stage"]; label: string }[] = [
  { value: "not_required", label: "Not required" },
  { value: "in_development", label: "In development" },
  { value: "engg_pending", label: "Engg pending" },
  { value: "parity_testing", label: "Parity testing" },
  { value: "customer_validation", label: "Customer validation" },
  { value: "live_on_v2", label: "Live on v2" },
  { value: "v2_native", label: "V2 native" },
  { value: "migrated_pending_commercial", label: "Migrated, pending commercial" },
];

const LIFECYCLE_OPTIONS: Process["lifecycle"][] = [
  "backlog",
  "upcoming",
  "discovery",
  "in_development",
  "uat",
  "live",
  "on_hold",
  "needs_triage",
  "cancelled",
  "churned",
  "retired",
];

const PHASE_OPTIONS: NonNullable<Process["phase"]>[] = [
  "pre_kickoff",
  "m1_discovery",
  "m2_development",
  "m3_testing_uat",
  "m4_deployment",
  "m5_exception_handling",
];

const HEALTH_OPTIONS: NonNullable<Process["health"]>[] = ["on_track", "at_risk", "off_track"];

const PLATFORM_OPTIONS: Process["platform"][] = ["v1", "v2", "custom"];
