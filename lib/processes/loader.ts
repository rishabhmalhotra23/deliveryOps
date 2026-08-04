// Active-work board loader. Reads `processes` (0021) directly — no Monday
// involved. Lane assignment reuses laneFor()/viewForLifecycle() from the
// importer's taxonomy module rather than re-deriving the mapping; those two
// functions are already unit-tested against the real archive counts.

import { requireAdmin } from "@/lib/supabase/server";
import { laneFor, viewForLifecycle, type ActiveLane } from "@/lib/import/monday-taxonomy";
import { TABLES, ACTIVE_LIFECYCLES, type Process } from "@/lib/supabase/types";

// Full Process row plus the two fields the board card/drawer need that aren't
// on the table itself: the resolved customer name and the open-suggestion
// count. Carrying the full row (not a trimmed projection) means a card click
// can open the drawer directly with everything editable, no second fetch.
export interface BoardCard extends Process {
  customer_display_name: string;
  open_suggestion_count: number;
}

export const ACTIVE_LANES: ActiveLane[] = ["pipeline", "building", "validating", "stuck"];

export const ACTIVE_LANE_LABELS: Record<ActiveLane, string> = {
  pipeline: "Pipeline",
  building: "Building",
  validating: "Validating",
  stuck: "Stuck",
};

export interface ActiveBoard {
  lanes: Record<ActiveLane, BoardCard[]>;
  viewCounts: { active: number; delivered: number; archive: number };
}

interface CustomerRow {
  id: string;
  display_name: string;
}

export async function loadActiveBoard(): Promise<ActiveBoard> {
  const sb = requireAdmin();

  const [activeRows, deliveredCount, archiveCount, customers, suggestions] = await Promise.all([
    sb.from(TABLES.processes).select("*").in("lifecycle", ACTIVE_LIFECYCLES),
    sb.from(TABLES.processes).select("id", { count: "exact", head: true }).eq("lifecycle", "live"),
    sb
      .from(TABLES.processes)
      .select("id", { count: "exact", head: true })
      .in("lifecycle", ["cancelled", "churned", "retired"]),
    sb.from("customers").select("id, display_name").is("deleted_at", null),
    sb.from(TABLES.processSuggestions).select("process_id").eq("status", "open"),
  ]);

  if (activeRows.error) throw activeRows.error;
  if (customers.error) throw customers.error;

  const custById = new Map<string, CustomerRow>();
  for (const c of (customers.data as CustomerRow[] | null) ?? []) custById.set(c.id, c);

  const suggestionCounts = new Map<string, number>();
  for (const s of (suggestions.data as { process_id: string }[] | null) ?? []) {
    suggestionCounts.set(s.process_id, (suggestionCounts.get(s.process_id) ?? 0) + 1);
  }

  const lanes: Record<ActiveLane, BoardCard[]> = {
    pipeline: [],
    building: [],
    validating: [],
    stuck: [],
  };

  const rows = (activeRows.data as Process[] | null) ?? [];
  for (const row of rows) {
    const lane = laneFor(row.lifecycle, row.blocked_on);
    if (!lane) continue; // viewForLifecycle(lifecycle) !== "active" — shouldn't happen given the filter above
    lanes[lane].push({
      ...row,
      customer_display_name: (row.customer_id && custById.get(row.customer_id)?.display_name) || row.account,
      open_suggestion_count: suggestionCounts.get(row.id) ?? 0,
    });
  }

  for (const lane of ACTIVE_LANES) {
    lanes[lane].sort((a, b) => a.updated_at.localeCompare(b.updated_at)); // stalest first
  }

  return {
    lanes,
    viewCounts: {
      active: rows.length,
      delivered: deliveredCount.count ?? 0,
      archive: archiveCount.count ?? 0,
    },
  };
}

// Re-exported so callers don't need to know this derivation lives in the
// importer module.
export { viewForLifecycle };
