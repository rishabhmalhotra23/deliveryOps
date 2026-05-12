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
  // The BoardRelationValue fragment populates `linked_item_ids` on
  // relation columns. The plain `value` field returns null or {} for
  // relation columns even when populated — Monday's API requires the
  // typed fragment to read them. Hard-won fact from the NPS board.
  column_values: Array<{
    id: string;
    type: string;
    text: string | null;
    value: string | null;
    linked_item_ids?: string[];
  }>;
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
            column_values {
              id type text value
              ... on BoardRelationValue { linked_item_ids }
            }
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

// Match by Monday board-relation column. We pull `linked_item_ids` via the
// BoardRelationValue typed fragment (returns string IDs of the linked items
// on the target board) and look them up in customersByMondayId. As a legacy
// fallback we still parse cell.value if present, but most boards now return
// the typed field cleanly.
function matchItemToCustomerByRelation(
  item: RawItem,
  relationColumnId: string,
  customersByMondayId: Map<string, Customer>
): Customer | null {
  const cell = item.column_values.find((c) => c.id === relationColumnId);
  if (!cell) return null;

  // Preferred: typed `linked_item_ids` from BoardRelationValue.
  for (const id of cell.linked_item_ids ?? []) {
    const c = customersByMondayId.get(id);
    if (c) return c;
  }

  // Fallback: legacy JSON-in-value parsing for older Monday API responses.
  if (cell.value) {
    try {
      const parsed = JSON.parse(cell.value) as {
        linkedPulseIds?: Array<{ linkedPulseId?: number }>;
      };
      for (const link of parsed.linkedPulseIds ?? []) {
        if (typeof link?.linkedPulseId === "number") {
          const c = customersByMondayId.get(String(link.linkedPulseId));
          if (c) return c;
        }
      }
    } catch {
      /* swallow — bad JSON shouldn't break the whole sync */
    }
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
  registry_updates: { checked: number; updated: number; skipped_protected: number };
  projects: BoardSyncResult;
  activities: BoardSyncResult;
  nps: BoardSyncResult;
  errors: Array<{ board: string; error: string }>;
}

// Customers-board column IDs the sync pulls into the customers table.
// Captured from the live board 2026-05-11. Column IDs are stable; rename in
// Monday doesn't invalidate them. Mirrors lib/import/monday-customers.ts.
const CUSTOMERS_BOARD_COLS = {
  ae_owner: "text_mm0w4gvm",
  partner: "dropdown_mkzjqgxj",
  customer_health: "color_mkzj3vw0", // Healthy / Watch / At Risk / Churned / Dropped
  account_type: "color_mm0yjq7b", // Long Term / Partner / POV
} as const;

// Monday group titles → DeliveryOps custom_category. Kept in sync with
// app/_components/brand.tsx LIFECYCLE_TO_CATEGORY. When a customer's
// lifecycle_group changes from one Monday group to another, we also flip
// custom_category in lockstep — UNLESS the CSM has manually pinned it via
// the operations chat or inline editor (tracked by protected_fields).
const LIFECYCLE_TO_CATEGORY: Record<string, string> = {
  "High Risk": "At Risk",
  "Upcoming Renewal": "Upcoming Renewals",
  "Growth / Focus": "Strategic Growth",
  "Tier 2 - Secondary Priority": "Active",
  "Partner Managed": "Partner Managed",
  POV: "POV",
  "To be Dropped": "To Drop",
  "Churned/Dropped": "Churned",
};

// Sync customers' lifecycle_group + ae_owner + partner from the Customers
// board into the customers table. Respects deliveryops_protected_fields.
// Returns counts so the caller can report on what changed.
async function syncCustomerRegistry(
  customers: Customer[],
  sb: ReturnType<typeof requireAdmin>
): Promise<MondaySyncResult["registry_updates"]> {
  const result = { checked: 0, updated: 0, skipped_protected: 0 };

  const items = await fetchBoardItems("18395281568", 200);
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const cust of customers) {
    if (!cust.monday_item_id) continue;
    const item = byId.get(cust.monday_item_id);
    if (!item) continue;
    result.checked++;

    const cols = indexCols(item);
    const protectedFields = new Set(cust.deliveryops_protected_fields ?? []);

    const updates: Record<string, string | null> = {};

    // Monday group = lifecycle_group (always pulled — never protected; the
    // CSM's primary lever for moving customers between buckets lives in
    // Monday's group, not in our DB).
    const newLifecycle = item.group?.title ?? null;
    if (newLifecycle && newLifecycle !== cust.lifecycle_group) {
      updates.lifecycle_group = newLifecycle;
    }

    // Cascade custom_category whenever either is true:
    //   (a) custom_category is null on the row (initial seed)
    //   (b) lifecycle_group changed AND custom_category isn't pinned in
    //       protected_fields by a manual edit.
    // This is what propagates "I moved them to To be Dropped on Monday"
    // into the DeliveryOps dashboard, AND fixes the null-on-first-import
    // gap discovered after the 2026-05-11 recovery.
    const effectiveLifecycle = newLifecycle ?? cust.lifecycle_group;
    if (effectiveLifecycle && !protectedFields.has("custom_category")) {
      const expectedCategory = LIFECYCLE_TO_CATEGORY[effectiveLifecycle];
      if (expectedCategory && expectedCategory !== cust.custom_category) {
        updates.custom_category = expectedCategory;
      }
    } else if (
      newLifecycle &&
      protectedFields.has("custom_category") &&
      LIFECYCLE_TO_CATEGORY[newLifecycle] !== cust.custom_category
    ) {
      result.skipped_protected++;
    }

    // ae_owner / partner — respect protected fields.
    const newAe = cols[CUSTOMERS_BOARD_COLS.ae_owner]?.text?.trim() || null;
    if (newAe !== cust.ae_owner && !protectedFields.has("ae_owner")) {
      updates.ae_owner = newAe;
    } else if (protectedFields.has("ae_owner") && newAe !== cust.ae_owner) {
      result.skipped_protected++;
    }

    const newPartner = cols[CUSTOMERS_BOARD_COLS.partner]?.text?.trim() || null;
    if (newPartner !== cust.partner && !protectedFields.has("partner")) {
      updates.partner = newPartner;
    } else if (protectedFields.has("partner") && newPartner !== cust.partner) {
      result.skipped_protected++;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await sb.from("customers").update(updates).eq("id", cust.id);
      if (!error) result.updated++;
    }
  }
  return result;
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
    registry_updates: { checked: 0, updated: 0, skipped_protected: 0 },
    projects: { fetched: 0, matched: 0, inserted: 0 },
    activities: { fetched: 0, matched: 0, inserted: 0 },
    nps: { fetched: 0, matched: 0, inserted: 0 },
    errors: [],
  };

  // First: pull customer registry changes (groups / AE / partner). This
  // closes the gap where Monday status changes never reached Postgres.
  try {
    result.registry_updates = await syncCustomerRegistry(customers, sb);
  } catch (err) {
    result.errors.push({ board: "customers_registry", error: err instanceof Error ? err.message : String(err) });
  }

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
  // Build the Contact-name matcher for the NPS board (relies on SF Contacts
  // we backfilled into profiles.contacts). Loaded once, reused per item.
  let contactMatcher: Map<string, Customer> | undefined;
  try {
    contactMatcher = await buildContactMatcher(customers, sb);
  } catch (err) {
    result.errors.push({ board: "nps_contact_matcher", error: err instanceof Error ? err.message : String(err) });
  }

  await syncBoard(
    "nps",
    BOARDS.nps.id,
    "monday_nps_responses",
    customers,
    customersByMondayId,
    {
      relationColumnId: BOARDS.nps.customerRelationColumn,
      matchByContactName: contactMatcher,
    },
    result,
    sb
  );

  return result;
}

