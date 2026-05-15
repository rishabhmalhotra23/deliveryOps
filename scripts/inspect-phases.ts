import "dotenv/config";
import "@/lib/supabase/ws-polyfill";
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
  for (const row of data ?? []) {
    const cols = row.raw_columns ?? {};
    const phase = cols["color_mm06sdrj"]?.text?.trim();
    const status = cols["color_mkzj8fw8"]?.text?.trim();
    if (phase) phases.set(phase, (phases.get(phase) ?? 0) + 1);
    if (row.fiscal_year === "active") {
      const g = row.group_title ?? "(null)";
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    const go = cols["date_mm01dz3b"]?.text?.trim();
    if ((status === "Live" || status === "Delivered") && go) {
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
