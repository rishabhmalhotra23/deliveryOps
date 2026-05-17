// Dry-run the Monday Projects matcher against the live board.
// Reads customers from local Supabase, fetches Projects board items via
// the Monday GraphQL API, and applies the same matchers the sync uses.
// Prints fetched / matched / unmatched counts + lists the unmatched
// project names so we can decide whether to extend the matcher further.
//
// Run: npx tsx scripts/dry-run-monday-projects-match.ts

import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

import { createClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/import/monday-customers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN!;
const PROJECTS_BOARD_ID = "18395281570";
const CUSTOMER_RELATION_COL = "board_relation_mkzjzk6c";
const CUSTOMER_DROPDOWN_COL = "dropdown_mm19sp0c";

interface CustomerRow {
  id: string;
  display_name: string;
  monday_item_id: string | null;
}

interface RawItem {
  id: string;
  name: string;
  group: { title: string };
  column_values: Array<{
    id: string;
    text: string | null;
    value: string | null;
    linked_item_ids?: string[];
  }>;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: MONDAY_TOKEN,
      "Content-Type": "application/json",
      "API-Version": "2024-04",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data!;
}

function matchByRelation(item: RawItem, byMondayId: Map<string, CustomerRow>): CustomerRow | null {
  const cell = item.column_values.find((c) => c.id === CUSTOMER_RELATION_COL);
  if (!cell) return null;
  for (const id of cell.linked_item_ids ?? []) {
    const c = byMondayId.get(id);
    if (c) return c;
  }
  return null;
}

function matchByName(name: string, customers: CustomerRow[]): CustomerRow | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  const exact = customers.find((c) => c.display_name.toLowerCase() === lower);
  if (exact) return exact;
  const norm = normalizeName(name);
  const normMatch = customers.find((c) => normalizeName(c.display_name) === norm);
  if (normMatch) return normMatch;
  return (
    customers.find(
      (c) =>
        normalizeName(c.display_name).startsWith(norm) ||
        norm.startsWith(normalizeName(c.display_name))
    ) ?? null
  );
}

function matchByDropdown(item: RawItem, customers: CustomerRow[]): CustomerRow | null {
  const cell = item.column_values.find((c) => c.id === CUSTOMER_DROPDOWN_COL);
  const name = cell?.text?.trim();
  if (!name) return null;
  return matchByName(name, customers);
}

function matchByItemNamePrefix(itemName: string, customers: CustomerRow[]): CustomerRow | null {
  const itemLower = itemName.toLowerCase();
  const sorted = [...customers].sort((a, b) => b.display_name.length - a.display_name.length);
  for (const c of sorted) {
    const nameLower = c.display_name.toLowerCase();
    if (itemLower === nameLower) return c;
    if (itemLower.startsWith(nameLower + " ") || itemLower.startsWith(nameLower + " -")) return c;
    const nameNorm = normalizeName(c.display_name);
    const itemNorm = normalizeName(itemName);
    if (nameNorm && itemNorm.startsWith(nameNorm)) return c;
  }
  return null;
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await sb
    .from("customers")
    .select("id, display_name, monday_item_id")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const customers = (data ?? []) as CustomerRow[];
  const byMondayId = new Map<string, CustomerRow>();
  for (const c of customers) {
    if (c.monday_item_id) byMondayId.set(c.monday_item_id, c);
  }
  console.log(`Loaded ${customers.length} customers (${byMondayId.size} linked to Monday IDs).`);

  const projectsData = await gql<{
    boards: Array<{ items_page: { items: RawItem[] } }>;
  }>(
    `query ($ids: [ID!], $limit: Int!) {
      boards (ids: $ids) {
        items_page (limit: $limit) {
          items {
            id name
            group { title }
            column_values {
              id text value
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
    { ids: [PROJECTS_BOARD_ID], limit: 500 }
  );
  const items = projectsData.boards?.[0]?.items_page?.items ?? [];
  console.log(`Fetched ${items.length} Projects items.\n`);

  let byRel = 0;
  let byDropdown = 0;
  let byPrefix = 0;
  let unmatched = 0;
  const unmatchedNames: string[] = [];

  for (const it of items) {
    let m = matchByRelation(it, byMondayId);
    if (m) {
      byRel++;
      continue;
    }
    m = matchByDropdown(it, customers);
    if (m) {
      byDropdown++;
      continue;
    }
    m = matchByItemNamePrefix(it.name, customers);
    if (m) {
      byPrefix++;
      continue;
    }
    unmatched++;
    unmatchedNames.push(`${it.name}  [${it.group.title}]`);
  }

  const matched = byRel + byDropdown + byPrefix;
  console.log("Match tier counts:");
  console.log(`  by relation column     : ${byRel}`);
  console.log(`  by Customer dropdown   : ${byDropdown}`);
  console.log(`  by item-name prefix    : ${byPrefix}`);
  console.log(`  unmatched              : ${unmatched}`);
  console.log(`\nTotals: ${matched}/${items.length} matched (${((matched / Math.max(items.length, 1)) * 100).toFixed(0)}%).`);

  if (unmatchedNames.length > 0) {
    console.log("\nUnmatched items (sample of 20):");
    for (const n of unmatchedNames.slice(0, 20)) console.log(`  • ${n}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
