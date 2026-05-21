// One-shot search: find any SF account that might be "Century Supply
// Chains". Tries several name patterns and combines results.

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

async function sfQuery<T>(soql: string): Promise<T[]> {
  const { token, instance } = await sfToken();
  const res = await fetch(`${instance}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SF: ${res.status} ${await res.text()}`);
  return (await res.json() as { records: T[] }).records;
}

async function sosl(searchTerm: string): Promise<SfAccount[]> {
  // SOSL is broader than LIKE — searches across all fields.
  const { token, instance } = await sfToken();
  const sosl = `FIND {${searchTerm}} IN NAME FIELDS RETURNING Account(Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website LIMIT 30)`;
  const res = await fetch(
    `${instance}/services/data/v60.0/search/?q=${encodeURIComponent(sosl)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`SOSL: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { searchRecords: SfAccount[] };
  return body.searchRecords ?? [];
}

function printRow(a: SfAccount, currentSfId: string | undefined) {
  const isCurrent = a.Id === currentSfId ? "*" : " ";
  const rev =
    a.AnnualRevenue != null
      ? a.AnnualRevenue >= 1_000_000
        ? `$${(a.AnnualRevenue / 1_000_000).toFixed(1)}M`
        : `$${(a.AnnualRevenue / 1_000).toFixed(0)}K`
      : "—";
  const loc = [a.BillingCity, a.BillingCountry].filter(Boolean).join(", ") || "—";
  console.log(
    [
      `${isCurrent}`,
      a.Id.padEnd(20),
      (a.Name ?? "").slice(0, 45).padEnd(45),
      rev.padEnd(12),
      (a.Industry ?? "—").slice(0, 18).padEnd(18),
      loc.slice(0, 30),
    ].join(" │ ")
  );
}

async function main() {
  console.log("Searching Salesforce for 'Century Supply Chain' variants…");
  console.log("");

  // Try several search strategies, dedupe by SF Id.
  const seen = new Map<string, SfAccount>();

  const queries = [
    `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website
     FROM Account WHERE Name LIKE '%Supply Chain%' LIMIT 30`,
    `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website
     FROM Account WHERE Name LIKE '%Century%Supply%' OR Name LIKE '%Supply%Century%' LIMIT 30`,
    `SELECT Id, Name, AnnualRevenue, Industry, BillingCity, BillingCountry, Website
     FROM Account WHERE Name LIKE '%Century%' LIMIT 30`,
  ];
  for (const q of queries) {
    for (const a of await sfQuery<SfAccount>(q)) {
      if (!seen.has(a.Id)) seen.set(a.Id, a);
    }
  }

  // Belt-and-braces SOSL search
  try {
    for (const a of await sosl(`Century Supply`)) {
      if (!seen.has(a.Id)) seen.set(a.Id, a);
    }
  } catch (err) {
    console.warn(`SOSL search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const all = Array.from(seen.values()).sort((a, b) => {
    return (b.AnnualRevenue ?? 0) - (a.AnnualRevenue ?? 0);
  });

  console.log("Matches found (all sources, deduped):");
  console.log("");
  for (const a of all) {
    printRow(a, undefined);
  }
  console.log("");
  console.log(`Total: ${all.length}`);

  // Narrow filter: anything with "supply" or "chain" in the name
  const supplyHits = all.filter((a) => /supply|chain/i.test(a.Name ?? ""));
  if (supplyHits.length > 0) {
    console.log("");
    console.log("Refined to names containing 'supply' or 'chain':");
    console.log("");
    for (const a of supplyHits) {
      printRow(a, undefined);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
