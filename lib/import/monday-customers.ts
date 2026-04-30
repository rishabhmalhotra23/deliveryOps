// Monday "Customers" board column reader — knows the column IDs that hold
// the data we care about and pulls them into a flat shape per customer.
//
// Column IDs were captured from the live board on 2026-04-30.
// If the board schema changes (new columns added, IDs renamed), update this
// map. The column IDs are stable per Monday board; they don't change unless
// someone deletes + recreates the column.

import { gql, type MondayItem } from "@/lib/integrations/monday";

export const CUSTOMERS_BOARD_ID = "18395281568";
export const PROJECTS_BOARD_ID = "18395281570";

// Map of Monday column id → semantic field name.
// On the Monday board this column is informally "CE owner"; DeliveryOps
// treats it as ae_owner (Account Executive) — same data, our naming.
const COLUMN_MAP = {
  ae_owner: "text_mm0w4gvm",
  primary_owner: "multiple_person_mm0ywg19",
  secondary_owner: "multiple_person_mm0yy4re",
  topic: "text_mm0wejh5",
  partner: "dropdown_mkzjqgxj",
  engagement_type: "color_mm0yjq7b",
  status: "color_mkzj3vw0",
  arr_estimate: "text_mkzjrkad",
  employee_count: "text_mkzj6fyr",
  industry: "dropdown_mkzjz1x9",
  numeric_value: "numeric_mkzjds2q",
  date: "date_mkzjnx71",
} as const;

export interface MondayCustomerRow {
  item_id: string;
  name: string;
  group: string; // "High Risk" | "Upcoming Renewal" | "Growth / Focus" | ...
  ae_owner: string | null;
  primary_owner: string | null;
  secondary_owner: string | null;
  topic: string | null;
  partner: string | null;
  engagement_type: string | null;
  status: string | null;
  arr_estimate: string | null;
  employee_count: string | null;
  industry: string | null;
  numeric_value: string | null;
  date: string | null;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }>;
}

export interface MondayProjectRow {
  item_id: string;
  name: string;
  group: string;
  raw_columns: Record<string, { type: string; text: string | null; value: string | null }>;
}

interface RawItem {
  id: string;
  name: string;
  group: { id: string; title: string };
  column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>;
}

interface RawBoard {
  items_page: { items: RawItem[] };
}

async function fetchAllItems(boardId: string, pageSize: number = 100): Promise<RawItem[]> {
  const data = await gql<{ boards: RawBoard[] }>(
    `query ($ids: [ID!], $limit: Int!) {
      boards (ids: $ids) {
        items_page (limit: $limit) {
          items {
            id
            name
            group { id title }
            column_values { id type text value }
          }
        }
      }
    }`,
    { ids: [boardId], limit: pageSize }
  );
  return data.boards?.[0]?.items_page?.items ?? [];
}

function indexCols(item: RawItem): MondayCustomerRow["raw_columns"] {
  const out: MondayCustomerRow["raw_columns"] = {};
  for (const c of item.column_values) {
    out[c.id] = { type: c.type, text: c.text, value: c.value };
  }
  return out;
}

function pick(cols: MondayCustomerRow["raw_columns"], colId: string): string | null {
  const c = cols[colId];
  return c?.text?.trim() || null;
}

export async function listCustomerRows(): Promise<MondayCustomerRow[]> {
  const items = await fetchAllItems(CUSTOMERS_BOARD_ID, 100);
  return items.map((it) => {
    const raw = indexCols(it);
    return {
      item_id: it.id,
      name: it.name,
      group: it.group.title,
      ae_owner: pick(raw, COLUMN_MAP.ae_owner),
      primary_owner: pick(raw, COLUMN_MAP.primary_owner),
      secondary_owner: pick(raw, COLUMN_MAP.secondary_owner),
      topic: pick(raw, COLUMN_MAP.topic),
      partner: pick(raw, COLUMN_MAP.partner),
      engagement_type: pick(raw, COLUMN_MAP.engagement_type),
      status: pick(raw, COLUMN_MAP.status),
      arr_estimate: pick(raw, COLUMN_MAP.arr_estimate),
      employee_count: pick(raw, COLUMN_MAP.employee_count),
      industry: pick(raw, COLUMN_MAP.industry),
      numeric_value: pick(raw, COLUMN_MAP.numeric_value),
      date: pick(raw, COLUMN_MAP.date),
      raw_columns: raw,
    };
  });
}

