// Publisher: reads scripts/.monday-write-plan.json and applies each
// customer's column updates to Monday board 18395281568 via the
// change_multiple_column_values mutation.
//
// Safety:
//   - One item at a time. 250 ms pause between calls (Monday rate limit
//     is well above this; we stay polite).
//   - DRY_RUN env var: if set, prints the exact mutation payload for
//     each item without sending. Use this before the real run.
//   - Per-item log: success / failure / mutation payload, written to
//     scripts/.monday-publish-log.json.
//
// Run with:  DRY_RUN=1 npx tsx scripts/publish-monday-update.ts      (preview)
//            npx tsx scripts/publish-monday-update.ts                (apply)

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const MONDAY_ENDPOINT = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-04";
const BOARD_ID = "18395281568";

const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry");

interface WritePlanEntry {
  customer_key: string;
  customer_name: string;
  monday_item_id: string;
  sf_account_id: string;
  sf_account_name: string | null;
  arr_rationale: string | null;
  column_values: Record<
    string,
    {
      type: string;
      // The shape Monday needs for the eventual JSON payload:
      //   - text/numbers: a string value
      //   - date:         { date: "YYYY-MM-DD" }
      //   - dropdown:     { labels: ["..."] }
      value: string | { date: string } | { labels: string[] };
      display: string;
    }
  >;
}

interface LogEntry {
  customer_key: string;
  customer_name: string;
  monday_item_id: string;
  status: "ok" | "error" | "dry-run";
  mutation_payload: Record<string, string | { date: string } | { labels: string[] }>;
  error?: string;
  finished_at: string;
}

async function mondayGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (!token) throw new Error("Missing MONDAY_API_TOKEN");
  const res = await fetch(MONDAY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
    error_message?: string;
  };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (body.error_message) throw new Error(body.error_message);
  if (!body.data) throw new Error("Monday returned no data");
  return body.data;
}

function buildPayload(entry: WritePlanEntry): Record<string, string | { date: string } | { labels: string[] }> {
  // Monday expects column_values as a JSON object keyed by column id.
  // The "value" we stored in the plan is already in the correct shape:
  //   numbers / text → string
  //   date           → { date: "YYYY-MM-DD" }
  //   dropdown       → { labels: ["..."] }
  const out: Record<string, string | { date: string } | { labels: string[] }> = {};
  for (const [colId, cv] of Object.entries(entry.column_values)) {
    out[colId] = cv.value;
  }
  return out;
}

async function applyOne(entry: WritePlanEntry): Promise<LogEntry> {
  const payload = buildPayload(entry);
  const log: LogEntry = {
    customer_key: entry.customer_key,
    customer_name: entry.customer_name,
    monday_item_id: entry.monday_item_id,
    status: "ok",
    mutation_payload: payload,
    finished_at: new Date().toISOString(),
  };
  if (DRY_RUN) {
    log.status = "dry-run";
    return log;
  }
  try {
    // change_multiple_column_values: column_values is type JSON, accepts an
    // object literal. We pass it as a stringified JSON so Monday parses it
    // server-side regardless of GraphQL-variable serialisation quirks.
    await mondayGql<{ change_multiple_column_values: { id: string } }>(
      `mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) {
          id
        }
      }`,
      {
        boardId: BOARD_ID,
        itemId: entry.monday_item_id,
        values: JSON.stringify(payload),
      }
    );
  } catch (err) {
    log.status = "error";
    log.error = err instanceof Error ? err.message : String(err);
  }
  return log;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const planPath = path.resolve(process.cwd(), "scripts/.monday-write-plan.json");
  if (!fs.existsSync(planPath)) {
    throw new Error("No write plan found. Run scripts/preview-monday-update.ts first.");
  }
  const plan = JSON.parse(fs.readFileSync(planPath, "utf-8")) as WritePlanEntry[];
  if (plan.length === 0) {
    console.log("Write plan is empty. Nothing to publish.");
    return;
  }

  console.log(`Publisher: ${plan.length} customer write-plans queued.`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE — will write to Monday"}`);
  console.log(`Board: ${BOARD_ID}\n`);

  const logs: LogEntry[] = [];
  let ok = 0;
  let err = 0;
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const fieldCount = Object.keys(entry.column_values).length;
    process.stdout.write(
      `[${(i + 1).toString().padStart(2)}/${plan.length}] ${entry.customer_name.padEnd(34)}  ${fieldCount} field${fieldCount === 1 ? "" : "s"}…  `
    );
    const log = await applyOne(entry);
    logs.push(log);
    if (log.status === "ok") {
      console.log("ok");
      ok++;
    } else if (log.status === "dry-run") {
      console.log("dry-run");
    } else {
      console.log(`ERROR: ${log.error}`);
      err++;
    }
    if (i < plan.length - 1) await sleep(250);
  }

  const logPath = path.resolve(process.cwd(), "scripts/.monday-publish-log.json");
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
  console.log("");
  console.log("─".repeat(50));
  console.log(`Done. ${ok} ok · ${err} error · log: ${logPath}`);
  if (DRY_RUN) {
    console.log("\nThis was a DRY RUN. Re-run without DRY_RUN=1 to actually write.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
