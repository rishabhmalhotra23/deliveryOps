// One-shot: Century in DeliveryOps is synced against the wrong Salesforce
// account. Re-map it to the correct one ("Century Supply Chains") and
// re-sync the SF data so ARR, opportunities, and cases come out right.
//
// Usage:
//   npx tsx scripts/remap-century.ts                       # diagnose (no writes)
//   npx tsx scripts/remap-century.ts --apply <sf_id>       # write the mapping
//
// The script prints the current Century customer, the current SF mapping,
// every SF account that has "Century" in the name (sorted by AnnualRevenue
// desc), and an inferred best match. To commit, pass --apply with the
// chosen SF account Id.

// IMPORTANT: env must load before lib/supabase touches the singleton.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

interface SfAccount {
  Id: string;
  Name: string;
  AnnualRevenue: number | null;
  Industry: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Website: string | null;
  Owner: { Name: string } | null;
}

let _sfToken: { token: string; instanceUrl: string; expiresAt: number } | null = null;

async function sfToken(): Promise<{ token: string; instanceUrl: string }> {
  if (_sfToken && _sfToken.expiresAt > Date.now() + 60_000) return _sfToken;
  const instance = process.env.SALESFORCE_INSTANCE_URL!.replace(/\/+$/, "");
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SALESFORCE_CLIENT_ID!,
    client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
  });
  const res = await fetch(`${instance}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = (await res.json()) as { access_token: string; instance_url: string };
  _sfToken = {
    token: json.access_token,
    instanceUrl: json.instance_url,
    expiresAt: Date.now() + 3500 * 1000,
  };
  return _sfToken;
}

async function sfQuery<T>(soql: string): Promise<T[]> {
  const { token, instanceUrl } = await sfToken();
  const res = await fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`SF query failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { records: T[] };
  return body.records;
}

