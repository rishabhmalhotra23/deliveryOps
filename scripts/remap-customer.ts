// Remap a DeliveryOps customer to a different Salesforce account, then
// re-sync SF + re-derive the profile.  Used when the initial SF matcher
// picked the wrong entity (e.g. "Norco, Inc." vs "Norco Industries",
// "CenturyLink" vs "Century Distribution Systems").
//
// Usage:
//   npx tsx scripts/remap-customer.ts <customer_key> <sf_account_id>
//   npx tsx scripts/remap-customer.ts <customer_key> <sf_account_id> --apply

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

let _tok: { token: string; instance: string } | null = null;
async function sfToken() {
  if (_tok) return _tok;
  const instance = process.env.SALESFORCE_INSTANCE_URL!.replace(/\/+$/, "");
  const res = await fetch(`${instance}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
    }).toString(),
  });
  const json = (await res.json()) as { access_token: string; instance_url: string };
  _tok = { token: json.access_token, instance: json.instance_url };
  return _tok;
}

interface SfAccount {
  Id: string;
  Name: string;
  AnnualRevenue: number | null;
  Industry: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Website: string | null;
}

async function fetchSfAccount(sfId: string): Promise<SfAccount | null> {
  const { token, instance } = await sfToken();
  const soql = `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website
                FROM Account WHERE Id = '${sfId}' LIMIT 1`;
  const res = await fetch(`${instance}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SF: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { records: SfAccount[] };
  return body.records[0] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [customerKey, sfId] = positional;
  if (!customerKey || !sfId) {
    console.error("Usage: npx tsx scripts/remap-customer.ts <customer_key> <sf_account_id> [--apply]");
    process.exit(1);
  }

  const { getCustomerByKey } = await import("@/lib/customers");
  const { requireAdmin } = await import("@/lib/supabase/server");
  const sb = requireAdmin();

  const customer = await getCustomerByKey(customerKey);
  if (!customer) {
    console.error(`No customer with key='${customerKey}'.`);
    process.exit(1);
  }
  const target = await fetchSfAccount(sfId);
  if (!target) {
    console.error(`SF account ${sfId} not found.`);
    process.exit(1);
  }

  const { data: cachedAccount } = await sb
    .from("sf_accounts")
    .select("sf_id, name, annual_revenue")
    .eq("customer_id", customer.id)
    .maybeSingle();

  console.log(`Customer:           ${customer.display_name} (${customer.key})`);
  console.log(`Currently mapped:   ${customer.salesforce_account_id ?? "(none)"}`);
  if (cachedAccount) {
    const a = cachedAccount as { name: string; annual_revenue: number | null };
    console.log(`Cached SF row:      ${a.name} ($${((a.annual_revenue ?? 0) / 1_000_000).toFixed(1)}M)`);
  }
  console.log("");
  console.log(`Target SF account:`);
  console.log(`  Id:              ${target.Id}`);
  console.log(`  Name:            ${target.Name}`);
  console.log(`  AnnualRevenue:   $${((target.AnnualRevenue ?? 0) / 1_000_000).toFixed(1)}M`);
  console.log(`  Industry:        ${target.Industry ?? "—"}`);
  console.log(`  Location:        ${[target.BillingCity, target.BillingCountry].filter(Boolean).join(", ") || "—"}`);
  console.log(`  Website:         ${target.Website ?? "—"}`);
  console.log("");

  if (target.Id === customer.salesforce_account_id) {
    console.log("Already mapped to this SF account — nothing to do.");
    return;
  }

  if (!apply) {
    console.log("Dry-run.  Re-run with --apply to write the mapping + re-sync.");
    return;
  }

  // 1. Update the customer row (protect the field so the next sync won't undo it)
  const protectedSet = new Set(customer.deliveryops_protected_fields ?? []);
  protectedSet.add("salesforce_account_id");
  const { error } = await sb
    .from("customers")
    .update({
      salesforce_account_id: target.Id,
      deliveryops_protected_fields: Array.from(protectedSet),
      last_manually_edited_at: new Date().toISOString(),
    })
    .eq("id", customer.id);
  if (error) {
    console.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
  console.log("✓ Customer row updated.");

  // 2. Re-sync from SF (this also scrubs the orphan sf_accounts row thanks
  //    to the per-customer scrub fix landed earlier today)
  console.log("✓ Triggering Salesforce re-sync…");
  const { syncSalesforce } = await import("@/lib/sync/salesforce");
  const result = await syncSalesforce({ customerKey: customer.key });
  console.log(
    `✓ Sync complete: ${result.accounts} account, ${result.opportunities} opps, ${result.cases} cases.`
  );

  // 3. Refresh the profile (industry, ARR, renewal_date all derive from SF)
  console.log("");
  console.log("Re-derive the profile so ARR + renewal_date update:");
  console.log("  npx tsx scripts/backfill-profiles.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
