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
import { ACTIVE_LANES, ACTIVE_LANE_LABELS } from "@/lib/processes/loader";
import { COLDEF_BY_KEY, formatMoney, staleDays, type ColKey } from "@/lib/delivery/columns";
import { resolveHue, hueStyle, hueDotStyle, type ColorMap, type Hue } from "@/lib/delivery/hues";
import type { DetailProcess } from "@/app/_components/process-detail";

const ACTIVE_LANE_HUE: Record<ActiveLane, Hue> = {
  pipeline: "neutral",
  building: "indigo",
  validating: "blue",
  stuck: "red",
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
}

export interface ProcessBoardProps {
  mode: "active" | "v2";
  rows: DetailProcess[];
  cardFields: ColKey[];
  colorMap: ColorMap;
  onSave: (id: string, patch: Partial<Process>) => Promise<Process>;
  onOpenDetail: (id: string) => void;
  onCreateInLane: (seed: Partial<Process>) => void;
}

function bucketRows(mode: "active" | "v2", rows: DetailProcess[]): { lanes: LaneDef[]; byLane: Map<string, DetailProcess[]> } {
  if (mode === "active") {
    const lanes: LaneDef[] = ACTIVE_LANES.map((l) => ({ key: l, label: ACTIVE_LANE_LABELS[l], hue: ACTIVE_LANE_HUE[l] }));
    const byLane = new Map<string, DetailProcess[]>(lanes.map((l) => [l.key, []]));
    for (const row of rows) {
      const lane = laneFor(row.lifecycle, row.blocked_on);
      if (lane) byLane.get(lane)!.push(row);
    }
    return { lanes, byLane };
  }
  const stages = MIGRATION_STAGES.filter((s) => s !== "not_required");
  const lanes: LaneDef[] = stages.map((s) => ({ key: s, label: MIGRATION_STAGE_LABELS[s], hue: resolveHue("stage", s, {}) }));
  const byLane = new Map<string, DetailProcess[]>(lanes.map((l) => [l.key, []]));
  for (const row of rows) {
    if (byLane.has(row.migration_stage)) byLane.get(row.migration_stage)!.push(row);
  }
  return { lanes, byLane };
}

