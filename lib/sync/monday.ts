// Monday sync — pulls every relevant board (Projects, Activity Log, NPS
// Tracking) once, then maps each row to a customer by name-prefix and
// upserts into the cache tables.
//
// One-pass model: we don't iterate per-customer because Monday's GraphQL
// rate limits are aggressive. Instead, we fetch each board once, then
// distribute the rows to customers using the same name-matcher as the
// import flow.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import { gql } from "@/lib/integrations/monday";
import { normalizeName } from "@/lib/import/monday-customers";
import type { Customer } from "@/lib/supabase/types";

// Boards we care about, captured from the live workspace on 2026-04-30.
const BOARDS = {
  projects: { id: "18395281570", name: "Projects" },
  activities: { id: "18397573465", name: "Activity Log" },
  nps: { id: "18398995134", name: "NPS Tracking" },
};

interface RawItem {
  id: string;
  name: string;
  state: string;
  updated_at: string;
  group: { id: string; title: string };
  column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>;
}

async function fetchBoardItems(boardId: string, limit: number = 500): Promise<RawItem[]> {
  const data = await gql<{ boards: Array<{ items_page: { items: RawItem[] } }> }>(
    `query ($ids: [ID!], $limit: Int!) {
      boards (ids: $ids) {
        items_page (limit: $limit) {
          items {
            id
            name
            state
            updated_at
            group { id title }
            column_values { id type text value }
          }
        }
      }
    }`,
    { ids: [boardId], limit }
  );
  return data.boards?.[0]?.items_page?.items ?? [];
}

function indexCols(item: RawItem): Record<string, { type: string; text: string | null; value: string | null }> {
  const out: Record<string, { type: string; text: string | null; value: string | null }> = {};
  for (const c of item.column_values) {
    out[c.id] = { type: c.type, text: c.text, value: c.value };
  }
  return out;
}

// Match an item to a customer by name prefix. Returns the customer's UUID, or
// null if no customer name is the prefix of (or equal to) the item name.
function matchItemToCustomer(itemName: string, customers: Customer[]): Customer | null {
  const itemLower = itemName.toLowerCase();
  const itemNorm = normalizeName(itemName);

  // Try the longest customer name that is a prefix of the item name. This
  // avoids "JBI" matching "JBI - Foo" but also matching nothing else when we
  // mean "JBI Specific Item". Sort customers by descending name length.
  const sorted = [...customers].sort((a, b) => b.display_name.length - a.display_name.length);

  for (const c of sorted) {
    const nameLower = c.display_name.toLowerCase();
    const nameNorm = normalizeName(c.display_name);
    // Exact name match
    if (itemLower === nameLower) return c;
    // Prefix match: "JBI - Time Cards" starts with "JBI"
    if (itemLower.startsWith(nameLower + " ") || itemLower.startsWith(nameLower + " -")) return c;
    // Normalised prefix
    if (nameNorm && itemNorm.startsWith(nameNorm)) return c;
  }
  return null;
}

interface BoardSyncResult {
  fetched: number;
  matched: number;
  inserted: number;
}

export interface MondaySyncResult {
  customers_indexed: number;
  projects: BoardSyncResult;
  activities: BoardSyncResult;
  nps: BoardSyncResult;
  errors: Array<{ board: string; error: string }>;
}

export async function syncMonday(): Promise<MondaySyncResult> {
  const sb = requireAdmin();
  const customers = await listCustomers();

  const result: MondaySyncResult = {
    customers_indexed: customers.length,
    projects: { fetched: 0, matched: 0, inserted: 0 },
    activities: { fetched: 0, matched: 0, inserted: 0 },
    nps: { fetched: 0, matched: 0, inserted: 0 },
    errors: [],
  };

  await syncBoard("projects", BOARDS.projects.id, "monday_projects", customers, result, sb);
  await syncBoard("activities", BOARDS.activities.id, "monday_activities", customers, result, sb);
  await syncBoard("nps", BOARDS.nps.id, "monday_nps_responses", customers, result, sb);

  return result;
}

async function syncBoard(
  kind: "projects" | "activities" | "nps",
  boardId: string,
  table: string,
  customers: Customer[],
  result: MondaySyncResult,
  sb: ReturnType<typeof requireAdmin>
): Promise<void> {
  let items: RawItem[];
  try {
    items = await fetchBoardItems(boardId, 500);
  } catch (err) {
    result.errors.push({ board: kind, error: err instanceof Error ? err.message : String(err) });
    return;
  }
  result[kind].fetched = items.length;

  const rows: Array<Record<string, unknown>> = [];
  for (const it of items) {
    const customer = matchItemToCustomer(it.name, customers);
    if (!customer) continue;
    result[kind].matched++;
    rows.push({
      customer_id: customer.id,
      monday_item_id: it.id,
      board_id: boardId,
      name: it.name,
      group_title: it.group?.title ?? null,
      state: it.state,
      monday_updated_at: it.updated_at,
      raw_columns: indexCols(it),
      synced_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) return;

  // Wipe-and-replace per board (only for the customers we've matched, so
  // unmapped customers' rows aren't dropped if a different sync wrote them).
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id as string)));
  await sb.from(table).delete().in("customer_id", customerIds).eq("board_id", boardId);

  const { error } = await sb.from(table).insert(rows);
  if (error) {
    result.errors.push({ board: kind, error: error.message });
    return;
  }
  result[kind].inserted = rows.length;
}
