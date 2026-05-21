// Mirror DeliveryOps's dynamic categorisation back to the Monday
// "Customers" board: for each customer whose DeliveryOps category maps
// to a different Monday group than where they currently sit, move the
// Monday item to the right group.
//
// Mapping (DeliveryOps category → Monday group):
//   At Risk            → High Risk
//   Upcoming Renewals  → Upcoming Renewal
//   Strategic Growth   → Growth / Focus
//   Secondary Priority → Tier 2 - Secondary Priority
//   Partner Managed    → Partner Managed
//   POV                → POV
//   To Drop            → To be Dropped
//   Churned / Dropped / Past → Churned/Dropped
//
// The "Active" legacy alias is treated as "Secondary Priority" for the
// purpose of Monday placement.
//
// Usage:
//   npx tsx scripts/monday-sync-categories.ts             # dry-run (no writes)
//   npx tsx scripts/monday-sync-categories.ts --apply     # apply the moves

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const CUSTOMERS_BOARD_ID = "18395281568";

// DeliveryOps category → Monday group title (the display name shown on the
// board, e.g. "Upcoming Renewal"). We resolve the actual Monday group ID
// at runtime via GraphQL since Monday assigns its own opaque IDs.
const CATEGORY_TO_MONDAY_GROUP: Record<string, string> = {
  "At Risk": "High Risk",
  "Upcoming Renewals": "Upcoming Renewal",
  "Strategic Growth": "Growth / Focus",
  "Secondary Priority": "Tier 2 - Secondary Priority",
  Active: "Tier 2 - Secondary Priority", // legacy alias
  "Partner Managed": "Partner Managed",
  POV: "POV",
  "To Drop": "To be Dropped",
  Churned: "Churned/Dropped",
  Dropped: "Churned/Dropped",
  Past: "Churned/Dropped",
};

interface BoardGroupsResponse {
  boards: Array<{
    groups: Array<{ id: string; title: string }>;
  }>;
}

interface BoardItemsResponse {
  boards: Array<{
    items_page: {
      cursor: string | null;
      items: Array<{ id: string; name: string; group: { id: string; title: string } }>;
    };
  }>;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const { listCustomers } = await import("@/lib/customers");
  const {
    loadCustomerCommercialsMap,
  } = await import("@/lib/cache/integrations");
  const { categoryFromCustomer } = await import("@/app/_components/brand");
  const { gql } = await import("@/lib/integrations/monday");

  // 1. Fetch the Monday board's groups so we can resolve title → id
  const groupsRes = await gql<BoardGroupsResponse>(
    `query ($boardId: [ID!]) { boards(ids: $boardId) { groups { id title } } }`,
    { boardId: [CUSTOMERS_BOARD_ID] }
  );
  const groups = groupsRes.boards[0]?.groups ?? [];
  const groupIdByTitle = new Map<string, string>();
  for (const g of groups) groupIdByTitle.set(g.title, g.id);
  console.log("Monday board groups:");
  for (const g of groups) console.log(`  ${g.id}  ${g.title}`);
  console.log("");

  // 2. Fetch every customer item on the board with its current group
  let cursor: string | null = null;
  const itemsByMondayId = new Map<string, { name: string; groupId: string; groupTitle: string }>();
  do {
    type Page = BoardItemsResponse;
    const page: Page = await gql<Page>(
      `query ($boardId: [ID!], $cursor: String) {
        boards(ids: $boardId) {
          items_page(limit: 200, cursor: $cursor) {
            cursor
            items { id name group { id title } }
          }
        }
      }`,
      { boardId: [CUSTOMERS_BOARD_ID], cursor }
    );
    const pg = page.boards[0]?.items_page;
    for (const it of pg?.items ?? []) {
      itemsByMondayId.set(it.id, { name: it.name, groupId: it.group.id, groupTitle: it.group.title });
    }
    cursor = pg?.cursor ?? null;
  } while (cursor);
  console.log(`Loaded ${itemsByMondayId.size} customer items from Monday.`);
  console.log("");

