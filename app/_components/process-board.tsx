"use client";

// Drag-and-drop board for both board lenses: Active work's 4 fixed lanes
// (Pipeline/Building/Validating/Stuck, derived from lifecycle+blocked_on —
// there's no separate "lane" column) and V2 migration's 7 stage lanes (a
// direct 1:1 on migration_stage). Dropping into Stuck has no single implied
// lifecycle, so it prompts for the real `blocked_on` reason before saving;
// every other drop commits immediately.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Delivery workspace
// panel (board view).

import { useState } from "react";
import type { Process, ProcessBlockedOn, ProcessLifecycle } from "@/lib/supabase/types";
import { PROCESS_BLOCKED_ON, MIGRATION_STAGES, MIGRATION_STAGE_LABELS } from "@/lib/supabase/types";
import { laneFor, type ActiveLane } from "@/lib/import/monday-taxonomy";
import { byPosition, planPositions } from "@/lib/delivery/reorder";
import { ACTIVE_LANES, ACTIVE_LANE_LABELS } from "@/lib/processes/loader";
import { COLDEF_BY_KEY, formatMoney, staleDays, type ColKey } from "@/lib/delivery/columns";
import { resolveHue, hueStyle, hueDotStyle, type ColorMap, type Hue } from "@/lib/delivery/hues";
import { BLOCKED_ON_LABELS, blockedOnLabel, healthLabel, platformLabel, stageLabel } from "@/lib/delivery/labels";
import type { DetailProcess } from "@/app/_components/process-detail";

// Lane dot colours, verbatim from the approved mockup's DELIVERY_LANES.
// Stuck deliberately uses the semantic status token rather than one of the 8
// chip hues — it isn't a per-value colour and isn't user-recolourable.
const ACTIVE_LANE_HUE: Record<ActiveLane, Hue> = {
  pipeline: "neutral",
  building: "indigo",
  validating: "amber",
  stuck: "red",
};

const ACTIVE_LANE_DOT: Partial<Record<ActiveLane, string>> = {
  stuck: "var(--status-bad)",
};

const ACTIVE_LANE_TO_LIFECYCLE: Record<ActiveLane, ProcessLifecycle> = {
  pipeline: "backlog",
  building: "in_development",
  validating: "uat",
  stuck: "on_hold", // overridden by the blocked_on prompt when a reason is picked
};

interface LaneDef {
  key: string;
  label: string;
  hue: Hue;
  /** Explicit dot colour, when the lane isn't coloured by a chip hue. */
  dot?: string;
  /** Set when a lane can be shown but not dropped into, with the reason. */
  noDrop?: string;
}

export type LaneSort = "manual" | "stale" | "name" | "progress" | "arr" | "health";

export const LANE_SORTS: { key: LaneSort; label: string }[] = [
  { key: "manual", label: "Manual order" },
  { key: "stale", label: "Least recently touched" },
  { key: "name", label: "Process name" },
  { key: "progress", label: "Progress" },
  { key: "arr", label: "ARR" },
  { key: "health", label: "Health" },
];

const HEALTH_RANK: Record<string, number> = { off_track: 0, at_risk: 1, on_track: 2 };

export interface ProcessBoardProps {
  mode: "active" | "v2";
  /** Lane ordering. `manual` respects board_position (drag order); anything
   *  else sorts every lane by that field, since the table's column-header
   *  sort has no equivalent here. */
  laneSort: LaneSort;
  rows: DetailProcess[];
  cardFields: ColKey[];
  colorMap: ColorMap;
  onSave: (id: string, patch: Partial<Process>) => Promise<Process>;
  /** Writes a board_position per row — a reorder needs a different value on
   *  each row, which the single-patch bulk endpoint can't express. */
  onReorder: (writes: PositionWrite[]) => Promise<void>;
  onOpenDetail: (id: string) => void;
  onCreateInLane: (seed: Partial<Process>) => void;
}

function comparatorFor(sort: LaneSort): (a: DetailProcess, b: DetailProcess) => number {
  switch (sort) {
    case "stale":
      return (a, b) => a.updated_at.localeCompare(b.updated_at);
    case "name":
      return (a, b) => a.process_name.localeCompare(b.process_name);
    case "progress":
      return (a, b) => (b.completion_pct ?? -1) - (a.completion_pct ?? -1);
    case "arr":
      return (a, b) => (b.arr ?? -1) - (a.arr ?? -1);
    case "health":
      return (a, b) => (HEALTH_RANK[a.health ?? ""] ?? 9) - (HEALTH_RANK[b.health ?? ""] ?? 9);
    default:
      return byBoardPosition;
  }
}

