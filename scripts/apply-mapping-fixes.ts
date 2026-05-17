// One-off: apply the SF mapping decisions confirmed with the user.
// Writes to customers.salesforce_account_id. Records each change in
// the customer's event log for audit trail.
//
// Run: npx tsx scripts/apply-mapping-fixes.ts

import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

import { createClient } from "@supabase/supabase-js";

// User-confirmed remappings (2026-05-11). null = unmap (clear sf_id).
const FIXES: Array<{ customer_key: string; new_sf_id: string | null; new_sf_name: string | null; reason: string }> = [
  {
    customer_key: "bradley-and-beams",
    new_sf_id: "001QQ000017Ea8jYAC",
    new_sf_name: "Bradley & Beams LLP",
    reason: "Was mapped to Bradley Motivation (broadcast media). Correct match found by exact-name search.",
  },
  {
    customer_key: "tpi",
    new_sf_id: "001QQ00001yy3L1YAI",
    new_sf_name: "TPI Composites",
    reason: "Was mapped to a 120-employee 'Tpi' account. User-confirmed: should be TPI Composites (Semiconductors, 13K employees, $1.3B).",
  },
  {
    customer_key: "iheartradio",
    new_sf_id: "001QQ00000D3EIJYA3",
    new_sf_name: "iHeartMedia",
    reason: "Previously unmapped. Parent company iHeartMedia (Media Production, 8.1K employees) is the closest enterprise match.",
  },
  {
    customer_key: "tsm-law",
    new_sf_id: null,
    new_sf_name: null,
    reason: "User policy: skip POV accounts. Two Tschetter Sulzer candidates exist in SF — left unmapped for now.",
  },
  {
    customer_key: "ppc",
    new_sf_id: null,
    new_sf_name: null,
    reason: "Was mapped to Ppc Lubricants (wrong). Churned customer — leaving unmapped per user rule.",
  },
  {
    customer_key: "american-towers",
    new_sf_id: null,
    new_sf_name: null,
    reason: "Was mapped to 'american income life' (wrong). Churned — unmapped per user rule.",
  },
];

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function weekKey(d: Date = new Date()): string {
  // ISO week, used by the events table for grouping.
  const target = new Date(d.valueOf());
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.floor(diff / 7);
  return `${target.getUTCFullYear()}-W${week.toString().padStart(2, "0")}`;
}

async function main() {
  const s = sb();
  console.log(`Applying ${FIXES.length} SF mapping changes…\n`);

  let ok = 0;
  let err = 0;
  for (const fix of FIXES) {
    process.stdout.write(`  ${fix.customer_key.padEnd(28)}  → ${fix.new_sf_id ?? "(unmap)"}  ... `);
    const { data: cust, error: lookupErr } = await s
      .from("customers")
      .select("id, display_name, salesforce_account_id")
      .eq("key", fix.customer_key)
      .is("deleted_at", null)
      .maybeSingle();
    if (lookupErr || !cust) {
      console.log(`NOT FOUND (${lookupErr?.message ?? "no row"})`);
      err++;
      continue;
    }
    const previousSfId = (cust as { salesforce_account_id: string | null }).salesforce_account_id;
    const customerId = (cust as { id: string }).id;
    const displayName = (cust as { display_name: string }).display_name;

    const { error: updErr } = await s
      .from("customers")
      .update({
        salesforce_account_id: fix.new_sf_id,
        last_manually_edited_at: new Date().toISOString(),
      })
      .eq("id", customerId);
    if (updErr) {
      console.log(`UPDATE FAILED (${updErr.message})`);
      err++;
      continue;
    }

    // Audit trail.
    const { error: evtErr } = await s.from("events").insert({
      customer_id: customerId,
      event_type: "SF_MAPPING_CHANGED",
      summary: `Salesforce mapping ${previousSfId ? "changed" : "set"}: ${previousSfId ?? "(none)"} → ${fix.new_sf_id ?? "(none)"}`,
      details: {
        previous_sf_id: previousSfId,
        new_sf_id: fix.new_sf_id,
        new_sf_name: fix.new_sf_name,
        reason: fix.reason,
        source: "manual-fix-script",
      },
      tags: ["mapping", "salesforce", "manual"],
      week_key: weekKey(),
    });
    if (evtErr) {
      console.log(`updated, but event log failed: ${evtErr.message}`);
    } else {
      console.log(`ok (${displayName})`);
    }
    ok++;
  }

  console.log("");
  console.log("─".repeat(50));
  console.log(`Done. ${ok} ok · ${err} error`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
