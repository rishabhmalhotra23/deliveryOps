// One-off debug dump for the Century customer — used to diagnose why the
// UI might show stale data.

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
  const { requireAdmin } = await import("@/lib/supabase/server");
  const { categoryFromCustomer } = await import("@/app/_components/brand");
  const sb = requireAdmin();
  const { data: c } = await sb.from("customers").select("*").eq("key", "century").maybeSingle();
  if (!c) { console.error("Century not found."); process.exit(1); }
  const cust = c as Record<string, unknown>;
  const customerId = cust.id as string;
  const { data: p } = await sb.from("profiles").select("*").eq("customer_id", customerId).maybeSingle();
  const profile = (p ?? {}) as Record<string, unknown>;
  const { data: a } = await sb.from("sf_accounts").select("*").eq("customer_id", customerId).maybeSingle();
  const account = (a ?? {}) as Record<string, unknown>;

  console.log("CUSTOMER ROW (customers table):");
  console.log("  display_name:          ", cust.display_name);
  console.log("  salesforce_account_id: ", cust.salesforce_account_id);
  console.log("  partner:               ", cust.partner);
  console.log("  ae_owner:              ", cust.ae_owner);
  console.log("  custom_category:       ", cust.custom_category);
  console.log("  lifecycle_group:       ", cust.lifecycle_group);
  console.log("  protected_fields:      ", cust.deliveryops_protected_fields);
  console.log("  updated_at:            ", cust.updated_at);
  console.log("");
  console.log("PROFILE ROW (profiles table):");
  console.log("  arr:           ", profile.arr);
  console.log("  renewal_date:  ", profile.renewal_date);
  console.log("  industry:      ", profile.industry);
  console.log("  website:       ", profile.website);
  console.log("  updated_at:    ", profile.updated_at);
  console.log("");
  console.log("SF ACCOUNT ROW (sf_accounts cache):");
  console.log("  sf_id:           ", account.sf_id);
  console.log("  name:            ", account.name);
  console.log("  annual_revenue:  ", account.annual_revenue);
  console.log("  industry:        ", account.industry);
  console.log("  website:         ", account.website);
  console.log("  synced_at:       ", account.synced_at);
  console.log("");
  console.log(
    "DERIVED CATEGORY (what the UI shows):",
    categoryFromCustomer(
      { custom_category: cust.custom_category as string | null, lifecycle_group: cust.lifecycle_group as string | null },
      { renewal_date: profile.renewal_date as string | null, annual_revenue: account.annual_revenue as number | null }
    )
  );

  const { count: oppCount } = await sb
    .from("sf_opportunities")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  console.log("");
  console.log("Cached opportunities:", oppCount);
}
main().catch(e => { console.error(e); process.exit(1); });