function bucketRows(
  mode: "active" | "v2",
  rows: DetailProcess[],
  laneSort: LaneSort
): { lanes: LaneDef[]; byLane: Map<string, DetailProcess[]> } {
  const compare = comparatorFor(laneSort);
  if (mode === "active") {
    const lanes: LaneDef[] = ACTIVE_LANES.map((l) => ({
      key: l,
      label: ACTIVE_LANE_LABELS[l],
      hue: ACTIVE_LANE_HUE[l],
      dot: ACTIVE_LANE_DOT[l],
    }));
    const byLane = new Map<string, DetailProcess[]>(lanes.map((l) => [l.key, []]));
    for (const row of rows) {
      const lane = laneFor(row.lifecycle, row.blocked_on);
      if (lane) byLane.get(lane)!.push(row);
    }
    byLane.forEach((laneRows) => laneRows.sort(compare));
    return { lanes, byLane };
  }
  const stages = MIGRATION_STAGES.filter((s) => s !== "not_required");
  const lanes: LaneDef[] = stages.map((s) => ({
    key: s,
    label: MIGRATION_STAGE_LABELS[s],
    hue: resolveHue("stage", s, {}),
    // "V2 native" means built on V2 with nothing migrated, so
    // isV2Relevant() drops rows in it that carry no migration evidence (no
    // tickets, no parity/handover/validation dates). Dropping an
    // evidence-free card here made it disappear from the section entirely
    // on the next refresh — the user's own action deleted it from view.
    noDrop: s === "v2_native" ? "V2 native is for work built on V2, not migrated to it" : undefined,
  }));
  const byLane = new Map<string, DetailProcess[]>(lanes.map((l) => [l.key, []]));
  for (const row of rows) {
    if (byLane.has(row.migration_stage)) byLane.get(row.migration_stage)!.push(row);
  }
  byLane.forEach((laneRows) => laneRows.sort(compare));
  return { lanes, byLane };
}

const byBoardPosition = byPosition<DetailProcess>((r) => r.board_position);

export interface PositionWrite {
  id: string;
  board_position: number;
}

/** Board-lane wrapper over the shared planPositions() math — see
 *  lib/delivery/reorder.ts. Kept as a named export because
 *  tests/delivery/board-reorder.test.ts pins the two off-by-one and
 *  all-null-lane bugs against this exact signature. */
export function planReorder(
  laneRows: DetailProcess[],
  dragged: DetailProcess,
  rawSlot: number | undefined
): PositionWrite[] {
  return planPositions(laneRows, dragged, rawSlot, (r) => r.board_position).map(
    ({ id, position }) => ({ id, board_position: position })
  );
}

