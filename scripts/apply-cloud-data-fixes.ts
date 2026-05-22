// ONE-SHOT: replay every data fix from this week's session against the
// CLOUD Supabase instance (the one Vercel reads from), since earlier
// scripts ran against local Docker Supabase.
//
// Reads creds from .env.cloud (gitignored).  Prints the target Supabase
// URL up front; bails if it's not the cloud one.  Dry-run by default;
// pass --apply to write.
//
// Usage:
//   npx tsx scripts/apply-cloud-data-fixes.ts             # dry-run preview
//   npx tsx scripts/apply-cloud-data-fixes.ts --apply     # write to cloud

// Load .env.local first (gets SALESFORCE_*, MONDAY_API_TOKEN, etc — Vercel
// hides those as encrypted secrets so vercel env pull can't fetch them),
// then layer .env.cloud on top for the Supabase URL + service-role key.
// `override: true` on the second load means cloud Supabase wins for the
// keys it provides while everything else (SF, Monday) stays from local.
//
// This must run BEFORE any import that touches lib/supabase since the
// admin client is created at module-load time and caches credentials.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");

const envLocal = path.resolve(process.cwd(), ".env.local");
const envCloud = path.resolve(process.cwd(), ".env.cloud");
if (!fs.existsSync(envCloud)) {
  console.error("Missing .env.cloud — run `vercel env pull .env.cloud --environment=production` first.");
  process.exit(1);
}
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: false });
}
// Now load cloud — only overrides keys that are non-empty in .env.cloud.
// dotenv treats "" as undefined and won't override existing env vars
// when override:false, but we DO want override:true here so the cloud
// Supabase URL beats the local one.  Workaround: parse manually and
// only set keys whose cloud value is non-empty.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dotenv = require("dotenv") as typeof import("dotenv");
const cloudParsed = dotenv.parse(fs.readFileSync(envCloud));
for (const [k, v] of Object.entries(cloudParsed)) {
  if (v && v.trim() !== "") process.env[k] = v;
}

const expectedHost = "prnakdaxcpzagntgvaqf.supabase.co";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(expectedHost)) {
  console.error(
    `Refusing to run — expected NEXT_PUBLIC_SUPABASE_URL to contain '${expectedHost}', got '${url}'.`
  );
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.cloud.");
  process.exit(1);
}

console.log("───────────────────────────────────────────────────────────");
console.log("  TARGET: CLOUD SUPABASE (production)");
console.log(`  URL:    ${url}`);
console.log("───────────────────────────────────────────────────────────");
console.log("");

interface Remap {
  customerKey: string;
  sfId: string;
  expectedName: string;
}
const REMAPS: Remap[] = [
  { customerKey: "century", sfId: "001Hp00002kVX7XIAW", expectedName: "Century Distribution Systems, Inc." },
  { customerKey: "norco",   sfId: "001Hp00002kVX80IAG", expectedName: "Norco Industries" },
  { customerKey: "pepsi",   sfId: "001Hp00002pm93TIAQ", expectedName: "PepsiCo" },
];

interface Override {
  customerKey: string;
  ae_owner?: string | null;
  partner?: string | null;
  reason: string;
}
const MANUAL_OVERRIDES: Override[] = [
  { customerKey: "iheartradio",          ae_owner: "Rajesh", reason: "iHeart owned by Rajesh" },
  { customerKey: "kort-payments",        ae_owner: "Binny", partner: null, reason: "Binny is AE; remove Kai-Mation partner" },
  { customerKey: "builders-firstsource", ae_owner: "Binny",  reason: "Binny is AE for Builders Firstsource" },
  { customerKey: "srinar",               ae_owner: "Rajesh", reason: "Rajesh is AE for Srinar" },
  { customerKey: "mitie",                ae_owner: "Rajesh", reason: "Rajesh is AE for Mitie" },
];

const CHITTU = "Chittu";

