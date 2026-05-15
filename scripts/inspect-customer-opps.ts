// Inspect Salesforce opportunities for one customer in detail.
// Read-only. Helps us figure out the right ARR derivation logic.
//
// Run: npx tsx scripts/inspect-customer-opps.ts JBI
//      npx tsx scripts/inspect-customer-opps.ts                    (all customers)

import "dotenv/config";
import "@/lib/supabase/ws-polyfill"; // Node < 22 needs WebSocket polyfill for supabase-js >= 2.105.
import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

import { createClient } from "@supabase/supabase-js";

let _sfToken: { token: string; instanceUrl: string; expiresAt: number } | null = null;

async function sfToken() {
  if (_sfToken && _sfToken.expiresAt > Date.now() + 5 * 60_000) return _sfToken;
  const instance = (process.env.SALESFORCE_INSTANCE_URL ?? "").trim().replace(/\/+$/, "");
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: (process.env.SALESFORCE_CLIENT_ID ?? "").trim(),
    client_secret: (process.env.SALESFORCE_CLIENT_SECRET ?? "").trim(),
  });
  const res = await fetch(`${instance}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = (await res.json()) as Record<string, string>;
  if (!res.ok) throw new Error(`SF auth ${res.status}: ${body.error}`);
  _sfToken = { token: body.access_token, instanceUrl: body.instance_url, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
  return _sfToken;
}

async function soql<T>(query: string): Promise<T[]> {
  const { token, instanceUrl } = await sfToken();
  const url = `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`SOQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { records: T[] };
  return body.records;
}

interface OppDetail {
  Id: string;
  Name: string;
  StageName: string;
  Amount: number | null;
  CloseDate: string;
  CreatedDate: string;
  IsClosed: boolean;
  IsWon: boolean;
  Type: string | null; // New Business / Renewal / Upsell etc.
  ContractStartDate__c?: string | null;
  ContractEndDate__c?: string | null;
  Term_in_Months__c?: number | null;
  ARR__c?: number | null;
  TCV__c?: number | null;
  ACV__c?: number | null;
  Probability: number | null;
  ForecastCategoryName: string | null;
  AccountId: string;
}

async function listAvailableOppFields(): Promise<string[]> {
  const { token, instanceUrl } = await sfToken();
  const url = `${instanceUrl}/services/data/v60.0/sobjects/Opportunity/describe`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`describe failed ${res.status}`);
  const body = (await res.json()) as { fields: Array<{ name: string; type: string; label: string }> };
  return body.fields.map((f) => `${f.name}:${f.type}`);
}

async function main() {
  const filter = process.argv[2] ?? null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("customers")
    .select("display_name, salesforce_account_id")
    .is("deleted_at", null)
    .not("salesforce_account_id", "is", null);
  if (error) throw error;
  let custs = (data as Array<{ display_name: string; salesforce_account_id: string }>) ?? [];
  if (filter) {
    const f = filter.toLowerCase();
    custs = custs.filter((c) => c.display_name.toLowerCase().includes(f));
  }

  if (!filter) {
    console.log("Usage: npx tsx scripts/inspect-customer-opps.ts <name fragment>\n");
    console.log("Available customers (with SF mapping):");
    for (const c of custs) console.log(`  - ${c.display_name}`);
    return;
  }

  if (custs.length === 0) {
    console.log(`No customer matched "${filter}".`);
    return;
  }

  // Discover available custom fields once so we don't 400-error on optional ones.
  const allFields = await listAvailableOppFields();
  const candidates = ["ContractStartDate__c", "ContractEndDate__c", "Term_in_Months__c", "ARR__c", "TCV__c", "ACV__c"];
  const present = candidates.filter((c) => allFields.some((f) => f.startsWith(c + ":")));
  const customFieldsPart = present.length ? ", " + present.join(", ") : "";

  console.log(`Custom Opp fields available: ${present.join(", ") || "(none)"}\n`);

  for (const c of custs) {
    console.log("─".repeat(90));
    console.log(`${c.display_name}  ↔  SF account ${c.salesforce_account_id}`);
    console.log("─".repeat(90));
    const opps = await soql<OppDetail>(
      `SELECT Id, Name, StageName, Amount, CloseDate, CreatedDate, IsClosed, IsWon, Type, Probability, ForecastCategoryName, AccountId${customFieldsPart}
       FROM Opportunity
       WHERE AccountId = '${c.salesforce_account_id}'
       ORDER BY CloseDate DESC`
    );
    if (opps.length === 0) {
      console.log("  (no opportunities)");
      continue;
    }
    console.log(`  ${opps.length} opportunit${opps.length === 1 ? "y" : "ies"}:`);
    for (const o of opps) {
      const flags = [
        o.IsClosed ? "Closed" : "Open",
        o.IsWon ? "Won" : "",
        `${o.Probability ?? 0}%`,
        o.ForecastCategoryName ?? "—",
      ]
        .filter(Boolean)
        .join(" · ");
      console.log(`  • [${o.CloseDate}] ${o.Name}`);
      console.log(`        Stage: ${o.StageName}  ·  Type: ${o.Type ?? "—"}  ·  ${flags}`);
      console.log(
        `        Amount: ${o.Amount != null ? "$" + o.Amount.toLocaleString() : "—"}` +
          (o.ARR__c != null ? `  ARR: $${o.ARR__c.toLocaleString()}` : "") +
          (o.ACV__c != null ? `  ACV: $${o.ACV__c.toLocaleString()}` : "") +
          (o.TCV__c != null ? `  TCV: $${o.TCV__c.toLocaleString()}` : "") +
          (o.Term_in_Months__c != null ? `  Term: ${o.Term_in_Months__c}mo` : "")
      );
      if (o.ContractStartDate__c || o.ContractEndDate__c) {
        console.log(
          `        Contract: ${o.ContractStartDate__c ?? "—"}  →  ${o.ContractEndDate__c ?? "—"}`
        );
      }
    }
    // What naive sum gives us:
    const sumAll = opps.reduce((s, o) => s + (o.Amount ?? 0), 0);
    const sumOpen = opps.filter((o) => !o.IsClosed).reduce((s, o) => s + (o.Amount ?? 0), 0);
    const sumWon = opps.filter((o) => o.IsWon).reduce((s, o) => s + (o.Amount ?? 0), 0);
    console.log(`\n  Naive sums:`);
    console.log(`    sum(Amount) all                : $${sumAll.toLocaleString()}`);
    console.log(`    sum(Amount) open only          : $${sumOpen.toLocaleString()}`);
    console.log(`    sum(Amount) won only           : $${sumWon.toLocaleString()}`);
    console.log(`    sum(Amount) open + won (script): $${(sumOpen + sumWon).toLocaleString()}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