export function ProcessBoard({ mode, laneSort, rows, cardFields, colorMap, onSave, onReorder, onOpenDetail, onCreateInLane }: ProcessBoardProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [pendingStuck, setPendingStuck] = useState<{
    id: string;
    boardPosition: number | null;
    extraWrites: PositionWrite[];
  } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<{ lane: string; index: number } | null>(null);
  const [blockedReason, setBlockedReason] = useState<ProcessBlockedOn>("customer");

  const { lanes, byLane } = bucketRows(mode, rows, laneSort);
  // Dragging only makes sense against the order it writes to.
  const canReorder = laneSort === "manual";

  function toggleCollapsed(key: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function commitMove(id: string, laneKey: string, slot?: number) {
    // Only ids that belong to a card actually on this board — a drop carries
    // whatever `text/plain` the drag source set, and dragging e.g. the detail
    // panel's permalink onto a lane would otherwise PATCH a bogus id.
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    const currentLane = mode === "v2" ? row.migration_stage : laneFor(row.lifecycle, row.blocked_on);

    // Same lane => a pure reorder. board_position is bookkeeping, so this
    // deliberately doesn't touch any status field (and migration 0036 keeps
    // it from resetting "Last touched").
    if (currentLane === laneKey) {
      const writes = planReorder(byLane.get(laneKey) ?? [], row, slot);
      if (writes.length > 0) await onReorder(writes);
      return;
    }

    // Crossing lanes: place it where it was dropped, and change the field
    // that actually defines lane membership. The target lane is planned as if
    // the card were already in it, so it lands in the gap you aimed at.
    const writes = planReorder(byLane.get(laneKey) ?? [], row, slot);
    const boardPosition = writes.find((w) => w.id === id)?.board_position ?? null;
    const extraWrites = writes.filter((w) => w.id !== id);

    if (mode === "v2") {
      await onSave(id, {
        migration_stage: laneKey as Process["migration_stage"],
        ...(boardPosition != null ? { board_position: boardPosition } : {}),
      });
      if (extraWrites.length > 0) await onReorder(extraWrites);
      return;
    }

    const lane = laneKey as ActiveLane;
    if (lane === "stuck") {
      setPendingStuck({ id, boardPosition, extraWrites });
      return;
    }
    // The lane -> lifecycle map is lossy: Pipeline holds both backlog and
    // upcoming, Building holds both discovery and in_development. Only rewrite
    // lifecycle when clearing blocked_on wouldn't already land the row in the
    // target lane, so a nudge can't silently downgrade upcoming -> backlog.
    const patch: Partial<Process> = { blocked_on: "none" };
    if (boardPosition != null) patch.board_position = boardPosition;
    if (laneFor(row.lifecycle, "none") !== lane) {
      patch.lifecycle = ACTIVE_LANE_TO_LIFECYCLE[lane];
    }
    await onSave(id, patch);
    if (extraWrites.length > 0) await onReorder(extraWrites);
  }

  async function saveStuckMove() {
    if (!pendingStuck) return;
    const { id, boardPosition, extraWrites } = pendingStuck;
    setPendingStuck(null);
    await onSave(id, {
      blocked_on: blockedReason,
      ...(boardPosition != null ? { board_position: boardPosition } : {}),
    });
    if (extraWrites.length > 0) await onReorder(extraWrites);
  }

  return (
    <div className="flex gap-3 items-start overflow-x-auto pb-2">
      {lanes.map((lane) => {
        const laneRows = byLane.get(lane.key) ?? [];
        const isCollapsed = collapsed.has(lane.key);
        const isDragOver = dragOverLane === lane.key;
        return (
          <div
            key={lane.key}
            className={`dops-lane rounded-xl border transition-[flex-basis] duration-200 shrink-0 ${isDragOver ? "dops-lane-glow" : ""}`}
            style={{
              flexBasis: isCollapsed ? 52 : 268,
              width: isCollapsed ? 52 : 268,
              borderColor: isDragOver ? "var(--brand-yellow)" : "var(--brand-metal-line)",
              background: "var(--surface-1, var(--card))",
            }}
            onDragOver={(e) => {
              if (lane.noDrop) {
                e.dataTransfer.dropEffect = "none";
                return;
              }
              e.preventDefault();
              setDragOverLane(lane.key);
            }}
            onDragLeave={() => setDragOverLane((cur) => (cur === lane.key ? null : cur))}
            onDrop={(e) => {
              if (lane.noDrop) return;
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              const slot = dropSlot?.lane === lane.key ? dropSlot.index : undefined;
              setDragOverLane(null);
              setDropSlot(null);
              setDragging(null);
              if (id) void commitMove(id, lane.key, slot);
            }}
          >
            {isCollapsed ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(lane.key)}
                className="w-full h-full flex flex-col items-center gap-2 py-3"
                title={`${lane.label} (${laneRows.length})`}
              >
                <span className="w-2 h-2 rounded-full" style={lane.dot ? { background: lane.dot } : hueDotStyle(lane.hue)} />
                <span
                  className="text-[11px] font-medium text-[color:var(--foreground)] truncate"
                  style={{ writingMode: "vertical-rl", maxHeight: 180 }}
                >
                  {lane.label}
                </span>
                <span className="text-[10px] text-[color:var(--muted-foreground)] tabular-nums">{laneRows.length}</span>
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5 px-2.5 py-2 border-b" style={{ borderColor: "var(--brand-metal-line)" }}>
                  <button type="button" onClick={() => toggleCollapsed(lane.key)} className="text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
                    ‹
                  </button>
                  <span className="w-2 h-2 rounded-full shrink-0" style={lane.dot ? { background: lane.dot } : hueDotStyle(lane.hue)} />
                  <span className="text-[12.5px] font-semibold tracking-tight text-[color:var(--foreground)] truncate">{lane.label}</span>
                  {lane.noDrop ? (
                    <span
                      title={lane.noDrop}
                      aria-label={lane.noDrop}
                      className="text-[10px] text-[color:var(--muted-foreground)] cursor-help"
                    >
                      ⓘ
                    </span>
                  ) : null}
                  <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums ml-auto">{laneRows.length}</span>
                  {mode === "active" ? (
                    <button
                      type="button"
                      title={`New process in ${lane.label}`}
                      aria-label={`New process in ${lane.label}`}
                      onClick={() => onCreateInLane({ lifecycle: ACTIVE_LANE_TO_LIFECYCLE[lane.key as ActiveLane] })}
                      className="w-5 h-5 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                    >
                      +
                    </button>
                  ) : null}
                </div>
                <div
                  className="p-2 min-h-[80px]"
                  onDragOver={(e) => {
                    // Nothing to place relative to in an empty lane.
                    if (laneRows.length === 0) setDropSlot({ lane: lane.key, index: 0 });
                  }}
                >
                  {laneRows.map((row, i) => (
                    <div
                      key={row.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        // Above or below this card's midpoint decides which
                        // side of it the dragged card lands on.
                        const box = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > box.top + box.height / 2;
                        setDropSlot({ lane: lane.key, index: after ? i + 1 : i });
                      }}
                    >
                      {dropSlot?.lane === lane.key && dropSlot.index === i ? <DropMarker /> : null}
                      <Card
                        row={row}
                        index={i}
                        fields={cardFields}
                        colorMap={colorMap}
                        canDrag={canReorder}
                        dragging={dragging === row.id}
                        onDragStart={() => setDragging(row.id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropSlot(null);
                          setDragOverLane(null);
                        }}
                        onOpenDetail={onOpenDetail}
                      />
                    </div>
                  ))}
                  {dropSlot?.lane === lane.key && dropSlot.index >= laneRows.length ? <DropMarker /> : null}
                  {isDragOver && laneRows.length === 0 ? (
                    <div
                      className="dops-row-in rounded-lg border border-dashed px-3 py-4 text-center text-[11px]"
                      style={{ borderColor: "var(--yellow-line)", color: "var(--yellow-ink)" }}
                    >
                      Drop to move here
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        );
      })}
      {pendingStuck ? (
        <div className="fixed inset-0 z-40" onClick={() => setPendingStuck(null)}>
          <div className="dops-rise-in-centred fixed left-1/2 bottom-10 z-50 w-80 rounded-xl border shadow-2xl p-3" style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--brand-metal-line)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[12.5px] font-medium text-[color:var(--foreground)] mb-2">What's blocking this process?</div>
            <select
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value as ProcessBlockedOn)}
              className="dops-input w-full px-2 py-1.5 text-[13px] mb-3"
              style={{ borderColor: "var(--brand-metal-line)" }}
            >
              {PROCESS_BLOCKED_ON.filter((v) => v !== "none").map((v) => (
                <option key={v} value={v}>
                  {BLOCKED_ON_LABELS[v]}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPendingStuck(null)} className="text-xs px-3 py-1.5 rounded-full text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
                Undo
              </button>
              <button type="button" onClick={saveStuckMove} className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold">
                Save move
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A 2px insertion line showing exactly which gap the card will land in —
 *  a lane-level "drop here" box can't express order. */
function DropMarker() {
  return (
    <div
      className="dops-row-in rounded-full mb-2"
      style={{ height: 3, background: "var(--brand-yellow)", boxShadow: "0 0 0 3px var(--yellow-soft)" }}
    />
  );
}

const HEALTH_BORDER: Record<string, string> = {
  on_track: "var(--status-good)",
  at_risk: "var(--status-warn)",
  off_track: "var(--status-bad)",
};

function Card({
  row,
  index,
  fields,
  colorMap,
  canDrag,
  dragging,
  onDragStart,
  onDragEnd,
  onOpenDetail,
}: {
  row: DetailProcess;
  index: number;
  fields: ColKey[];
  colorMap: ColorMap;
  canDrag: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenDetail: (id: string) => void;
}) {
  return (
    // role/tabIndex because board view has no other way to open a record —
    // the table's ⤢ button isn't rendered here, so without this the whole
    // view was mouse-only.
    <div
      role="button"
      tabIndex={0}
      aria-label={`${row.process_name} — ${row.customer_display_name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail(row.id);
        }
      }}
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", row.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpenDetail(row.id)}
      className={`dops-card-in dops-card rounded-lg border p-2.5 mb-2 focus:outline-none focus-visible:ring-2 ${
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${dragging ? "dops-card-dragging" : ""}`}
      style={{
        borderColor: "var(--brand-metal-line)",
        borderTopWidth: 2,
        borderTopColor: HEALTH_BORDER[row.health ?? ""] ?? "var(--brand-metal-line)",
        background: "var(--surface-2, var(--muted))",
        animationDelay: `${Math.min(index, 10) * 20}ms`,
      }}
    >
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] truncate">{row.customer_display_name}</div>
      <div className="text-[12.5px] font-medium text-[color:var(--foreground)] mt-0.5 line-clamp-2">{row.process_name}</div>
      <div className="flex flex-wrap gap-1 mt-2">
        {/* Why this card is in Stuck. Stuck is derived, not stored (see
            laneFor), so a card sitting there used to give no hint of its own
            cause — you had to open the drawer and know that Blocked on is
            what puts it there. Only rendered for a real block, so it never
            duplicates a chip the user already chose to show. */}
        {row.blocked_on && row.blocked_on !== "none" ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
            style={hueStyle("red")}
            title={`In the Stuck lane because Blocked on = ${blockedOnLabel(row.blocked_on)}`}
          >
            ⛔ Blocked: {blockedOnLabel(row.blocked_on)}
          </span>
        ) : null}
        {fields.map((key) => (
          <CardChip key={key} colKey={key} row={row} colorMap={colorMap} />
        ))}
      </div>
    </div>
  );
}

function CardChip({ colKey, row, colorMap }: { colKey: ColKey; row: DetailProcess; colorMap: ColorMap }) {
  const def = COLDEF_BY_KEY[colKey];
  switch (colKey) {
    case "owner":
      return row.fde_owner ? <span className="text-[10.5px] px-1.5 py-0.5 rounded text-[color:var(--muted-foreground)]">{row.fde_owner}</span> : null;
    case "tam":
      return row.tam_owner ? <span className="text-[10.5px] px-1.5 py-0.5 rounded text-[color:var(--muted-foreground)]">{row.tam_owner}</span> : null;
    case "partner":
      return row.partner ? <span className="text-[10.5px] px-1.5 py-0.5 rounded text-[color:var(--muted-foreground)]">{row.partner}</span> : null;
    case "customer":
      return null; // already the card eyebrow
    case "stage": {
      const hue = resolveHue("stage", row.migration_stage, colorMap);
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium" style={hueStyle(hue)}>
          {stageLabel(row.migration_stage, { short: true })}
        </span>
      );
    }
    case "health":
      if (!row.health) return null;
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium" style={hueStyle(resolveHue("health", row.health, colorMap))}>
          {healthLabel(row.health)}
        </span>
      );
    case "platform":
      return <span className="text-[10px] px-1.5 py-0.5 rounded border text-[color:var(--muted-foreground)]" style={{ borderColor: "var(--brand-metal-line)" }}>{platformLabel(row.platform)}</span>;
    case "pct":
      return row.completion_pct != null ? (
        <span className="text-[10.5px] font-mono text-[color:var(--muted-foreground)]">{Math.round(row.completion_pct * 100)}%</span>
      ) : null;
    case "arr":
      return row.arr != null ? <span className="text-[10.5px] font-mono text-[color:var(--muted-foreground)]">{formatMoney(row.arr)}</span> : null;
    case "golive":
      return row.go_live_date ? <span className="text-[10.5px] font-mono text-[color:var(--muted-foreground)]">{row.go_live_date}</span> : null;
    case "tickets":
      return row.linear_ticket_ids.length > 0 ? (
        <span className="text-[10.5px] font-mono text-[color:var(--muted-foreground)]">{row.linear_ticket_ids.length} tix</span>
      ) : null;
    case "stale": {
      const days = staleDays(row.updated_at);
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border"
          style={{ borderColor: "var(--brand-metal-line)", color: days > 30 ? "var(--status-bad)" : days > 14 ? "var(--status-warn)" : "var(--muted-foreground)" }}
        >
          {days}d
        </span>
      );
    }
    default:
      return <span className="text-[10.5px] text-[color:var(--muted-foreground)]">{def.label}</span>;
  }
}