async function main() {
  const apply = process.argv.includes("--apply");

  const { listCustomers, getCustomerByKey, updateCustomerManually } = await import("@/lib/customers");
  const { requireAdmin } = await import("@/lib/supabase/server");
  const { syncSalesforce } = await import("@/lib/sync/salesforce");
  const sb = requireAdmin();

  // Quick sanity: count cloud customers
  const customers = await listCustomers();
  console.log(`Cloud customers: ${customers.length}`);
  console.log("");

  // ─── Step 1: SF remaps ────────────────────────────────────────────
  console.log("STEP 1 — Salesforce account remaps");
  console.log("─".repeat(70));
  const remapsToApply: Remap[] = [];
  for (const r of REMAPS) {
    const c = await getCustomerByKey(r.customerKey);
    if (!c) {
      console.log(`  ✗ ${r.customerKey}: customer not found`);
      continue;
    }
    if (c.salesforce_account_id === r.sfId) {
      console.log(`  ✓ ${c.display_name.padEnd(20)} already mapped to ${r.sfId}`);
      continue;
    }
    console.log(
      `  → ${c.display_name.padEnd(20)} ${c.salesforce_account_id ?? "(none)"} → ${r.sfId} (${r.expectedName})`
    );
    remapsToApply.push(r);
  }
  console.log("");

  // ─── Step 2: manual AE / partner overrides ───────────────────────
  console.log("STEP 2 — manual AE / partner overrides");
  console.log("─".repeat(70));
  const overridesToApply: Override[] = [];
  for (const o of MANUAL_OVERRIDES) {
    const c = await getCustomerByKey(o.customerKey);
    if (!c) {
      console.log(`  ✗ ${o.customerKey}: customer not found`);
      continue;
    }
    const aeMatches = o.ae_owner === undefined || c.ae_owner === o.ae_owner;
    const partnerMatches = o.partner === undefined || c.partner === o.partner;
    if (aeMatches && partnerMatches) {
      console.log(`  ✓ ${c.display_name.padEnd(22)} already correct`);
      continue;
    }
    const newAe = o.ae_owner === undefined ? "(unchanged)" : (o.ae_owner ?? "(cleared)");
    const newPartner = o.partner === undefined ? "(unchanged)" : (o.partner ?? "(cleared)");
    console.log(
      `  → ${c.display_name.padEnd(22)} AE: ${(c.ae_owner ?? "(none)").padEnd(10)} → ${newAe.padEnd(10)} | partner: ${(c.partner ?? "(none)").padEnd(15)} → ${newPartner}`
    );
    overridesToApply.push(o);
  }
  console.log("");

  // ─── Step 3: partner-AE default backfill (NULL AE only) ──────────
  console.log("STEP 3 — partner-managed → Chittu (only customers with NULL AE)");
  console.log("─".repeat(70));
  const partnerManaged = customers.filter((c) => c.partner && c.partner.trim() !== "");
  const chittuToApply = partnerManaged.filter((c) => !c.ae_owner || c.ae_owner.trim() === "");
  for (const c of chittuToApply) {
    console.log(`  → ${c.display_name.padEnd(28)} partner=${(c.partner ?? "").padEnd(20)} AE: (none) → ${CHITTU}`);
  }
  if (chittuToApply.length === 0) console.log("  ✓ Nothing to do — every partner-managed customer already has an AE.");
  console.log("");

  // ─── Apply ────────────────────────────────────────────────────────
  if (!apply) {
    console.log("DRY-RUN.  Re-run with --apply to write to cloud.");
    return;
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log("APPLYING TO CLOUD");
  console.log("══════════════════════════════════════════════════════════");
  console.log("");

  // Remaps
  for (const r of remapsToApply) {
    const c = await getCustomerByKey(r.customerKey);
    if (!c) continue;
    const protectedSet = new Set(c.deliveryops_protected_fields ?? []);
    protectedSet.add("salesforce_account_id");
    const { error } = await sb
      .from("customers")
      .update({
        salesforce_account_id: r.sfId,
        deliveryops_protected_fields: Array.from(protectedSet),
        last_manually_edited_at: new Date().toISOString(),
      })
      .eq("id", c.id);
    if (error) {
      console.error(`  ✗ Remap ${r.customerKey}: ${error.message}`);
      continue;
    }
    const sync = await syncSalesforce({ customerKey: r.customerKey });
    console.log(
      `  ✓ ${c.display_name} → ${r.expectedName} (${sync.opportunities} opps, ${sync.cases} cases)`
    );
  }
  console.log("");

  // Manual overrides
  for (const o of overridesToApply) {
    try {
      const updates: Parameters<typeof updateCustomerManually>[1] = {};
      if (o.ae_owner !== undefined) updates.ae_owner = o.ae_owner;
      if (o.partner !== undefined) updates.partner = o.partner;
      await updateCustomerManually(o.customerKey, updates);
      console.log(`  ✓ ${o.customerKey} — ${o.reason}`);
    } catch (err) {
      console.error(`  ✗ ${o.customerKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("");

  // Partner → Chittu (NULL only)
  for (const c of chittuToApply) {
    try {
      await updateCustomerManually(c.key, { ae_owner: CHITTU });
      console.log(`  ✓ ${c.display_name} — partner-managed → Chittu`);
    } catch (err) {
      console.error(`  ✗ ${c.display_name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("");

  // ─── Step 4: backfill all profiles so ARR + renewal_date update ─
  console.log("STEP 3.5 — re-sync Salesforce for the 3 remapped customers");
  console.log("─".repeat(70));
  // The remap step only updates customer.salesforce_account_id; the
  // sf_accounts cache + sf_opportunities table still hold stale rows.
  // Force a fresh sync now (env is correctly merged so SF creds work).
  for (const r of REMAPS) {
    try {
      const sync = await syncSalesforce({ customerKey: r.customerKey });
      console.log(
        `  ✓ ${r.customerKey.padEnd(15)} ${sync.accounts} account, ${sync.opportunities} opps, ${sync.cases} cases${sync.errors.length > 0 ? ` — errors: ${JSON.stringify(sync.errors)}` : ""}`
      );
    } catch (err) {
      console.error(`  ✗ ${r.customerKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("");

  console.log("STEP 4 — backfill all 41 customer profiles (ARR / renewal date / industry / contacts)");
  console.log("─".repeat(70));
  // The profile backfill needs SF creds + Supabase creds. We spawn it
  // as a child process. The child's own dotenv.config({override:true})
  // would clobber the parent's merged env with .env.local values, so
  // we write a properly merged .env.local for the duration of the
  // child run: local content with the cloud Supabase URL/keys layered
  // on top.
  const { spawnSync } = await import("node:child_process");
  const envLocalPath = envLocal;
  const envLocalBak = path.resolve(process.cwd(), ".env.local.bak-cloudfix");
  const envLocalExisted = fs.existsSync(envLocalPath);
  if (envLocalExisted) fs.copyFileSync(envLocalPath, envLocalBak);
  try {
    // Build the merged file: start with local content, then upsert each
    // non-empty value from .env.cloud.
    const localContent = envLocalExisted ? fs.readFileSync(envLocalPath, "utf8") : "";
    const localParsed = dotenv.parse(localContent);
    const merged: Record<string, string> = { ...localParsed };
    for (const [k, v] of Object.entries(cloudParsed)) {
      if (v && v.trim() !== "") merged[k] = v;
    }
    const mergedText = Object.entries(merged)
      .map(([k, v]) => {
        // Quote values that contain spaces or special chars so dotenv
        // re-reads them correctly.
        const needsQuote = /[\s"'#=]/.test(v);
        return needsQuote ? `${k}="${v.replace(/"/g, '\\"')}"` : `${k}=${v}`;
      })
      .join("\n");
    fs.writeFileSync(envLocalPath, mergedText);

    const res = spawnSync("npx", ["tsx", "scripts/backfill-profiles.ts"], {
      stdio: "inherit",
      env: process.env,
    });
    if (res.status !== 0) {
      console.error(`Profile backfill exited with code ${res.status}`);
    }
  } finally {
    if (envLocalExisted) {
      fs.copyFileSync(envLocalBak, envLocalPath);
      fs.unlinkSync(envLocalBak);
    } else if (fs.existsSync(envLocalPath)) {
      fs.unlinkSync(envLocalPath);
    }
  }
  console.log("");

  console.log("══════════════════════════════════════════════════════════");
  console.log("DONE.  Hard-refresh delivery-ops-delta.vercel.app/customers");
  console.log("══════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
