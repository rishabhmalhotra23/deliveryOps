// One-shot: run the Monday sync end-to-end so the cache reflects the
// new Projects matcher immediately (without waiting for the daily cron).
// Run: npx tsx scripts/run-monday-sync.ts

import * as fs from "node:fs";
import * as path from "node:path";

// Load .env then .env.local BEFORE any lib/ import — the supabase server
// client probes env vars at module-load time, so we have to populate
// process.env first.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config();
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

async function main() {
  const { runFullSync } = await import("@/lib/sync/runner");
  console.log("Running Monday sync…");
  const t0 = Date.now();
  const result = await runFullSync({ sources: ["monday"] });
  const ms = Date.now() - t0;
  console.log(`\nFinished in ${ms}ms.`);
  console.log(JSON.stringify(result.monday, null, 2));
  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const e of result.errors) console.log(`  • ${e}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
