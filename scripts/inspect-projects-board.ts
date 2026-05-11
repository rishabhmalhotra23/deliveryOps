// Inspect the Monday Projects board live: columns, groups, sample items.
// Read-only. Plans the schema extension for project-level info on the
// customer page + analytics dashboard.

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const BOARD_ID = "18395281570"; // Projects board

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN!;
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2024-04",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data!;
}

async function main() {
  const data = await gql<{
    boards: Array<{
      name: string;
      columns: Array<{ id: string; title: string; type: string; settings_str: string | null }>;
      groups: Array<{ id: string; title: string }>;
      items_page: {
        items: Array<{
          id: string;
          name: string;
          group: { title: string };
          column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>;
        }>;
      };
    }>;
  }>(
    `query ($ids: [ID!]) {
      boards(ids: $ids) {
        name
        columns { id title type settings_str }
        groups { id title }
        items_page(limit: 60) {
          items {
            id name
            group { title }
            column_values { id type text value }
          }
        }
      }
    }`,
    { ids: [BOARD_ID] }
  );
  const b = data.boards[0];

  console.log(`Board: ${b.name}\n`);
  console.log("Groups:");
  for (const g of b.groups) console.log(`  • ${g.title}`);
  console.log("");
  console.log("Columns:");
  for (const c of b.columns) {
    const settings =
      c.settings_str && c.settings_str !== "{}" && c.settings_str.length < 200
        ? `  settings=${c.settings_str.slice(0, 100)}…`
        : "";
    console.log(`  • ${c.title.padEnd(30)} type=${c.type.padEnd(14)} id=${c.id}${settings}`);
  }
  console.log("");
  console.log(`Sample items (${b.items_page.items.length}):`);
  for (const it of b.items_page.items.slice(0, 8)) {
    console.log(`\n  ${it.name}  [${it.group.title}]`);
    for (const cv of it.column_values) {
      if (cv.text && cv.text.length > 0 && cv.text.length < 100) {
        console.log(`      ${cv.id.padEnd(28)} ${cv.text}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
