// Backfill: every customer with a non-null `partner` gets assigned to
// Chittu as AE.  Uses the manual-edit pattern (`updateCustomerManually`)
// so the change is recorded in `deliveryops_protected_fields` and the
// next Monday sync won't undo it.
//
// Usage:
//   npx tsx scripts/backfill-partner-ae.ts              # dry-run (no writes)
//   npx tsx scripts/backfill-partner-ae.ts --apply      # actually write
//
// Safety: dry-run is the default. The script prints the list of
// customers that would be updated, with their current AE for context,
// and exits without touching anything until `--apply` is passed.

// IMPORTANT: env must be loaded *before* anything imports lib/supabase
// (the admin client is created at module-load time and caches credentials).
// We use `require()` here for the same reason — top-level `import` would
// be hoisted above this block.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const CHITTU = "Chittu";

async function main() {
  // Dynamic import so env vars are in place when the supabase client init
  // runs inside lib/customers.
  const { listCustomers, updateCustomerManually } = await import("@/lib/customers");
  const apply = process.argv.includes("--apply");
  const customers = await listCustomers();

  const partnerManaged = customers.filter((c) => c.partner && c.partner.trim() !== "");
  const toUpdate = partnerManaged.filter((c) => c.ae_owner !== CHITTU);

  console.log(
    `Found ${partnerManaged.length} partner-managed customers; ${toUpdate.length} need AE → ${CHITTU}.`
  );
  if (toUpdate.length === 0) {
    console.log("Nothing to do — all partner-managed customers already assigned to Chittu.");
    process.exit(0);
  }

  console.log("");
  console.log("Customers to update:");
  console.log("");
  console.log(
    [
      "key".padEnd(25),
      "display_name".padEnd(30),
      "partner".padEnd(25),
      "current AE".padEnd(20),
      "→ new AE",
    ].join(" │ ")
  );
  console.log("─".repeat(120));
  for (const c of toUpdate) {
    console.log(
      [
        (c.key ?? "").padEnd(25),
        (c.display_name ?? "").slice(0, 28).padEnd(30),
        (c.partner ?? "").slice(0, 23).padEnd(25),
        (c.ae_owner ?? "(none)").padEnd(20),
        CHITTU,
      ].join(" │ ")
    );
  }
  console.log("");

  if (!apply) {
    console.log("Dry-run.  Re-run with --apply to write the changes.");
    process.exit(0);
  }

  console.log("Applying...");
  let ok = 0;
  let failed = 0;
  for (const c of toUpdate) {
    try {
      await updateCustomerManually(c.key, { ae_owner: CHITTU });
      console.log(`  ✓ ${c.display_name} (${c.key})`);
      ok++;
    } catch (err) {
      console.error(
        `  ✗ ${c.display_name} (${c.key}) — ${err instanceof Error ? err.message : String(err)}`
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
