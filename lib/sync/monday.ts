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
//
// Three matching strategies in order of preference:
// 1. `customerRelationColumn` — Monday board-relation column. Exact + fast,
//    but only works when items have the relation populated. The Customer
//    column on Activity Log + NPS is currently sparse.
// 2. `customerNameInLongText` — long-text column whose body contains
//    "Customer: <name>". Used by Activity Log items auto-generated from
//    Fireflies meeting transcripts.
// 3. Item-name prefix matching — last resort.
const BOARDS = {
  projects: { id: "18395281570", name: "Projects" },
  activities: {
    id: "18397573465",
    name: "Activity Log",
    customerRelationColumn: "board_relation_mm019qdx",
    customerNameInLongText: "long_text_mm016mph",
  },
  nps: {
    id: "18398995134",
    name: "NPS Tracking",
    customerRelationColumn: "board_relation_mm0ayfjp",
    // NPS items are named after the respondent (e.g. "Tia Bell"). Until the
    // board-relation gets populated, group_title doesn't include customer
    // info either. We ship the matcher and these stay unmatched until the
    // relation column is filled in. Documented in the Pass F commit.
  },
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
function matchItemToCustomerByName(itemName: string, customers: Customer[]): Customer | null {
  const itemLower = itemName.toLowerCase();
  const itemNorm = normalizeName(itemName);

  // Try the longest customer name that is a prefix of the item name. This
  // avoids "JBI" matching "JBI - Foo" but also matching nothing else when we
  // mean "JBI Specific Item". Sort customers by descending name length.
  const sorted = [...customers].sort((a, b) => b.display_name.length - a.display_name.length);

  for (const c of sorted) {
    const nameLower = c.display_name.toLowerCase();
    const nameNorm = normalizeName(c.display_name);
    if (itemLower === nameLower) return c;
    if (itemLower.startsWith(nameLower + " ") || itemLower.startsWith(nameLower + " -")) return c;
    if (nameNorm && itemNorm.startsWith(nameNorm)) return c;
  }
  return null;
}

// Match by Monday board-relation column. The cell's `value` field is JSON
// of the shape:
//   { "linkedPulseIds": [{ "linkedPulseId": 12345 }, ...] }
// We map those IDs to the customer rows whose monday_item_id matches.
function matchItemToCustomerByRelation(
  item: RawItem,
  relationColumnId: string,
  customersByMondayId: Map<string, Customer>
): Customer | null {
  const cell = item.column_values.find((c) => c.id === relationColumnId);
  if (!cell?.value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cell.value);
  } catch {
    return null;
  }
  const ids: number[] = [];
  if (parsed && typeof parsed === "object") {
    const links =
      (parsed as { linkedPulseIds?: Array<{ linkedPulseId?: number }> }).linkedPulseIds ?? [];
    for (const l of links) {
      if (typeof l?.linkedPulseId === "number") ids.push(l.linkedPulseId);
    }
  }
  for (const id of ids) {
    const c = customersByMondayId.get(String(id));
    if (c) return c;
  }
  return null;
}

// Match by parsing "Customer: <name>" out of a long-text column. Used by
// Activity Log items generated from Fireflies meeting transcripts —
// they include a structured header like:
//   Customer: Ozark River
//   Meeting: Ozark river weekly cadence
//   Owner: Josh Bowers
//   ...
// We extract the value, normalise it, and match against the customer
// roster's display_name (with the same fuzzy fallback).
const CUSTOMER_LINE = /^[ \t]*customer[ \t]*:[ \t]*(.+?)[ \t]*$/im;

function matchItemToCustomerByLongTextHeader(
  item: RawItem,
  longTextColumnId: string,
  customers: Customer[]
): Customer | null {
  const cell = item.column_values.find((c) => c.id === longTextColumnId);
  const text = cell?.text;
  if (!text) return null;
  const match = CUSTOMER_LINE.exec(text);
  if (!match) return null;
  const name = match[1].trim();
  if (!name) return null;
  // Exact match first, then normalised match, then prefix.
  const exact = customers.find((c) => c.display_name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const norm = normalizeName(name);
  const normMatch = customers.find((c) => normalizeName(c.display_name) === norm);
  if (normMatch) return normMatch;
  // Fall back to prefix-of-customer-name match (e.g. "Dish" → "Dish - Ecostar")
  const prefix = customers.find(
    (c) => normalizeName(c.display_name).startsWith(norm) || norm.startsWith(normalizeName(c.display_name))
  );
  return prefix ?? null;
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
  // Index by Monday item ID for relation-based matching.
  const customersByMondayId = new Map<string, Customer>();
  for (const c of customers) {
    if (c.monday_item_id) customersByMondayId.set(c.monday_item_id, c);
  }

  const result: MondaySyncResult = {
    customers_indexed: customers.length,
    projects: { fetched: 0, matched: 0, inserted: 0 },
    activities: { fetched: 0, matched: 0, inserted: 0 },
    nps: { fetched: 0, matched: 0, inserted: 0 },
    errors: [],
  };

  await syncBoard(
    "projects",
    BOARDS.projects.id,
    "monday_projects",
    customers,
    customersByMondayId,
    {},
    result,
    sb
  );
  await syncBoard(
    "activities",
    BOARDS.activities.id,
    "monday_activities",
    customers,
    customersByMondayId,
    {
      relationColumnId: BOARDS.activities.customerRelationColumn,
      longTextHeaderColumnId: BOARDS.activities.customerNameInLongText,
    },
    result,
    sb
  );
  await syncBoard(
    "nps",
    BOARDS.nps.id,
    "monday_nps_responses",
    customers,
    customersByMondayId,
    { relationColumnId: BOARDS.nps.customerRelationColumn },
    result,
    sb
  );

  return result;
}

interface MatcherConfig {
  relationColumnId?: string;
  longTextHeaderColumnId?: string;
}

async function syncBoard(
  kind: "projects" | "activities" | "nps",
  boardId: string,
  table: string,
  customers: Customer[],
  customersByMondayId: Map<string, Customer>,
  matcher: MatcherConfig,
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
    let customer: Customer | null = null;
    // 1. Board-relation column (most reliable when populated).
    if (matcher.relationColumnId) {
      customer = matchItemToCustomerByRelation(it, matcher.relationColumnId, customersByMondayId);
    }
    // 2. Long-text header parsing ("Customer: <name>") — Fireflies-style.
    if (!customer && matcher.longTextHeaderColumnId) {
      customer = matchItemToCustomerByLongTextHeader(
        it,
        matcher.longTextHeaderColumnId,
        customers
      );
    }
    // 3. Item name prefix (legacy fallback).
    if (!customer) {
      customer = matchItemToCustomerByName(it.name, customers);
    }
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
