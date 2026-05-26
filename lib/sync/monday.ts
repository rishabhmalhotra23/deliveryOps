// Monday sync — pulls every relevant board (Projects, all FY Deliverables,
// Inactive/Cancelled, Activity Log, NPS Tracking) once, maps rows to
// customers, and upserts into the cache tables.
//
// One-pass model: we don't iterate per-customer because Monday's GraphQL
// rate limits are aggressive. Instead, we fetch each board once, then
// distribute the rows to customers using the same name-matcher as the
// import flow.
//
// Project boards synced (captured 2026-05-14):
//   18395281570  Projects (active / in-flight)
//   18398797267  FY-2026 Deliverables
//   18398797224  FY-2025 Deliverables
//   18398797248  FY-2024 Deliverables
//   18398797257  FY-2023 Deliverables
//   18398797301  Inactive / Cancelled projects

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import { gql } from "@/lib/integrations/monday";
import { normalizeName } from "@/lib/import/monday-customers";
import type { Customer } from "@/lib/supabase/types";

// ─── Column ID constants ────────────────────────────────────────────────────
// Cross-board columns come from lib/delivery/taxonomy.ts (single source of
// truth used by every loader). Sync-only columns + per-board customer
// dropdowns stay local because no other module reads them.

import { MONDAY_PROJECT_COLS } from "@/lib/delivery/taxonomy";

const PROJECT_COLS = {
  ...MONDAY_PROJECT_COLS,
  // Aliases for fields whose names differ from the taxonomy keys:
  kickoff:     MONDAY_PROJECT_COLS.kickoff_date,
  go_live:     MONDAY_PROJECT_COLS.go_live_date,
  // Sync-only columns — written by this module, never read by loaders:
  customer_relation:        "board_relation_mkzjzk6c",
  total_effort:             "numeric_mm0664sx",
  timeline:                 "timerange_mm014ng0",
  delivered_value:          "text_mm09rsbe",
  // Customer dropdown IDs differ across boards:
  customer_dropdown_active: "dropdown_mm19sp0c",
  customer_dropdown_fy26:   "dropdown_mm19b4x3",
} as const;

interface ProjectBoard {
  id: string;
  name: string;
  fiscalYear: string;
  customerDropdownColumn?: string;
  limit: number;
}

const PROJECT_BOARDS: ProjectBoard[] = [
  {
    id: "18395281570",
    name: "Projects",
    fiscalYear: "active",
    customerDropdownColumn: PROJECT_COLS.customer_dropdown_active,
    limit: 500,
  },
  {
    id: "18398797267",
    name: "FY-2026 Deliverables",
    fiscalYear: "FY-2026",
    customerDropdownColumn: PROJECT_COLS.customer_dropdown_fy26,
    limit: 500,
  },
  {
    id: "18398797224",
    name: "FY-2025 Deliverables",
    fiscalYear: "FY-2025",
    limit: 500,
  },
  {
    id: "18398797248",
    name: "FY-2024 Deliverables",
    fiscalYear: "FY-2024",
    limit: 500,
  },
  {
    id: "18398797257",
    name: "FY-2023 Deliverables",
    fiscalYear: "FY-2023",
    limit: 500,
  },
  {
    id: "18398797301",
    name: "Inactive / Cancelled",
    fiscalYear: "inactive",
    limit: 500,
  },
];

