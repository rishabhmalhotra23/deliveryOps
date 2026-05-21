// Re-pull SF data for Century after the account remap. Runs the same
// syncSalesforce({customerKey:"century"}) logic the daily cron uses,
// scoped to just one customer.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

async function main() {
  const { syncSalesforce } = await import("@/lib/sync/salesforce");
  const { requireAdmin } = await import("@/lib/supabase/server");

  console.log("Re-syncing Century from Salesforce…");
  const result = await syncSalesforce({ customerKey: "century" });
  console.log("Sync result:", JSON.stringify(result, null, 2));

  // Show the new cached account
  const sb = requireAdmin();
  const { data: customer } = await sb
    .from("customers")
    .select("id")
    .eq("key", "century")
    .maybeSingle();
  if (!customer) {
    console.error("Customer not found post-sync.");
    process.exit(1);
  }
  const { data: account } = await sb
    .from("sf_accounts")
    .select("sf_id, name, annual_revenue, industry, billing_country")
    .eq("customer_id", (customer as { id: string }).id)
    .maybeSingle();
  console.log("");
  console.log("New cached account row:");
  console.log(account);

  const { data: opps } = await sb
    .from("sf_opportunities")
    .select("name, stage_name, amount, close_date, is_won, is_closed, probability")
    .eq("customer_id", (customer as { id: string }).id)
    .order("close_date", { ascending: false });
  console.log("");
  console.log(`Opportunities: ${opps?.length ?? 0}`);
  for (const o of (opps ?? []) as Array<{
    name: string;
    stage_name: string | null;
    amount: number | null;
    close_date: string | null;
    is_won: boolean;
    is_closed: boolean;
    probability: number | null;
  }>) {
    const tag = o.is_won ? "WON " : o.is_closed ? "LOST" : "OPEN";
    const amt = o.amount != null ? `$${(o.amount / 1000).toFixed(0)}K` : "—";
    console.log(`  ${tag} ${(o.close_date ?? "—").padEnd(10)} ${amt.padEnd(8)} ${o.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