interface MatcherConfig {
  relationColumnId?: string;
  longTextHeaderColumnId?: string;
  // SF Contact-based matching: item.name is matched against
  // profile.contacts[].name across all customers. Used for the NPS board,
  // where items are named after the respondent (e.g. "Paul Plunkett") and
  // the Monday Customer board-relation column is rarely populated. The
  // SF Contact→Account link in profile.contacts (backfilled from SF) tells
  // us which customer owns each respondent.
  matchByContactName?: Map<string, Customer>;
}

interface ContactRow {
  name: string;
}
interface ProfileRow {
  customer_id: string;
  contacts: ContactRow[] | null;
}

// Build a map from normalized contact name → Customer. Loaded once per
// sync run and passed to the NPS board matcher. Contacts come from the
// profiles.contacts JSONB column, which gets backfilled from SF.
async function buildContactMatcher(
  customers: Customer[],
  sb: ReturnType<typeof requireAdmin>
): Promise<Map<string, Customer>> {
  const out = new Map<string, Customer>();
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const { data } = await sb.from("profiles").select("customer_id, contacts");
  for (const row of (data as ProfileRow[] | null) ?? []) {
    const cust = customerById.get(row.customer_id);
    if (!cust) continue;
    for (const contact of row.contacts ?? []) {
      const n = (contact?.name ?? "").toLowerCase().trim();
      if (n.length < 4) continue;
      // First-wins to keep deterministic; collisions across customers (rare
      // for full names) keep the first match.
      if (!out.has(n)) out.set(n, cust);
    }
  }
  return out;
}

function matchItemByContactName(
  item: RawItem,
  contactMap: Map<string, Customer>
): Customer | null {
  const name = (item.name ?? "").toLowerCase().trim();
  if (name.length < 4) return null;
  return contactMap.get(name) ?? null;
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
    // 3. SF Contact-name match — used for the NPS board where item.name is
    //    a respondent (e.g. "Paul Plunkett") and the customer is whoever
    //    that respondent works for (from the SF Account→Contact link).
    if (!customer && matcher.matchByContactName) {
      customer = matchItemByContactName(it, matcher.matchByContactName);
    }
    // 4. Item name prefix (legacy fallback).
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