const BOARDS = {
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
  // Most-recent item update (comment/note). Fetched via the updates
  // sub-query; HTML tags stripped before storing.
  updates?: Array<{ body: string; created_at: string }>;
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
            updates(limit: 1) {
              body
              created_at
            }
          }
        }
      }
    }`,
    { ids: [boardId], limit }
  );
  return data.boards?.[0]?.items_page?.items ?? [];
}

// Strip HTML tags from Monday update bodies (Monday returns rich-text HTML).
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > 0 ? stripped.slice(0, 1000) : null;
}

// Parse the Monday timeline column value. Returns { start, end } as ISO
// date strings or null. The timeline column stores JSON like:
//   { "from": "2024-08-01", "to": "2024-11-08" }
function parseTimeline(value: string | null): { start: string | null; end: string | null } {
  if (!value) return { start: null, end: null };
  try {
    const parsed = JSON.parse(value) as { from?: string; to?: string };
    return { start: parsed.from ?? null, end: parsed.to ?? null };
  } catch {
    return { start: null, end: null };
  }
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
  return matchCustomerByName(match[1].trim(), customers);
}

// Match by the value of a column whose `text` IS the customer name —
// typically the "Customer" dropdown on the Projects board. No parsing
// required; we just read the cell's text and resolve it to a customer
// via the shared exact / normalised / prefix matcher.
function matchItemToCustomerByDropdownName(
  item: RawItem,
  dropdownColumnId: string,
  customers: Customer[]
): Customer | null {
  const cell = item.column_values.find((c) => c.id === dropdownColumnId);
  const name = cell?.text?.trim();
  if (!name) return null;
  return matchCustomerByName(name, customers);
}

// Resolve a raw customer-name string to a Customer via:
//   1. exact case-insensitive display_name match
//   2. normalised name match (strip punctuation, collapse whitespace)
//   3. bidirectional prefix match (handles "Dish" ↔ "Dish - Ecostar")
function matchCustomerByName(name: string, customers: Customer[]): Customer | null {
  if (!name) return null;
  const exact = customers.find((c) => c.display_name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const norm = normalizeName(name);
  const normMatch = customers.find((c) => normalizeName(c.display_name) === norm);
  if (normMatch) return normMatch;
  const prefix = customers.find(
    (c) =>
      normalizeName(c.display_name).startsWith(norm) || norm.startsWith(normalizeName(c.display_name))
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
  // Aggregated totals across all 6 project boards.
  projects: BoardSyncResult;
  // Per-board breakdown for the /dev/sync diagnostic.
  projects_by_board: Array<{ board_id: string; board_name: string; fiscal_year: string } & BoardSyncResult>;
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
// custom_category in lockstep — UNLESS the FDE has manually pinned it via
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
    // FDE's primary lever for moving customers between buckets lives in
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
    projects_by_board: [],
    activities: { fetched: 0, matched: 0, inserted: 0 },
    nps: { fetched: 0, matched: 0, inserted: 0 },
    errors: [],
  };

  // First: pull customer registry changes (groups / AE / partner).
  try {
    result.registry_updates = await syncCustomerRegistry(customers, sb);
  } catch (err) {
    result.errors.push({ board: "customers_registry", error: err instanceof Error ? err.message : String(err) });
  }

  // Sync all 6 Delivery Planning project boards (active + FY + inactive).
  for (const board of PROJECT_BOARDS) {
    const boardResult: BoardSyncResult = { fetched: 0, matched: 0, inserted: 0 };
    try {
      await syncProjectBoard(board, customers, customersByMondayId, boardResult, sb);
    } catch (err) {
      result.errors.push({ board: board.name, error: err instanceof Error ? err.message : String(err) });
    }
    result.projects.fetched += boardResult.fetched;
    result.projects.matched += boardResult.matched;
    result.projects.inserted += boardResult.inserted;
    result.projects_by_board.push({
      board_id: board.id,
      board_name: board.name,
      fiscal_year: board.fiscalYear,
      ...boardResult,
    });
  }

  // Sync Account Overview boards from per-customer workspaces.
  // These add per-customer operational status (Active/Stalled/Cancelled/Upcoming)
  // that isn't captured in the FY delivery boards.
  const aoResult: BoardSyncResult = { fetched: 0, matched: 0, inserted: 0 };
  try {
    await syncAccountOverviewBoards(customers, aoResult, sb);
  } catch (err) {
    result.errors.push({ board: "account_overview", error: err instanceof Error ? err.message : String(err) });
  }
  result.projects.fetched += aoResult.fetched;
  result.projects.matched += aoResult.matched;
  result.projects.inserted += aoResult.inserted;
  result.projects_by_board.push({
    board_id: "per-customer",
    board_name: "Account Overview (all customers)",
    fiscal_year: "account_overview",
    ...aoResult,
  });

  // Sync Projects Portfolio → Projects Overview (legacy portfolio board).
  const ppResult: BoardSyncResult = { fetched: 0, matched: 0, inserted: 0 };
  try {
    await syncProjectBoard(
      { id: "6073051226", name: "Projects Portfolio", fiscalYear: "portfolio", customerDropdownColumn: "dropdown7__1", limit: 200 },
      customers,
      customersByMondayId,
      ppResult,
      sb
    );
  } catch (err) {
    result.errors.push({ board: "projects_portfolio", error: err instanceof Error ? err.message : String(err) });
  }
  result.projects.fetched += ppResult.fetched;
  result.projects.matched += ppResult.matched;
  result.projects.inserted += ppResult.inserted;
  result.projects_by_board.push({
    board_id: "6073051226",
    board_name: "Projects Portfolio",
    fiscal_year: "portfolio",
    ...ppResult,
  });

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

// Sync one project board into monday_projects with all extended columns.
async function syncProjectBoard(
  board: ProjectBoard,
  customers: Customer[],
  customersByMondayId: Map<string, Customer>,
  result: BoardSyncResult,
  sb: ReturnType<typeof requireAdmin>
): Promise<void> {
  const items = await fetchBoardItems(board.id, board.limit);
  result.fetched = items.length;

  const rows: Array<Record<string, unknown>> = [];
  for (const it of items) {
    let customer: Customer | null = null;

    // 1. Board-relation column (most reliable when populated).
    customer = matchItemToCustomerByRelation(it, PROJECT_COLS.customer_relation, customersByMondayId);

    // 2. Customer dropdown (id varies by board: active vs FY-2026 vs older).
    if (!customer && board.customerDropdownColumn) {
      customer = matchItemToCustomerByDropdownName(it, board.customerDropdownColumn, customers);
    }

    // 3. Item-name prefix (last resort — works well for "JBI - Time Cards").
    if (!customer) {
      customer = matchItemToCustomerByName(it.name, customers);
    }
    if (!customer) continue;

    result.matched++;
    const cols = indexCols(it);
    const timelineVal = cols[PROJECT_COLS.timeline]?.value ?? null;
    const { start: tStart, end: tEnd } = parseTimeline(timelineVal);
    const latestUpdateBody = it.updates?.[0]?.body ?? null;

    rows.push({
      customer_id: customer.id,
      monday_item_id: it.id,
      board_id: board.id,
      name: it.name,
      group_title: it.group?.title ?? null,
      state: it.state,
      monday_updated_at: it.updated_at,
      raw_columns: indexCols(it),
      synced_at: new Date().toISOString(),
      // Stored columns (migrations 0010 + 0012).
      fiscal_year:        board.fiscalYear,
      board_name:         board.name,
      go_live_date:       cols[PROJECT_COLS.go_live]?.text?.trim() || null,
      kickoff_date:       cols[PROJECT_COLS.kickoff]?.text?.trim() || null,
      total_effort_days:  cols[PROJECT_COLS.total_effort]?.text ? Number(cols[PROJECT_COLS.total_effort].text) || null : null,
      delivered_value:    cols[PROJECT_COLS.delivered_value]?.text?.trim() || null,
      ttv_days_text:      cols[PROJECT_COLS.ttv]?.text?.trim() || null,
      timeline_start:     tStart,
      timeline_end:       tEnd,
      latest_update:      stripHtml(latestUpdateBody),
    });
  }

  if (rows.length === 0) return;

  // UPSERT instead of wipe-and-replace: this preserves all DeliveryOps-native
  // columns (delivery_notes, any future user-entered fields) across re-syncs.
  // `monday_item_id` is UNIQUE — existing rows are updated in-place, new rows
  // are inserted. Columns not present in `rows` (e.g. delivery_notes) are
  // untouched on UPDATE.
  //
  // After upserting, mark any previously-synced items from this board that are
  // no longer present on Monday as removed_from_monday = true so they stay in
  // history but are flagged as stale.
  const { error } = await sb
    .from("monday_projects")
    .upsert(rows, { onConflict: "monday_item_id" });
  if (error) throw new Error(error.message);

  // Soft-retire items from this board that weren't in the latest fetch.
  // We mark them removed rather than deleting so DeliveryOps history is
  // preserved (per the source-of-truth principle).
  const seenIds = new Set(rows.map((r) => r.monday_item_id as string));
  const { data: existingRows } = await sb
    .from("monday_projects")
    .select("monday_item_id")
    .eq("board_id", board.id)
    .eq("removed_from_monday", false);
  const removedIds = (existingRows ?? [])
    .map((r) => (r as { monday_item_id: string }).monday_item_id)
    .filter((id) => !seenIds.has(id));
  if (removedIds.length > 0) {
    await sb
      .from("monday_projects")
      .update({ removed_from_monday: true, synced_at: new Date().toISOString() })
      .in("monday_item_id", removedIds);
  }

  result.inserted = rows.length;
}

interface MatcherConfig {
  relationColumnId?: string;
  // Dropdown column whose `text` is the customer's display name (e.g. the
  // Projects board's "Customer" dropdown — `dropdown_mm19sp0c`).
  dropdownNameColumnId?: string;
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
  kind: "activities" | "nps",
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
    // 2. Dropdown column whose text IS the customer name — primary fallback
    //    for the Projects board where the relation column is sparse but the
    //    "Customer" dropdown is consistently set.
    if (!customer && matcher.dropdownNameColumnId) {
      customer = matchItemToCustomerByDropdownName(it, matcher.dropdownNameColumnId, customers);
    }
    // 3. Long-text header parsing ("Customer: <name>") — Fireflies-style.
    if (!customer && matcher.longTextHeaderColumnId) {
      customer = matchItemToCustomerByLongTextHeader(
        it,
        matcher.longTextHeaderColumnId,
        customers
      );
    }
    // 4. SF Contact-name match — used for the NPS board where item.name is
    //    a respondent (e.g. "Paul Plunkett") and the customer is whoever
    //    that respondent works for (from the SF Account→Contact link).
    if (!customer && matcher.matchByContactName) {
      customer = matchItemByContactName(it, matcher.matchByContactName);
    }
    // 5. Item name prefix (legacy fallback).
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

  // Wipe-and-replace per board for Activity Log and NPS Tracking:
  // these tables have no user-editable DeliveryOps columns, so overwriting
  // is safe and correct. (monday_projects uses UPSERT instead — see
  // syncProjectBoard — because it carries user-annotatable delivery_notes.)
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id as string)));
  await sb.from(table).delete().in("customer_id", customerIds).eq("board_id", boardId);

  const { error } = await sb.from(table).insert(rows);
  if (error) {
    result.errors.push({ board: kind, error: error.message });
    return;
  }
  result[kind].inserted = rows.length;
}

// ── Account Overview boards (per-customer workspaces) ─────────────────────
//
// Each customer workspace has an "[Customer] - Account Overview" board. It
// groups projects as: Active / Upcoming / Completed / Stalled / Cancelled.
// Mirror columns return null (they read from sub-boards), so we capture:
//   • project name (item name)
//   • operational status (group title: "Active Projects", "Completed Projects", …)
//   • complexity (direct status column `label_Mjj3tFzF`)
//
// We discover the Account Overview board dynamically by fetching boards in
// the customer's Monday workspace (customers.monday_workspace_id) and
// looking for a board whose name contains "Account Overview".

const AO_COMPLEXITY_COL = "label_Mjj3tFzF";

async function syncAccountOverviewBoards(
  customers: Customer[],
  result: BoardSyncResult,
  sb: ReturnType<typeof requireAdmin>
): Promise<void> {
  // Only process customers that have a Monday workspace ID.
  const withWorkspace = customers.filter((c) => c.monday_workspace_id);
  if (withWorkspace.length === 0) return;

  for (const customer of withWorkspace) {
    try {
      await syncOneAccountOverviewBoard(customer, result, sb);
    } catch (err) {
      // Don't abort the whole sync for one customer's board failure.
      console.warn(
        "[sync/ao] %s: %s",
        customer.display_name,
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function syncOneAccountOverviewBoard(
  customer: Customer,
  result: BoardSyncResult,
  sb: ReturnType<typeof requireAdmin>
): Promise<void> {
  // Discover the Account Overview board in the customer's workspace.
  const boardsData = await gql<{
    boards: Array<{ id: string; name: string; state: string }>;
  }>(
    `query($wsIds: [ID!]) {
       boards(workspace_ids: $wsIds, limit: 50) {
         id name state
       }
     }`,
    { wsIds: [customer.monday_workspace_id] }
  );

  const aoBoard = (boardsData.boards ?? []).find(
    (b) => b.name.toLowerCase().includes("account overview") && b.state === "active"
  );
  if (!aoBoard) return;

  const items = await fetchBoardItems(aoBoard.id, 200);
  result.fetched += items.length;
  if (items.length === 0) return;

  const rows = items
    .filter((it) => it.name && it.group?.title)
    .map((it) => {
      const cols = indexCols(it);
      return {
        customer_id: customer.id,
        monday_item_id: it.id,
        board_id: aoBoard.id,
        name: it.name,
        group_title: it.group.title,
        state: it.state,
        monday_updated_at: it.updated_at,
        raw_columns: cols,
        synced_at: new Date().toISOString(),
        fiscal_year: "account_overview",
        board_name: aoBoard.name,
        // Complexity is the only direct (non-mirror) column with useful text.
        // We store it in raw_columns so the caller can lift it if needed.
        // Also store a parsed status from the group title.
        latest_update: stripHtml(it.updates?.[0]?.body ?? null),
      };
    });

  if (rows.length === 0) return;

  // UPSERT — same source-of-truth principle as syncProjectBoard.
  // delivery_notes and other DeliveryOps-native columns are never in `rows`
  // so they are preserved across re-syncs.
  const { error } = await sb
    .from("monday_projects")
    .upsert(rows, { onConflict: "monday_item_id" });
  if (error) throw new Error(error.message);

  result.matched += rows.length;
  result.inserted += rows.length;
}
