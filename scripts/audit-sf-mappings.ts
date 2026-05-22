// Audit every customer's SF mapping for "looks suspicious" signals:
//   - SF account has $0 / null AnnualRevenue
//   - Zero cached opportunities (every customer that's actually doing
//     business with us has at least one closed-won opp)
//   - Customer is mapped to a small/empty SF account when a much larger
//     same-name account also exists
//
// These patterns flagged Century → CenturyLink and Norco → Norco Inc
// as mismaps; this audit catches the rest in one pass.

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
  const { listCustomers } = await import("@/lib/customers");
  const { requireAdmin } = await import("@/lib/supabase/server");
  const sb = requireAdmin();

  const customers = await listCustomers();

  // Pull all sf_accounts cache rows, opp counts, profile arr in three
  // round-trips.
  const { data: accounts } = await sb
    .from("sf_accounts")
    .select("customer_id, sf_id, name, annual_revenue");
  const { data: opps } = await sb.from("sf_opportunities").select("customer_id");
  const { data: profiles } = await sb.from("profiles").select("customer_id, arr");

  const accountByC = new Map<string, { sf_id: string; name: string; annual_revenue: number | null }>();
  for (const a of (accounts as Array<{ customer_id: string; sf_id: string; name: string; annual_revenue: number | null }> | null) ?? []) {
    accountByC.set(a.customer_id, { sf_id: a.sf_id, name: a.name, annual_revenue: a.annual_revenue });
  }
  const oppCountByC = new Map<string, number>();
  for (const o of (opps as Array<{ customer_id: string }> | null) ?? []) {
    oppCountByC.set(o.customer_id, (oppCountByC.get(o.customer_id) ?? 0) + 1);
  }
  const arrByC = new Map<string, number>();
  for (const p of (profiles as Array<{ customer_id: string; arr: number | null }> | null) ?? []) {
    arrByC.set(p.customer_id, p.arr ?? 0);
  }

  // Score each customer's mapping
  type Row = {
    customer: string;
    key: string;
    mapped: boolean;
    sfId: string;
    sfName: string;
    sfRevenue: number;
    oppCount: number;
    arr: number;
    flags: string[];
  };
  const rows: Row[] = [];
  for (const c of customers) {
    const flags: string[] = [];
    if (!c.salesforce_account_id) {
      flags.push("not mapped");
      rows.push({
        customer: c.display_name,
        key: c.key,
        mapped: false,
        sfId: "",
        sfName: "",
        sfRevenue: 0,
        oppCount: 0,
        arr: arrByC.get(c.id) ?? 0,
        flags,
      });
      continue;
    }
    const a = accountByC.get(c.id);
    const oppCount = oppCountByC.get(c.id) ?? 0;
    if (!a) flags.push("no cache row");
    if (a && (a.annual_revenue ?? 0) === 0) flags.push("$0 SF revenue");
    if (oppCount === 0) flags.push("0 opps");
    if (a && a.sf_id !== c.salesforce_account_id) flags.push("cache sf_id mismatch");
    rows.push({
      customer: c.display_name,
      key: c.key,
      mapped: true,
      sfId: c.salesforce_account_id,
      sfName: a?.name ?? "(no cache)",
      sfRevenue: a?.annual_revenue ?? 0,
      oppCount,
      arr: arrByC.get(c.id) ?? 0,
      flags,
    });
  }

  // Print suspicious ones first
  const suspicious = rows.filter((r) => r.flags.length > 0);
  console.log(`Suspicious mappings: ${suspicious.length}`);
  console.log("");
  console.log(
    [
      "customer".padEnd(28),
      "SF account name".padEnd(35),
      "SF rev".padEnd(10),
      "opps".padEnd(5),
      "ARR".padEnd(10),
      "flags",
    ].join(" │ ")
  );
  console.log("─".repeat(140));
  for (const r of suspicious) {
    const rev =
      r.sfRevenue >= 1_000_000
        ? `$${(r.sfRevenue / 1_000_000).toFixed(1)}M`
        : r.sfRevenue > 0
          ? `$${(r.sfRevenue / 1000).toFixed(0)}K`
          : "—";
    const arr = r.arr > 0 ? `$${(r.arr / 1000).toFixed(0)}K` : "—";
    console.log(
      [
        r.customer.slice(0, 26).padEnd(28),
        r.sfName.slice(0, 33).padEnd(35),
        rev.padEnd(10),
        String(r.oppCount).padEnd(5),
        arr.padEnd(10),
        r.flags.join(", "),
      ].join(" │ ")
    );
  }
  console.log("");
  console.log(`Total customers: ${rows.length}`);
  console.log(`Clean mappings:  ${rows.length - suspicious.length}`);
  console.log("");
  console.log(
    'For any flagged customer, run:\n  npx tsx scripts/find-sf-account.ts "<name>"\nthen:\n  npx tsx scripts/remap-customer.ts <key> <sf_id> --apply'
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
