// Verify: re-read the Customers board and confirm key writes landed.
// Read-only. Spot-checks a handful of customers from the publish log.

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const BOARD_ID = "18395281568";

async function mondayGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
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

interface LogEntry {
  customer_name: string;
  monday_item_id: string;
  status: string;
  mutation_payload: Record<string, string | { date?: string }>;
}

async function main() {
  const logPath = path.resolve(process.cwd(), "scripts/.monday-publish-log.json");
  const log = JSON.parse(fs.readFileSync(logPath, "utf-8")) as LogEntry[];
  const successful = log.filter((l) => l.status === "ok");

  const itemIds = successful.map((l) => l.monday_item_id);
  const data = await mondayGql<{
    boards: Array<{
      items_page: {
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{ id: string; text: string | null; value: string | null }>;
        }>;
      };
    }>;
  }>(
    `query ($boardId: ID!, $itemIds: [ID!]) {
      boards(ids: [$boardId]) {
        items_page(query_params: { ids: $itemIds }, limit: 200) {
          items {
            id name
            column_values { id text value }
          }
        }
      }
    }`,
    { boardId: BOARD_ID, itemIds }
  );

  const liveItems = new Map(
    data.boards[0].items_page.items.map((i) => [
      i.id,
      new Map(i.column_values.map((cv) => [cv.id, cv.text])),
    ])
  );

  console.log("Verifying writes…\n");
  let okCount = 0;
  let mismatchCount = 0;
  for (const entry of successful) {
    const live = liveItems.get(entry.monday_item_id);
    if (!live) {
      console.log(`  ? ${entry.customer_name}  — item not returned by Monday`);
      continue;
    }
    const checks: string[] = [];
    let mismatched = false;
    for (const [colId, expected] of Object.entries(entry.mutation_payload)) {
      const liveText = live.get(colId) ?? "";
      let expectedText: string;
      if (typeof expected === "object" && expected !== null && "date" in expected) {
        expectedText = (expected as { date: string }).date;
      } else {
        expectedText = String(expected);
      }
      // Monday formats numeric values without commas for tabular display
      // (e.g., "86400"). The text field returns them stripped. Allow loose
      // numeric comparison for confidence.
      const liveNorm = liveText.replace(/,/g, "").trim();
      const expNorm = expectedText.replace(/,/g, "").trim();
      if (liveNorm === expNorm) {
        checks.push(`${colId}=ok`);
      } else {
        checks.push(`${colId}: expected "${expectedText}" got "${liveText}"`);
        mismatched = true;
      }
    }
    if (mismatched) {
      console.log(`  ✗ ${entry.customer_name}  — ${checks.join("; ")}`);
      mismatchCount++;
    } else {
      console.log(`  ✓ ${entry.customer_name}`);
      okCount++;
    }
  }
  console.log("");
  console.log("─".repeat(50));
  console.log(`Verified: ${okCount} ok · ${mismatchCount} mismatch`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
