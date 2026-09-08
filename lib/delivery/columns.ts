// Shared column model for the merged Delivery workspace's table and board.
// One definition drives: which columns exist, their default widths (wide vs.
// narrow split-panel variant), which ones are on by default, which ones are
// eligible as board-card fields, and which `processes` field a column writes
// to when edited inline. Table and board both import from here so they can
// never drift on what a column means.
//
// Approved design: 2026-09-03-v2-delivery-redesign.html (CLAUDE-CODE-PROMPT.md).

import type { Process } from "@/lib/supabase/types";

export type ColKey =
  | "customer"
  | "stage"
  | "lifecycle"
  | "owner"
  | "tam"
  | "engg"
  | "partner"
  | "health"
  | "platform"
  | "pct"
  | "arr"
  | "effort"
  | "kickoff"
  | "golive"
  | "tickets"
  | "stale";

export type ColKind = "select" | "chip" | "owner" | "pct" | "money" | "num" | "date" | "tickets" | "read";

export interface ColDef {
  key: ColKey;
  label: string;
  kind: ColKind;
  wideW: number;
  /** Width used when the split detail panel is open. Every column declares
   *  one now: only 3 of 16 used to, so opening the 420px panel took ~500px of
   *  viewport and gave back 80px, and the table stayed horizontally scrolled
   *  at half width. Falls back to wideW when absent. */
  narrowW?: number;
  align?: "left" | "right";
}

export const COLDEFS: ColDef[] = [
  { key: "customer", label: "Customer", kind: "select", wideW: 132, narrowW: 100 },
  { key: "stage", label: "Migration stage", kind: "chip", wideW: 150, narrowW: 106 },
  { key: "lifecycle", label: "Lifecycle", kind: "select", wideW: 126, narrowW: 104 },
  { key: "owner", label: "FDE", kind: "owner", wideW: 140, narrowW: 112 },
  { key: "tam", label: "TAM", kind: "owner", wideW: 120, narrowW: 100 },
  { key: "engg", label: "Engineering", kind: "owner", wideW: 130, narrowW: 104 },
  { key: "partner", label: "Partner", kind: "owner", wideW: 118, narrowW: 100 },
  { key: "health", label: "Health", kind: "chip", wideW: 104, narrowW: 92 },
  { key: "platform", label: "Platform", kind: "select", wideW: 96, narrowW: 82 },
  { key: "pct", label: "Progress", kind: "pct", wideW: 104, narrowW: 96, align: "right" },
  { key: "arr", label: "ARR", kind: "money", wideW: 80, narrowW: 72, align: "right" },
  { key: "effort", label: "Effort", kind: "num", wideW: 72, narrowW: 64, align: "right" },
  { key: "kickoff", label: "Kickoff", kind: "date", wideW: 124, narrowW: 100 },
  { key: "golive", label: "Go-live", kind: "date", wideW: 124, narrowW: 100 },
  { key: "tickets", label: "Linear", kind: "tickets", wideW: 84, narrowW: 72 },
  { key: "stale", label: "Last touched", kind: "read", wideW: 92, narrowW: 80 },
];

export const COLDEF_BY_KEY: Record<ColKey, ColDef> = Object.fromEntries(
  COLDEFS.map((c) => [c.key, c])
) as Record<ColKey, ColDef>;

/** The 15 columns shown out of the box — everything except Engineering owner,
 *  which most processes leave unassigned. Phase used to be the exclusion here;
 *  it was removed entirely on 2026-09-08 (it restated `lifecycle` 1:1). */
export const DEFAULT_COLS: ColKey[] = COLDEFS.filter((c) => c.key !== "engg").map((c) => c.key);

/** Smallest width a drag-resize may produce, per column. A flat floor (it was
 *  56px for everything) let "Migration stage" shrink to a sliver while
 *  "Effort" still had room to spare. Three-quarters of the narrow width keeps
 *  every column legible at its own scale. */
export function minColWidth(def: ColDef): number {
  return Math.max(52, Math.round((def.narrowW ?? def.wideW) * 0.75));
}

/** Columns eligible to render as chips on a board card. */
export const CARD_FIELDS: ColKey[] = [
  "customer",
  "stage",
  "owner",
  "tam",
  "partner",
  "health",
  "platform",
  "pct",
  "arr",
  "golive",
  "tickets",
  "stale",
];

export const DEFAULT_CARD_FIELDS: ColKey[] = ["owner", "health", "stale", "tickets"];

/** Which `processes` field a column edits. `null` means the column doesn't
 *  edit inline (tickets opens the detail panel; stale is derived/read-only). */
export const FIELD_FOR_COL: Record<ColKey, keyof Process | null> = {
  customer: "customer_id",
  stage: "migration_stage",
  lifecycle: "lifecycle",
  owner: "fde_owner_id",
  tam: "tam_owner_id",
  engg: "engg_owner_id",
  partner: "partner_id",
  health: "health",
  platform: "platform",
  pct: "completion_pct",
  arr: "arr",
  effort: "total_effort_hours",
  kickoff: "kickoff_date",
  golive: "go_live_date",
  tickets: null,
  stale: null,
};

/** Reverse of FIELD_FOR_COL, for Process Detail's per-field "+" promote
 *  control — only fields that map onto a real table column get a "+". */
export const FIELD_TO_COL: Partial<Record<keyof Process, ColKey>> = {
  customer_id: "customer",
  lifecycle: "lifecycle",
  migration_stage: "stage",
  health: "health",
  platform: "platform",
  kickoff_date: "kickoff",
  go_live_date: "golive",
  total_effort_hours: "effort",
  completion_pct: "pct",
  fde_owner_id: "owner",
  tam_owner_id: "tam",
  engg_owner_id: "engg",
  partner_id: "partner",
  arr: "arr",
};

export function staleDays(updatedAt: string): number {
  return Math.round((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
}

export function formatMoney(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}
