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
  | "phase"
  | "owner"
  | "tam"
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
  /** Width used only when the split detail panel is open and the table has
   *  collapsed to NARROW_COLS. Falls back to wideW when absent. */
  narrowW?: number;
  align?: "left" | "right";
}

export const COLDEFS: ColDef[] = [
  { key: "customer", label: "Customer", kind: "select", wideW: 132 },
  { key: "stage", label: "Migration stage", kind: "chip", wideW: 150, narrowW: 106 },
  { key: "lifecycle", label: "Lifecycle", kind: "select", wideW: 126 },
  { key: "phase", label: "Phase", kind: "select", wideW: 136 },
  { key: "owner", label: "FDE", kind: "owner", wideW: 140, narrowW: 112 },
  { key: "tam", label: "TAM", kind: "owner", wideW: 120 },
  { key: "partner", label: "Partner", kind: "owner", wideW: 118 },
  { key: "health", label: "Health", kind: "chip", wideW: 104 },
  { key: "platform", label: "Platform", kind: "select", wideW: 90 },
  { key: "pct", label: "Progress", kind: "pct", wideW: 104, narrowW: 96, align: "right" },
  { key: "arr", label: "ARR", kind: "money", wideW: 80, align: "right" },
  { key: "effort", label: "Effort", kind: "num", wideW: 72, align: "right" },
  { key: "kickoff", label: "Kickoff", kind: "date", wideW: 124 },
  { key: "golive", label: "Go-live", kind: "date", wideW: 124 },
  { key: "tickets", label: "Linear", kind: "tickets", wideW: 84 },
  { key: "stale", label: "Last touched", kind: "read", wideW: 92 },
];

export const COLDEF_BY_KEY: Record<ColKey, ColDef> = Object.fromEntries(
  COLDEFS.map((c) => [c.key, c])
) as Record<ColKey, ColDef>;

/** The 15 columns shown out of the box — everything except Phase. */
export const DEFAULT_COLS: ColKey[] = COLDEFS.filter((c) => c.key !== "phase").map((c) => c.key);

/** Columns kept when the split-panel detail is open — the rest collapse out
 *  of the table to make room for the 420px detail column. */
export const NARROW_COLS: ColKey[] = ["stage", "owner", "pct"];

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
  phase: "phase",
  owner: "fde_owner_id",
  tam: "tam_owner_id",
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
  lifecycle: "lifecycle",
  migration_stage: "stage",
  phase: "phase",
  health: "health",
  platform: "platform",
  kickoff_date: "kickoff",
  go_live_date: "golive",
  total_effort_hours: "effort",
  completion_pct: "pct",
  fde_owner_id: "owner",
  tam_owner_id: "tam",
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
