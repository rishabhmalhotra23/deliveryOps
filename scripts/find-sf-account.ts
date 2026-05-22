// Generic SF account search by name + opp-amount range. Reuse for any
// customer mismapping diagnosis.
//
// Usage:
//   npx tsx scripts/find-sf-account.ts "Norco"
//   npx tsx scripts/find-sf-account.ts "Norco Industries"

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

async function sf<T>(soql: string): Promise<T[]> {
  const { token, instance } = await sfToken();
  const res = await fetch(`${instance}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SF: ${res.status} ${await res.text()}`);
  return (await res.json() as { records: T[] }).records;
}

interface Account {
  Id: string;
  Name: string;
  AnnualRevenue: number | null;
  Industry: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Website: string | null;
}
interface Opp {
  Id: string;
  Name: string;
  Amount: number | null;
  StageName: string | null;
  CloseDate: string | null;
  IsWon: boolean;
  IsClosed: boolean;
  AccountId: string;
  Account: { Id: string; Name: string } | null;
}

async function main() {
  const term = process.argv[2];
  if (!term) {
    console.error('Usage: npx tsx scripts/find-sf-account.ts "<search term>"');
    process.exit(1);
  }
  console.log(`Searching SF accounts where Name LIKE '%${term}%'…`);
  console.log("");

  const accounts = await sf<Account>(
    `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website
     FROM Account WHERE Name LIKE '%${term}%' ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 30`
  );
  console.log(
    [
      "SF Id".padEnd(20),
      "Name".padEnd(35),
      "Revenue".padEnd(12),
      "Industry".padEnd(20),
      "Location",
    ].join(" │ ")
  );
  console.log("─".repeat(130));
  for (const a of accounts) {
    const rev =
      a.AnnualRevenue != null
        ? a.AnnualRevenue >= 1_000_000
          ? `$${(a.AnnualRevenue / 1_000_000).toFixed(1)}M`
          : `$${(a.AnnualRevenue / 1_000).toFixed(0)}K`
        : "—";
    const loc = [a.BillingCity, a.BillingCountry].filter(Boolean).join(", ") || "—";
    console.log(
      [
        a.Id.padEnd(20),
        (a.Name ?? "").slice(0, 33).padEnd(35),
        rev.padEnd(12),
        (a.Industry ?? "—").slice(0, 18).padEnd(20),
        loc.slice(0, 30),
      ].join(" │ ")
    );
  }
  console.log("");

  // Also show opportunities with this term in either OPP NAME or ACCOUNT NAME
  console.log(`Opportunities with '${term}' in name or account (top 30 by amount):`);
  const opps = await sf<Opp>(
    `SELECT Id, Name, Amount, StageName, CloseDate, IsClosed, IsWon,
            AccountId, Account.Id, Account.Name
     FROM Opportunity
     WHERE (Name LIKE '%${term}%' OR Account.Name LIKE '%${term}%')
     ORDER BY Amount DESC NULLS LAST
     LIMIT 30`
  );
  console.log("");
  console.log(
    [
      "AccountId".padEnd(20),
      "Account".padEnd(28),
      "Opp name".padEnd(45),
      "Amount".padEnd(8),
      "Stage".padEnd(15),
      "Close",
    ].join(" │ ")
  );
  console.log("─".repeat(150));
  for (const o of opps) {
    const amt = o.Amount != null ? `$${(o.Amount / 1000).toFixed(0)}K` : "—";
    const won = o.IsWon ? "✓" : o.IsClosed ? "✗" : "○";
    console.log(
      [
        (o.Account?.Id ?? "—").padEnd(20),
        (o.Account?.Name ?? "—").slice(0, 26).padEnd(28),
        ((won + " ") + (o.Name ?? "")).slice(0, 43).padEnd(45),
        amt.padEnd(8),
        (o.StageName ?? "—").slice(0, 13).padEnd(15),
        o.CloseDate ?? "—",
      ].join(" │ ")
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