  // 3. Compute DeliveryOps category for each customer + target Monday group
  const customers = await listCustomers();
  const commercials = await loadCustomerCommercialsMap();

  const toMove: Array<{
    displayName: string;
    mondayItemId: string;
    currentGroupTitle: string;
    targetGroupTitle: string;
    targetGroupId: string;
    deliveryOpsCategory: string;
  }> = [];
  const unchanged: Array<{ displayName: string; group: string }> = [];
  const noMatch: Array<{ displayName: string; reason: string }> = [];

  for (const c of customers) {
    if (!c.monday_item_id) {
      noMatch.push({ displayName: c.display_name, reason: "no monday_item_id on customer row" });
      continue;
    }
    const item = itemsByMondayId.get(c.monday_item_id);
    if (!item) {
      noMatch.push({ displayName: c.display_name, reason: `Monday item ${c.monday_item_id} not on board` });
      continue;
    }
    const com = commercials.get(c.id);
    const category = categoryFromCustomer(c, {
      renewal_date: com?.renewal_date,
      annual_revenue: com?.annual_revenue,
    });
    const targetTitle = CATEGORY_TO_MONDAY_GROUP[category];
    if (!targetTitle) {
      noMatch.push({
        displayName: c.display_name,
        reason: `no Monday group mapping for category "${category}"`,
      });
      continue;
    }
    const targetGroupId = groupIdByTitle.get(targetTitle);
    if (!targetGroupId) {
      noMatch.push({
        displayName: c.display_name,
        reason: `Monday group "${targetTitle}" doesn't exist on the board`,
      });
      continue;
    }
    if (item.groupId === targetGroupId) {
      unchanged.push({ displayName: c.display_name, group: targetTitle });
      continue;
    }
    toMove.push({
      displayName: c.display_name,
      mondayItemId: c.monday_item_id,
      currentGroupTitle: item.groupTitle,
      targetGroupTitle: targetTitle,
      targetGroupId,
      deliveryOpsCategory: category,
    });
  }

  console.log(`Will move ${toMove.length} item${toMove.length === 1 ? "" : "s"}.`);
  console.log(`Already in the right group: ${unchanged.length}.`);
  if (noMatch.length > 0) console.log(`Skipping ${noMatch.length} (can't resolve).`);
  console.log("");

  if (toMove.length > 0) {
    console.log(
      [
        "Customer".padEnd(28),
        "DeliveryOps cat".padEnd(20),
        "Current Monday group".padEnd(30),
        "→ Target Monday group",
      ].join(" │ ")
    );
    console.log("─".repeat(120));
    for (const m of toMove) {
      console.log(
        [
          m.displayName.slice(0, 26).padEnd(28),
          m.deliveryOpsCategory.slice(0, 18).padEnd(20),
          m.currentGroupTitle.slice(0, 28).padEnd(30),
          m.targetGroupTitle,
        ].join(" │ ")
      );
    }
    console.log("");
  }

  if (noMatch.length > 0) {
    console.log("Skipped:");
    for (const s of noMatch) console.log(`  • ${s.displayName}: ${s.reason}`);
    console.log("");
  }

  if (!apply) {
    console.log("Dry-run.  Re-run with --apply to move the items.");
    return;
  }

  if (toMove.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("Applying…");
  let ok = 0;
  let failed = 0;
  for (const m of toMove) {
    try {
      type MoveResp = { move_item_to_group: { id: string } };
      await gql<MoveResp>(
        `mutation ($itemId: ID!, $groupId: String!) {
          move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
        }`,
        { itemId: m.mondayItemId, groupId: m.targetGroupId }
      );
      console.log(`  ✓ ${m.displayName} → ${m.targetGroupTitle}`);
      ok++;
    } catch (err) {
      console.error(
        `  ✗ ${m.displayName} — ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }
  console.log("");
  console.log(`Done. ${ok} moved, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
