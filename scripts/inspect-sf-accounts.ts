// Inspect Salesforce accounts that plausibly match our 41 Monday customers.
// Read-only. Helps us confirm naming conventions before writing a matcher.
//
// Run: npx tsx scripts/inspect-sf-accounts.ts

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const MONDAY_ENDPOINT = "https://api.monday.com/v2";
const BOARD_ID = "18395281568";

async function mondayGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN!;
  const res = await fetch(MONDAY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2024-04",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data!;
}

async function getMondayItems(): Promise<Array<{ id: string; name: string }>> {
  const data = await mondayGql<{
    boards: Array<{ items_page: { items: Array<{ id: string; name: string }> } }>;
  }>(
    `query ($ids: [ID!]) { boards(ids: $ids) { items_page(limit:200) { items { id name } } } }`,
    { ids: [BOARD_ID] }
  );
  return data.boards[0].items_page.items;
}

async function sfToken() {
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
  const body = (await res.json()) as Record<string, string>;
  return { token: body.access_token, instanceUrl: body.instance_url };
}

interface SfAccount {
  Id: string;
  Name: string;
  AnnualRevenue: number | null;
  NumberOfEmployees: number | null;
  Industry: string | null;
  Type: string | null;
}

async function soql<T>(query: string): Promise<T[]> {
  const { token, instanceUrl } = await sfToken();
  const url = `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`SOQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { records: T[] };
  return body.records;
}

async function main() {
  const items = await getMondayItems();

  // Collect distinct naming-stem candidates from each Monday item.
  // For "Dish - Ecostar" we try ["Dish - Ecostar", "Dish", "Ecostar"];
  // for "Bradley & Beams" we try ["Bradley", "Beams"]; etc.
  function candidates(name: string): string[] {
    const out = new Set<string>();
    out.add(name);
    const cleaned = name.replace(/[&,]/g, " ").split(/[\s\-/]+/).map((p) => p.trim()).filter(Boolean);
    for (const p of cleaned) {
      if (p.length >= 3) out.add(p);
    }
    return Array.from(out);
  }

  console.log(`Inspecting ${items.length} Monday items against Salesforce…\n`);

  for (const it of items) {
    const cands = candidates(it.name);
    const found: SfAccount[] = [];
    for (const cand of cands) {
      const safe = cand.replace(/'/g, "\\'");
      const rows = await soql<SfAccount>(
        `SELECT Id, Name, AnnualRevenue, NumberOfEmployees, Industry, Type
         FROM Account
         WHERE Name LIKE '%${safe}%' AND Name != '.'
         LIMIT 5`
      );
      for (const r of rows) {
        if (!found.find((f) => f.Id === r.Id)) found.push(r);
      }
    }
    if (found.length === 0) {
      console.log(`  ✗ ${it.name}  →  NO match in Salesforce`);
    } else if (found.length === 1) {
      const f = found[0];
      console.log(
        `  ✓ ${it.name}  →  "${f.Name}"  (id ${f.Id}, ARR=${f.AnnualRevenue ?? "—"}, emp=${f.NumberOfEmployees ?? "—"}, ind=${f.Industry ?? "—"})`
      );
    } else {
      console.log(`  ? ${it.name}  →  ${found.length} candidates:`);
      for (const f of found) {
        console.log(
          `        "${f.Name}"  (id ${f.Id}, ARR=${f.AnnualRevenue ?? "—"}, ind=${f.Industry ?? "—"})`
        );
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