export async function listProjectRows(): Promise<MondayProjectRow[]> {
  const items = await fetchAllItems(PROJECTS_BOARD_ID, 100);
  return items.map((it) => ({
    item_id: it.id,
    name: it.name,
    group: it.group.title,
    raw_columns: indexCols(it),
  }));
}

// Per-customer Monday workspace lookup — many customers (Pepsi, JBI, Dish,
// etc.) have a dedicated workspace. We list workspaces once and match by
// name (case-insensitive, trimmed).
export interface MondayWorkspaceLite {
  id: string;
  name: string;
}

let _workspaceCache: MondayWorkspaceLite[] | null = null;

export async function listAllWorkspaces(): Promise<MondayWorkspaceLite[]> {
  if (_workspaceCache) return _workspaceCache;
  const data = await gql<{ workspaces: Array<{ id: string; name: string }> }>(
    `query { workspaces (limit: 100) { id name } }`
  );
  _workspaceCache = data.workspaces ?? [];
  return _workspaceCache;
}

// ─── name-matching utilities ───────────────────────────────────────────────

// Strip company suffixes + lowercase + remove non-alpha. "Pepsi Inc." → "pepsi"
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[,.()/\\\-]/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|gmbh|limited|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Cheap fuzzy: jaccard over word-level tokens.
export function nameSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / Math.max(ta.size, tb.size);
}

const STOPWORDS = new Set(["inc", "llc", "ltd", "corp", "the", "and", "co", "of", "a"]);

// The Projects board uses "Customer - Project Name" naming, with one row per
// project (so a customer with N active projects shows up as N rows). We match
// by checking if any project name *starts with* the customer name (after
// normalising both), then add a fuzzy similarity fallback.
export function findMatchingProjects(
  customer: MondayCustomerRow,
  projects: MondayProjectRow[]
): MondayProjectRow[] {
  const normCustomer = normalizeName(customer.name);
  if (!normCustomer) return [];

  const matches = projects.filter((p) => {
    const np = normalizeName(p.name);
    if (np === normCustomer) return true;
    if (np.startsWith(normCustomer)) return true;
    if (nameSimilarity(p.name, customer.name) >= 0.85) return true;
    return false;
  });

  // De-duplicate by id and sort by name.
  const seen = new Set<string>();
  return matches
    .filter((p) => (seen.has(p.item_id) ? false : (seen.add(p.item_id), true)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Back-compat single-match alias for callers that just want one project.
export function findMatchingProject(
  customer: MondayCustomerRow,
  projects: MondayProjectRow[]
): MondayProjectRow | null {
  return findMatchingProjects(customer, projects)[0] ?? null;
}

export function findMatchingWorkspace(
  customer: MondayCustomerRow,
  workspaces: MondayWorkspaceLite[]
): MondayWorkspaceLite | null {
  const norm = normalizeName(customer.name);
  const exact = workspaces.find((w) => normalizeName(w.name) === norm);
  if (exact) return exact;
  // Also try first-word match (e.g. "Dish - Ecostar" → workspace "Dish")
  const firstWord = customer.name.split(/[\s\-/]+/)[0];
  if (firstWord && firstWord.length >= 3) {
    const fw = normalizeName(firstWord);
    const m = workspaces.find((w) => normalizeName(w.name) === fw);
    if (m) return m;
  }
  return null;
}

// re-export for convenience
export type { MondayItem };