export function ProcessBoard({ mode, rows, cardFields, colorMap, onSave, onOpenDetail, onCreateInLane }: ProcessBoardProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [pendingStuck, setPendingStuck] = useState<{ id: string } | null>(null);
  const [blockedReason, setBlockedReason] = useState<ProcessBlockedOn>("customer");

  const { lanes, byLane } = bucketRows(mode, rows);

  function toggleCollapsed(key: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function commitMove(id: string, laneKey: string) {
    if (mode === "v2") {
      await onSave(id, { migration_stage: laneKey as Process["migration_stage"] });
      return;
    }
    const lane = laneKey as ActiveLane;
    if (lane === "stuck") {
      setPendingStuck({ id });
      return;
    }
    await onSave(id, { lifecycle: ACTIVE_LANE_TO_LIFECYCLE[lane], blocked_on: "none" });
  }

  async function saveStuckMove() {
    if (!pendingStuck) return;
    await onSave(pendingStuck.id, { blocked_on: blockedReason });
    setPendingStuck(null);
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
            className="rounded-xl border transition-[flex-basis] duration-200 shrink-0"
            style={{
              flexBasis: isCollapsed ? 52 : 268,
              width: isCollapsed ? 52 : 268,
              borderColor: isDragOver ? "var(--brand-yellow)" : "var(--glass-border)",
              background: "var(--surface-1, var(--card))",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverLane(lane.key);
            }}
            onDragLeave={() => setDragOverLane((cur) => (cur === lane.key ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              setDragOverLane(null);
              if (id) void commitMove(id, lane.key);
            }}
          >
            {isCollapsed ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(lane.key)}
                className="w-full h-full flex flex-col items-center gap-2 py-3"
                title={`${lane.label} (${laneRows.length})`}
              >
                <span className="w-2 h-2 rounded-full" style={hueDotStyle(lane.hue)} />
                <span
                  className="text-[11px] font-medium text-[color:var(--foreground)]"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {lane.label}
                </span>
                <span className="text-[10px] text-[color:var(--muted-foreground)] tabular-nums">{laneRows.length}</span>
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5 px-2.5 py-2 border-b" style={{ borderColor: "var(--glass-border)" }}>
                  <button type="button" onClick={() => toggleCollapsed(lane.key)} className="text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
                    ‹
                  </button>
                  <span className="w-2 h-2 rounded-full shrink-0" style={hueDotStyle(lane.hue)} />
                  <span className="text-[12.5px] font-semibold tracking-tight text-[color:var(--foreground)] truncate">{lane.label}</span>
                  <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums ml-auto">{laneRows.length}</span>
                  <button
                    type="button"
                    title="New process in this lane"
                    onClick={() =>
                      onCreateInLane(mode === "v2" ? { migration_stage: lane.key as Process["migration_stage"] } : { lifecycle: ACTIVE_LANE_TO_LIFECYCLE[lane.key as ActiveLane] })
                    }
                    className="w-5 h-5 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                  >
                    +
                  </button>
                </div>
                <div className="p-2 space-y-2 min-h-[80px]">
                  {laneRows.map((row, i) => (
                    <Card key={row.id} row={row} index={i} fields={cardFields} colorMap={colorMap} onOpenDetail={onOpenDetail} />
                  ))}
                  {isDragOver ? (
                    <div
                      className="dops-row-in rounded-lg border border-dashed px-3 py-4 text-center text-[11px]"
                      style={{ borderColor: "rgba(242,255,112,0.55)", color: "var(--yellow-ink)" }}
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
          <div className="dops-rise-in-centred fixed left-1/2 bottom-10 z-50 w-80 rounded-xl border shadow-2xl p-3" style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[12.5px] font-medium text-[color:var(--foreground)] mb-2">What's blocking this process?</div>
            <select
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value as ProcessBlockedOn)}
              className="w-full rounded-md border px-2 py-1.5 text-[13px] bg-[var(--glass-bg)] text-[color:var(--foreground)] mb-3"
              style={{ borderColor: "var(--glass-border)" }}
            >
              {PROCESS_BLOCKED_ON.filter((v) => v !== "none").map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
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
  onOpenDetail,
}: {
  row: DetailProcess;
  index: number;
  fields: ColKey[];
  colorMap: ColorMap;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", row.id)}
      onClick={() => onOpenDetail(row.id)}
      className="dops-card-in rounded-lg border p-2.5 cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{
        borderColor: "var(--glass-border)",
        borderTopWidth: 2,
        borderTopColor: HEALTH_BORDER[row.health ?? ""] ?? "var(--glass-border)",
        background: "var(--surface-2, var(--muted))",
        animationDelay: `${Math.min(index, 10) * 20}ms`,
      }}
    >
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] truncate">{row.customer_display_name}</div>
      <div className="text-[12.5px] font-medium text-[color:var(--foreground)] mt-0.5 line-clamp-2">{row.process_name}</div>
      <div className="flex flex-wrap gap-1 mt-2">
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
          {MIGRATION_STAGE_LABELS[row.migration_stage]}
        </span>
      );
    }
    case "health":
      if (!row.health) return null;
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium" style={hueStyle(resolveHue("health", row.health, colorMap))}>
          {row.health.replace(/_/g, " ")}
        </span>
      );
    case "platform":
      return <span className="text-[10px] px-1.5 py-0.5 rounded border text-[color:var(--muted-foreground)]" style={{ borderColor: "var(--glass-border)" }}>{row.platform.toUpperCase()}</span>;
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
          style={{ borderColor: "var(--glass-border)", color: days > 30 ? "var(--status-bad)" : days > 14 ? "var(--status-warn)" : "var(--muted-foreground)" }}
        >
          {days}d
        </span>
      );
    }
    default:
      return <span className="text-[10.5px] text-[color:var(--muted-foreground)]">{def.label}</span>;
  }
}
