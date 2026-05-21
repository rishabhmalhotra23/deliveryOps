// One-shot fixups for a handful of customer AE / partner mismappings
// pointed out by the user.  Uses updateCustomerManually so every change
// is recorded in deliveryops_protected_fields and the next sync won't
// undo it.
//
// Usage:
//   npx tsx scripts/fix-customer-assignments.ts              # dry-run
//   npx tsx scripts/fix-customer-assignments.ts --apply      # write

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

interface Fix {
  customerKey: string;
  ae_owner?: string | null;
  partner?: string | null;
  reason: string;
}

const FIXES: Fix[] = [
  {
    customerKey: "iheartradio",
    ae_owner: "Rajesh",
    reason: "iHeart is owned by Rajesh — overrides default partner-managed → Chittu rule",
  },
  {
    customerKey: "kort-payments",
    ae_owner: "Binny",
    partner: null,
    reason: "Remove Kai-Mation as partner; AE is Binny",
  },
  {
    customerKey: "builders-firstsource",
    ae_owner: "Binny",
    reason: "Builders Firstsource AE is Binny (not Chittu)",
  },
  {
    customerKey: "srinar",
    ae_owner: "Rajesh",
    reason: "Srinar AE is Rajesh (not Chittu)",
  },
  {
    customerKey: "mitie",
    ae_owner: "Rajesh",
    reason: "Mitie AE is Rajesh (not Chittu)",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const { getCustomerByKey, updateCustomerManually } = await import("@/lib/customers");

  console.log("Resolving current state…");
  console.log("");
  const rows: Array<{
    fix: Fix;
    currentAe: string | null;
    currentPartner: string | null;
    customerDisplayName: string;
    skip?: string;
  }> = [];
  for (const fix of FIXES) {
    const c = await getCustomerByKey(fix.customerKey);
    if (!c) {
      rows.push({
        fix,
        currentAe: null,
        currentPartner: null,
        customerDisplayName: `(missing: ${fix.customerKey})`,
        skip: "customer not found",
      });
      continue;
    }
    rows.push({
      fix,
      currentAe: c.ae_owner,
      currentPartner: c.partner,
      customerDisplayName: c.display_name,
    });
  }

  console.log(
    [
      "customer".padEnd(28),
      "AE: current".padEnd(15),
      "→ AE: new".padEnd(15),
      "partner: current".padEnd(20),
      "→ partner: new",
    ].join(" │ ")
  );
  console.log("─".repeat(110));
  for (const r of rows) {
    if (r.skip) {
      console.log(`  ${r.customerDisplayName.padEnd(26)}  SKIP — ${r.skip}`);
      continue;
    }
    const newAe = r.fix.ae_owner ?? "(unchanged)";
    const newPartner =
      r.fix.partner === undefined
        ? "(unchanged)"
        : r.fix.partner === null
          ? "(cleared)"
          : r.fix.partner;
    console.log(
      [
        r.customerDisplayName.slice(0, 26).padEnd(28),
        (r.currentAe ?? "(none)").padEnd(15),
        newAe.padEnd(15),
        (r.currentPartner ?? "(none)").slice(0, 18).padEnd(20),
        newPartner,
      ].join(" │ ")
    );
  }
  console.log("");

  if (!apply) {
    console.log("Dry-run.  Re-run with --apply to write.");
    return;
  }

  console.log("Applying…");
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.skip) continue;
    try {
      const updates: Parameters<typeof updateCustomerManually>[1] = {};
      if (r.fix.ae_owner !== undefined) updates.ae_owner = r.fix.ae_owner;
      if (r.fix.partner !== undefined) updates.partner = r.fix.partner;
      await updateCustomerManually(r.fix.customerKey, updates);
      console.log(`  ✓ ${r.customerDisplayName} — ${r.fix.reason}`);
      ok++;
    } catch (err) {
      console.error(
        `  ✗ ${r.customerDisplayName} — ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }
  console.log("");
  console.log(`Done. ${ok} updated, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
