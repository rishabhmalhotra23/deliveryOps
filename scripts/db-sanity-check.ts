// DB sanity-check. Verifies critical tables exist + have expected row
// counts. Exits non-zero (with a loud diff) when reality drops below
// expectations — designed to fail fast on a recent wipe.
//
// Use BEFORE any potentially-risky operation:
//   npx tsx scripts/db-sanity-check.ts || exit 1
//
// Or import { assertHealthy } in scripts that mutate state.

import "dotenv/config";
import "@/lib/supabase/ws-polyfill"; // Node < 22 needs WebSocket polyfill for supabase-js >= 2.105.
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

import { createClient } from "@supabase/supabase-js";

// Expected minimums per critical table. These reflect the steady-state
// of the local dev DB after import + sync + backfill. If a value drops
// below the minimum, something destructive happened.
const EXPECTED_MIN: Record<string, number> = {
  customers: 35,
  profiles: 35,
  internal_profiles: 35,
  sf_accounts: 30,
  monday_projects: 20,
  monday_nps_responses: 50,
};

export interface SanityReport {
  healthy: boolean;
  table_counts: Record<string, number>;
  expected_min: Record<string, number>;
  failures: Array<{ table: string; count: number; min: number }>;
}

export async function runSanityCheck(): Promise<SanityReport> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const counts: Record<string, number> = {};
  for (const table of Object.keys(EXPECTED_MIN)) {
    try {
      const { count } = await sb
        .from(table)
        .select("id", { count: "exact", head: true });
      counts[table] = count ?? 0;
    } catch {
      counts[table] = -1; // table missing entirely
    }
  }

  const failures: SanityReport["failures"] = [];
  for (const [table, min] of Object.entries(EXPECTED_MIN)) {
    const got = counts[table] ?? -1;
    if (got < min) failures.push({ table, count: got, min });
  }
  return {
    healthy: failures.length === 0,
    table_counts: counts,
    expected_min: EXPECTED_MIN,
    failures,
  };
}

export async function assertHealthy(): Promise<void> {
  const report = await runSanityCheck();
  if (!report.healthy) {
    const lines = report.failures
      .map((f) => `  ✗ ${f.table.padEnd(28)} count=${f.count}  (min=${f.min})`)
      .join("\n");
    throw new Error(
      `Database is below expected minimums — refusing to proceed.\n` +
        `${lines}\n\n` +
        `Recovery: see docs/RUNBOOK.md ("Database wiped or partially missing").`
    );
  }
}

async function main() {
  const report = await runSanityCheck();
  console.log("DB sanity report:");
  for (const [table, count] of Object.entries(report.table_counts)) {
    const min = report.expected_min[table] ?? 0;
    const ok = count >= min;
    const tag = ok ? "✓" : "✗";
    console.log(`  ${tag} ${table.padEnd(28)} count=${count.toString().padStart(4)}  min=${min}`);
  }
  if (!report.healthy) {
    console.error("\nFAIL — see above. Recovery procedure in docs/RUNBOOK.md");
    process.exit(1);
  }
  console.log("\nHealthy.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
