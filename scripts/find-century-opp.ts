// Look for the actual Century deal in Salesforce by opportunity amount
// (user said ARR ≈ $284K). Joins Opportunity → Account so we get the
// real account that owns the deal.

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

interface Opp {
  Id: string;
  Name: string;
  Amount: number | null;
  StageName: string | null;
  CloseDate: string | null;
  IsClosed: boolean;
  IsWon: boolean;
  AccountId: string;
  Account: { Id: string; Name: string; Industry: string | null; AnnualRevenue: number | null } | null;
}

async function main() {
  console.log("Searching SF opportunities with 'Century' in name OR account…");
  console.log("");

  // Opportunities where the OWNING account name contains "Century"
  const oppsByAccount = await sf<Opp>(
    `SELECT Id, Name, Amount, StageName, CloseDate, IsClosed, IsWon,
            AccountId, Account.Id, Account.Name, Account.Industry, Account.AnnualRevenue
     FROM Opportunity
     WHERE Account.Name LIKE '%Century%'
     ORDER BY Amount DESC NULLS LAST
     LIMIT 50`
  );
  // Opportunities where the OPP name itself contains "Century"
  const oppsByName = await sf<Opp>(
    `SELECT Id, Name, Amount, StageName, CloseDate, IsClosed, IsWon,
            AccountId, Account.Id, Account.Name, Account.Industry, Account.AnnualRevenue
     FROM Opportunity
     WHERE Name LIKE '%Century%'
     ORDER BY Amount DESC NULLS LAST
     LIMIT 50`
  );
  // Opportunities at ~$284K (the user's stated ARR), narrowed by name
  const oppsByAmount = await sf<Opp>(
    `SELECT Id, Name, Amount, StageName, CloseDate, IsClosed, IsWon,
            AccountId, Account.Id, Account.Name, Account.Industry, Account.AnnualRevenue
     FROM Opportunity
     WHERE Amount >= 250000 AND Amount <= 320000
     ORDER BY Amount DESC NULLS LAST
     LIMIT 30`
  );

  const seen = new Map<string, Opp>();
  for (const o of [...oppsByAccount, ...oppsByName, ...oppsByAmount]) {
    if (!seen.has(o.Id)) seen.set(o.Id, o);
  }
  const all = Array.from(seen.values());

  function row(o: Opp) {
    const amt = o.Amount != null ? `$${(o.Amount / 1000).toFixed(0)}K` : "—";
    const won = o.IsWon ? "✓ won" : o.IsClosed ? "✗ lost" : "open";
    console.log(
      [
        o.Id.slice(0, 19).padEnd(19),
        (o.Account?.Name ?? "—").slice(0, 32).padEnd(32),
        (o.Name ?? "").slice(0, 38).padEnd(38),
        amt.padEnd(8),
        (o.StageName ?? "—").slice(0, 18).padEnd(18),
        (o.CloseDate ?? "—").padEnd(10),
        won,
      ].join(" │ ")
    );
  }

  // Print by-account first
  console.log("─── Opps where Account.Name has 'Century' ───");
  console.log("");
  console.log(
    ["Opp Id".padEnd(19), "Account".padEnd(32), "Opp name".padEnd(38), "Amount".padEnd(8), "Stage".padEnd(18), "Close".padEnd(10), "State"].join(" │ ")
  );
  console.log("─".repeat(140));
  for (const o of oppsByAccount) row(o);
  console.log("");

  console.log("─── Opps where Opp.Name itself has 'Century' (different accounts!) ───");
  console.log("");
  for (const o of oppsByName) {
    // Don't repeat ones we already showed from the account search
    if (oppsByAccount.find((x) => x.Id === o.Id)) continue;
    row(o);
  }
  console.log("");

  // Narrow to closed-won + open with amount ≈ $284K
  const targetAmount = 284_000;
  const candidates = all.filter(
    (o) => o.Amount != null && Math.abs(o.Amount - targetAmount) < 50_000
  );
  if (candidates.length > 0) {
    console.log(`─── Best fit: opps with Amount ≈ $${(targetAmount / 1000).toFixed(0)}K ───`);
    console.log("");
    for (const o of candidates) row(o);
    console.log("");
    console.log("");
    console.log("Unique accounts on those candidates:");
    const accts = new Map<string, Opp["Account"]>();
    for (const o of candidates) if (o.Account) accts.set(o.Account.Id, o.Account);
    for (const [id, a] of accts) {
      console.log(`  ${id}  ${a?.Name}  (${a?.Industry ?? "—"})  AnnualRevenue: $${((a?.AnnualRevenue ?? 0) / 1_000_000).toFixed(1)}M`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