async function sfAccount(sfId: string): Promise<SfAccount | null> {
  const records = await sfQuery<SfAccount>(
    `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website, Owner.Name FROM Account WHERE Id = '${sfId}' LIMIT 1`
  );
  return records[0] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const sfIdArg = args.find((a) => a !== "--apply" && !a.startsWith("--"));

  const { getCustomerByKey, updateCustomerManually } = await import("@/lib/customers");
  const { requireAdmin } = await import("@/lib/supabase/server");

  const century = await getCustomerByKey("century");
  if (!century) {
    console.error("No customer with key='century' found in DeliveryOps.");
    process.exit(1);
  }

  console.log("Current DeliveryOps Century customer:");
  console.log(`  key:                   ${century.key}`);
  console.log(`  display_name:          ${century.display_name}`);
  console.log(`  salesforce_account_id: ${century.salesforce_account_id ?? "(none)"}`);
  console.log(`  partner:               ${century.partner ?? "(none)"}`);
  console.log(`  ae_owner:              ${century.ae_owner ?? "(none)"}`);
  console.log("");

  // Pull current sf_account cache row so we can see what we're syncing
  const sb = requireAdmin();
  const { data: cachedRow } = await sb
    .from("sf_accounts")
    .select("sf_id, name, annual_revenue, website, billing_country")
    .eq("customer_id", century.id)
    .maybeSingle();
  if (cachedRow) {
    console.log("Currently cached SF account row (sf_accounts table):");
    console.log(`  sf_id:           ${cachedRow.sf_id}`);
    console.log(`  name:            ${cachedRow.name}`);
    console.log(`  annual_revenue:  $${(cachedRow.annual_revenue ?? 0).toLocaleString()}`);
    console.log(`  website:         ${cachedRow.website ?? "(none)"}`);
    console.log(`  billing_country: ${cachedRow.billing_country ?? "(none)"}`);
    console.log("");
  } else {
    console.log("No cached SF account row yet for this customer.");
    console.log("");
  }

  // Also pull the current profile so we know what ARR we're showing
  const { data: profileRow } = await sb
    .from("profiles")
    .select("arr, renewal_date")
    .eq("customer_id", century.id)
    .maybeSingle();
  if (profileRow) {
    console.log("Current Century profile (profiles table):");
    console.log(`  arr:           $${(profileRow.arr ?? 0).toLocaleString()}`);
    console.log(`  renewal_date:  ${profileRow.renewal_date ?? "(none)"}`);
    console.log("");
  }

  // Search Salesforce for every account whose name contains "Century"
  console.log("Salesforce accounts with 'Century' in the name (top 20 by revenue):");
  const candidates = await sfQuery<SfAccount>(
    `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website, Owner.Name
     FROM Account
     WHERE Name LIKE '%Century%'
     ORDER BY AnnualRevenue DESC NULLS LAST
     LIMIT 20`
  );
  if (candidates.length === 0) {
    console.log("  (no matches)");
    process.exit(0);
  }
  console.log("");
  console.log(
    [
      "#".padEnd(3),
      "SF Id".padEnd(20),
      "Name".padEnd(40),
      "Revenue".padEnd(15),
      "Industry".padEnd(18),
      "Location",
    ].join(" │ ")
  );
  console.log("─".repeat(130));
  candidates.forEach((a, i) => {
    const isCurrent = a.Id === century.salesforce_account_id ? "*" : " ";
    const rev =
      a.AnnualRevenue != null ? `$${(a.AnnualRevenue / 1_000_000).toFixed(1)}M` : "—";
    const loc = [a.BillingCity, a.BillingCountry].filter(Boolean).join(", ") || "—";
    console.log(
      [
        `${isCurrent}${(i + 1).toString().padEnd(2)}`,
        a.Id.padEnd(20),
        (a.Name ?? "").slice(0, 38).padEnd(40),
        rev.padEnd(15),
        (a.Industry ?? "—").slice(0, 16).padEnd(18),
        loc.slice(0, 30),
      ].join(" │ ")
    );
  });
  console.log("");
  console.log("Rows starred with `*` are the current mapping.");
  console.log("");

  // Try to infer the best match — "Century Supply Chains" is the user's
  // stated correct name.
  const bestMatch = candidates.find((a) =>
    /century\s*supply\s*chain/i.test(a.Name ?? "")
  );
  if (bestMatch) {
    console.log(`Inferred best match: ${bestMatch.Name} (${bestMatch.Id})`);
    if (bestMatch.Id === century.salesforce_account_id) {
      console.log("That's already the current mapping — nothing to do.");
      process.exit(0);
    }
    console.log("");
  }

  if (!apply) {
    console.log("Dry-run.  To commit a remap:");
    console.log(`  npx tsx scripts/remap-century.ts --apply ${bestMatch?.Id ?? "<sf_id>"}`);
    process.exit(0);
  }

  if (!sfIdArg) {
    console.error("--apply requires the target SF account Id as an argument.");
    process.exit(1);
  }
  const target = await sfAccount(sfIdArg);
  if (!target) {
    console.error(`SF account ${sfIdArg} not found.`);
    process.exit(1);
  }

  console.log(`Applying: customer 'century' → SF account ${target.Id} (${target.Name})`);
  await updateCustomerManually("century", {
    // updateCustomerManually only accepts the canonical manually-edited
    // fields; salesforce_account_id isn't in that whitelist. We update
    // directly through the supabase admin client and stamp the protected
    // fields ourselves.
  });
  // Direct update — salesforce_account_id isn't in SYNC_OWNED_BY_DELIVERY_OPS_WHEN_EDITED.
  const protectedSet = new Set(century.deliveryops_protected_fields ?? []);
  protectedSet.add("salesforce_account_id");
  const { error } = await sb
    .from("customers")
    .update({
      salesforce_account_id: target.Id,
      deliveryops_protected_fields: Array.from(protectedSet),
      last_manually_edited_at: new Date().toISOString(),
    })
    .eq("id", century.id);
  if (error) {
    console.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
  console.log("Customer row updated.");
  console.log("");
  console.log("Now re-sync to pull fresh SF data:");
  console.log(`  curl -X POST http://localhost:4001/api/dev/sync/run \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"sources":["salesforce"],"customer_key":"century"}'`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
