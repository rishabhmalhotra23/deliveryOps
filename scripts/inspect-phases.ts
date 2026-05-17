import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) require("dotenv").config({ path: envLocal, override: true });

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("monday_projects").select("raw_columns, group_title, fiscal_year").limit(2000);
  const phases = new Map<string, number>();
  const groups = new Map<string, number>();
  const now = new Date();
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
  let recentLive = 0;
  // Use the canonical taxonomy so this script can't drift from the rest of
  // the codebase if column IDs ever change.
  const { MONDAY_PROJECT_COLS, colText, isDelivered } = await import("@/lib/delivery/taxonomy");
  for (const row of data ?? []) {
    const cols = row.raw_columns ?? null;
    const phase = colText(cols, MONDAY_PROJECT_COLS.phase);
    const status = colText(cols, MONDAY_PROJECT_COLS.status);
    if (phase) phases.set(phase, (phases.get(phase) ?? 0) + 1);
    if (row.fiscal_year === "active") {
      const g = row.group_title ?? "(null)";
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    const go = colText(cols, MONDAY_PROJECT_COLS.go_live_date);
    if (isDelivered(status) && go) {
      const d = new Date(go);
      if (d >= sevenDaysAgo && d <= now) recentLive++;
    }
  }
  console.log("--- PHASES (by count) ---");
  [...phases.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}  "${k}"`));
  console.log("\n--- ACTIVE BOARD GROUPS ---");
  [...groups.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}  "${k}"`));
  console.log("\n--- Shipped last 7 days:", recentLive);
}
main().catch(console.error);
