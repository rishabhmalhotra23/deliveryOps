// Inspect how a customer's ARR is currently being derived from SF opps.
// Use it to spot when the picker grabs only one stream and misses
// concurrent processes.
//
// Usage:
//   npx tsx scripts/inspect-arr.ts century
//   npx tsx scripts/inspect-arr.ts norco

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
  const key = process.argv[2];
  if (!key) {
    console.error("Usage: npx tsx scripts/inspect-arr.ts <customer-key>");
    process.exit(1);
  }
  const { requireAdmin } = await import("@/lib/supabase/server");
  const sb = requireAdmin();

  const { data: c } = await sb.from("customers").select("*").eq("key", key).maybeSingle();
  if (!c) { console.error(`No customer with key='${key}'.`); process.exit(1); }
  const cust = c as Record<string, unknown>;
  const customerId = cust.id as string;

  const { data: profile } = await sb
    .from("profiles")
    .select("arr, renewal_date, last_updated_by")
    .eq("customer_id", customerId)
    .maybeSingle();
  const { data: account } = await sb
    .from("sf_accounts")
    .select("sf_id, name, annual_revenue, website")
    .eq("customer_id", customerId)
    .maybeSingle();
  const { data: opps } = await sb
    .from("sf_opportunities")
    .select("name, stage_name, amount, close_date, is_won, is_closed, probability, raw")
    .eq("customer_id", customerId)
    .order("close_date", { ascending: false });

  console.log(`Customer: ${cust.display_name as string} (${key})`);
  console.log(`SF Account: ${(account as { name?: string } | null)?.name ?? "(none)"}`);
  console.log(`SF Account ARR (company-wide, AnnualRevenue): $${(((account as { annual_revenue?: number } | null)?.annual_revenue ?? 0) / 1_000_000).toFixed(1)}M`);
  console.log(`profile.arr (currently): $${(((profile as { arr?: number } | null)?.arr ?? 0) / 1000).toFixed(1)}K`);
  console.log(`profile.renewal_date: ${(profile as { renewal_date?: string } | null)?.renewal_date ?? "(none)"}`);
  console.log("");
  console.log(`Opportunities (${opps?.length ?? 0}):`);
  console.log("");
  console.log(
    [
      "close_date".padEnd(12),
      "state".padEnd(6),
      "stage".padEnd(20),
      "amount".padEnd(10),
      "type (raw)".padEnd(28),
      "name",
    ].join(" │ ")
  );
  console.log("─".repeat(140));

  type OppRow = {
    name: string;
    stage_name: string | null;
    amount: number | null;
    close_date: string | null;
    is_won: boolean;
    is_closed: boolean;
    probability: number | null;
    raw: { Type?: string } | null;
  };
  const oppList = (opps as OppRow[] | null) ?? [];

  // Sort: most-recent close_date first
  for (const o of oppList) {
    const state = o.is_won ? "WON" : o.is_closed ? "LOST" : "OPEN";
    const amt = o.amount != null ? `$${(o.amount / 1000).toFixed(0)}K` : "—";
    const type = o.raw?.Type ?? "—";
    console.log(
      [
        (o.close_date ?? "—").padEnd(12),
        state.padEnd(6),
        (o.stage_name ?? "—").slice(0, 18).padEnd(20),
        amt.padEnd(10),
        type.slice(0, 26).padEnd(28),
        (o.name ?? "").slice(0, 60),
      ].join(" │ ")
    );
  }
  console.log("");

  // Compute candidate ARR figures so we can see what the right derivation
  // should be.

  // 1. Latest open or signed renewal opp (the current rule)
  const latestActive = oppList
    .filter((o) => o.is_won || (!o.is_closed && (o.probability ?? 0) >= 50))
    .sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""))[0];
  console.log(
    `(A) Latest active opp (current rule): $${
      latestActive?.amount != null ? (latestActive.amount / 1000).toFixed(1) + "K" : "—"
    } — ${latestActive?.name ?? "(none)"}`
  );

  // 2. Sum of latest active opp PER stream (so concurrent processes add up)
  // Group by Type — Renewal vs Expansion vs other
  const byType = new Map<string, OppRow[]>();
  for (const o of oppList) {
    if (o.is_closed && !o.is_won) continue; // skip lost
    const t = o.raw?.Type ?? "(no type)";
    const arr = byType.get(t) ?? [];
    arr.push(o);
    byType.set(t, arr);
  }
  console.log("");
  console.log("(B) Latest active opp per Type:");
  let sumByType = 0;
  for (const [t, list] of byType) {
    const latest = list.sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""))[0];
    if (!latest?.amount) continue;
    sumByType += latest.amount;
    console.log(`    ${t.padEnd(28)} $${(latest.amount / 1000).toFixed(1)}K — ${latest.name.slice(0, 60)}`);
  }
  console.log(`    TOTAL: $${(sumByType / 1000).toFixed(1)}K`);
  console.log("");

  // 3. Sum of all WON opps in the last 12 months (running ARR)
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const wonLast12 = oppList.filter(
    (o) => o.is_won && (o.close_date ?? "") >= oneYearAgo && o.amount != null
  );
  const sumWonLast12 = wonLast12.reduce((s, o) => s + (o.amount ?? 0), 0);
  console.log(
    `(C) Sum of WON opps closed in last 12 months: $${(sumWonLast12 / 1000).toFixed(1)}K (across ${wonLast12.length} opps)`
  );
  for (const o of wonLast12) {
    console.log(`    ${o.close_date}  $${((o.amount ?? 0) / 1000).toFixed(0)}K  ${o.name.slice(0, 70)}`);
  }
  console.log("");

  // 4. Sum of WON renewals + expansions in current FY (running book)
  const fyStart = "2026-02-01"; // Kognitos FY starts Feb
  const fyOpps = oppList.filter(
    (o) => o.is_won && (o.close_date ?? "") >= fyStart && o.amount != null
  );
  const sumFy = fyOpps.reduce((s, o) => s + (o.amount ?? 0), 0);
  console.log(`(D) Sum of WON opps since FY26 start (2026-02-01): $${(sumFy / 1000).toFixed(1)}K (${fyOpps.length} opps)`);
  for (const o of fyOpps) {
    console.log(`    ${o.close_date}  $${((o.amount ?? 0) / 1000).toFixed(0)}K  ${o.name.slice(0, 70)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
