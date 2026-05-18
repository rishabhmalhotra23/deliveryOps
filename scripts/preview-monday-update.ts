// Discovery script: PREVIEW the Salesforce → Monday "Customers" board update.
// READS ONLY. Writes nothing. Uses the curated customer ↔ SF account map
// from Supabase. Pulls Salesforce data LIVE.
//
// ARR derivation (corrected): take the Amount of the most-recently-dated
// opportunity that is either Closed Won OR Open with Probability ≥ 50%.
// We do NOT sum across years — each annual contract event replaces the
// prior year's contract; opps don't accumulate.
//
// Default policies for this run (override by editing the SKIP_* sets):
//   - SKIP_CUSTOMERS           : SF mapping wrong; don't write
//   - SKIP_CHURNED_CATEGORY    : churned customers — don't write (user decision)
//   - SKIP_ARR_FOR             : ARR specifically unreliable for these customers
//   - SKIP_COMPANY_REVENUE_FOR : Monday already has a better value than SF
//   - SKIP_INDUSTRY = true     : SF strings don't match the Monday dropdown
//
// Run with:  npx tsx scripts/preview-monday-update.ts

import "dotenv/config";
import "@/lib/supabase/ws-polyfill";

import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

import { createClient } from "@supabase/supabase-js";

const MONDAY_ENDPOINT = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-04";
const BOARD_ID = "18395281568";

// ─── Policy defaults (decisions confirmed with user) ───────────────────

// Customers whose SF mapping is wrong — don't write anything for them.
const SKIP_CUSTOMERS = new Set<string>([
  "TSM Law", // mapped to TSMC (semiconductor) — wrong
  "American Towers", // mapped to "american income life" — wrong
  "Bradley & Beams", // mapped to Bradley Motivation (broadcast media) — wrong
  "TPI", // mapped to Tpi (120 employees) — wrong
  "PPC", // mapped to Ppc Lubricants — needs user confirmation
]);

// Skip the whole Churned bucket — current Monday values reflect historical
// signals; backfilling from old SF deals is misleading. User decision.
const SKIP_CHURNED_CATEGORY = true;

// Customers where SF's ARR derivation is unreliable for one-off reasons.
// Their non-ARR fields (renewal date, employees, company revenue) can still write.
const SKIP_ARR_FOR = new Set<string>([
  "Wipro FSS", // Bloomberg opp cross-contamination on Wipro account
  "Ciena", // 40% drop on renewal — needs verification
  "Scan Health", // 4× drop on renewal — needs verification
]);

// Customers whose Monday "Company Revenue" is more accurate than SF's
// banded AnnualRevenue value — skip Company Revenue writes for them.
const SKIP_COMPANY_REVENUE_FOR = new Set<string>([
  "Dish - Ecostar",
  "Builders Firstsource",
  "Pepsi",
  "Wipro FSS",
  "Mitie",
  "Wesfarmers",
  "Siemens",
  "Ciena",
  "TTX",
  "Paysafe",
]);

// SF Industry strings don't match Monday's curated dropdown options.
const SKIP_INDUSTRY = true;

// ─────────────────────────────────────────────────────────────────────────
// Monday client
// ─────────────────────────────────────────────────────────────────────────

type MondayColumn = { id: string; title: string; type: string; settings_str: string | null };
type MondayItem = {
  id: string;
  name: string;
  group: { id: string; title: string } | null;
  column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>;
};

async function mondayGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN?.trim();
  if (!token) throw new Error("Missing MONDAY_API_TOKEN");
  const res = await fetch(MONDAY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new Error("Monday returned no data");
  return body.data;
}

interface BoardSnapshot {
  columns: MondayColumn[];
  items: MondayItem[];
}

async function loadBoard(): Promise<BoardSnapshot> {
  type Resp = {
    boards: Array<{
      columns: MondayColumn[];
      items_page: { items: MondayItem[] };
    }>;
  };
  const data = await mondayGql<Resp>(
    `query ($ids: [ID!], $limit: Int!) {
      boards(ids: $ids) {
        columns { id title type settings_str }
        items_page(limit: $limit) {
          items {
            id name
            group { id title }
            column_values { id type text value }
          }
        }
      }
    }`,
    { ids: [BOARD_ID], limit: 200 }
  );
  const b = data.boards[0];
  if (!b) throw new Error(`Board ${BOARD_ID} not accessible`);
  return { columns: b.columns, items: b.items_page.items };
}

// ─────────────────────────────────────────────────────────────────────────
// Salesforce client
// ─────────────────────────────────────────────────────────────────────────

interface SfAccount {
  Id: string;
  Name: string;
  Industry: string | null;
  AnnualRevenue: number | null;
  NumberOfEmployees: number | null;
}

interface SfOpportunity {
  Id: string;
  Name: string;
  StageName: string;
  Amount: number | null;
  CloseDate: string;
  IsClosed: boolean;
  IsWon: boolean;
  Probability: number | null;
  AccountId: string;
}

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
  if (!res.ok) throw new Error(`Salesforce auth ${res.status}: ${body.error}`);
  _sfToken = {
    token: body.access_token,
    instanceUrl: body.instance_url,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
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

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchAccounts(ids: string[]): Promise<Map<string, SfAccount>> {
  const out = new Map<string, SfAccount>();
  for (const c of chunk(ids, 100)) {
    const idList = c.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(",");
    const rows = await soql<SfAccount>(
      `SELECT Id, Name, Industry, AnnualRevenue, NumberOfEmployees
       FROM Account
       WHERE Id IN (${idList})`
    );
    for (const r of rows) out.set(r.Id, r);
  }
  return out;
}

async function fetchOpportunities(accountIds: string[]): Promise<Map<string, SfOpportunity[]>> {
  const out = new Map<string, SfOpportunity[]>();
  for (const c of chunk(accountIds, 100)) {
    const idList = c.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(",");
    const rows = await soql<SfOpportunity>(
      `SELECT Id, Name, StageName, Amount, CloseDate, IsClosed, IsWon, Probability, AccountId
       FROM Opportunity
       WHERE AccountId IN (${idList})
       ORDER BY CloseDate DESC`
    );
    for (const r of rows) {
      const list = out.get(r.AccountId) ?? [];
      list.push(r);
      out.set(r.AccountId, list);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// ARR derivation (corrected)
// ─────────────────────────────────────────────────────────────────────────

interface ArrDerivation {
  value: number | null;
  source_opp: SfOpportunity | null;
  rationale: string;
}

function deriveArr(opps: SfOpportunity[]): ArrDerivation {
  if (opps.length === 0) {
    return { value: null, source_opp: null, rationale: "no opportunities in SF" };
  }

  // Eligible: Closed Won, OR currently Open with prob ≥ 50% (likely-renewing).
  const eligible = opps.filter(
    (o) => o.IsWon || (!o.IsClosed && (o.Probability ?? 0) >= 50)
  );

  if (eligible.length === 0) {
    return {
      value: null,
      source_opp: null,
      rationale: `no won or late-stage open opps (${opps.length} opps total; all early-stage/lost)`,
    };
  }

  // Latest by CloseDate. Each opportunity = an annual contract event,
  // and the most recent one represents the current active commitment.
  const latest = [...eligible].sort((a, b) => (a.CloseDate < b.CloseDate ? 1 : -1))[0];
  const status = latest.IsWon ? "Closed Won" : "Open " + latest.StageName;
  return {
    value: latest.Amount,
    source_opp: latest,
    rationale: `latest signed/expected contract: ${latest.CloseDate} ${status} ${latest.Name}`,
  };
}

function deriveRenewalDate(opps: SfOpportunity[]): { value: string | null; source_opp: SfOpportunity | null } {
  const today = new Date().toISOString().slice(0, 10);
  const future = opps
    .filter((o) => !o.IsClosed && (o.Probability ?? 0) >= 50 && o.CloseDate >= today)
    .sort((a, b) => (a.CloseDate < b.CloseDate ? -1 : 1));
  if (future.length > 0) return { value: future[0].CloseDate, source_opp: future[0] };
  return { value: null, source_opp: null };
}

// ─────────────────────────────────────────────────────────────────────────
// Supabase reader
// ─────────────────────────────────────────────────────────────────────────

interface CustomerRow {
  id: string;
  key: string;
  display_name: string;
  monday_item_id: string | null;
  salesforce_account_id: string | null;
  custom_category: string | null;
  deliveryops_protected_fields: string[] | null;
}

async function loadCustomers(): Promise<CustomerRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("customers")
    .select(
      "id, key, display_name, monday_item_id, salesforce_account_id, custom_category, deliveryops_protected_fields"
    )
    .is("deleted_at", null);
  if (error) throw error;
  return (data as CustomerRow[]) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────

function fmtMoneyShort(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, Math.max(0, n - 1)) + "…";
  return s + " ".repeat(n - s.length);
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading Monday + Supabase + Salesforce…\n");

  const [board, customers] = await Promise.all([loadBoard(), loadCustomers()]);

  const findCol = (predicate: (c: MondayColumn) => boolean) =>
    board.columns.find(predicate) ?? null;
  const colArr = findCol((c) => c.title.toLowerCase().includes("arr") && c.type === "numbers");
  const colCompanyRev = findCol((c) => c.title.toLowerCase() === "company revenue");
  const colRenewal = findCol((c) => c.type === "date" && /renew/i.test(c.title));
  const colEmployees = findCol((c) => c.title.toLowerCase() === "employees");
  const colIndustry = findCol((c) => c.title.toLowerCase() === "industry");

  const sfIds = customers
    .map((c) => c.salesforce_account_id)
    .filter((v): v is string => !!v);
  const [accounts, opps] = await Promise.all([fetchAccounts(sfIds), fetchOpportunities(sfIds)]);
  console.log(`Loaded ${customers.length} customers · ${accounts.size} SF accounts · ${[...opps.values()].flat().length} opps.\n`);

  type FieldOutcome = "WRITE" | "SAME" | "SKIP_NO_VALUE" | "SKIP_POLICY" | "NOT_MAPPED";
  interface Field {
    name: string;
    column_id: string | null;
    column_type: string | null;
    current: string | null;
    proposed: string | null;
    write_value: string | { date: string } | { labels: string[] } | null;
    outcome: FieldOutcome;
    note?: string;
  }
  interface Row {
    customer_key: string;
    customer_name: string;
    monday_item_id: string | null;
    monday_item_on_board: boolean;
    sf_account_id: string | null;
    sf_account_name: string | null;
    skipped_customer_reason: string | null;
    custom_category: string | null;
    arr_rationale: string | null;
    renewal_source_opp: string | null;
    fields: Field[];
  }

  const itemById = new Map(board.items.map((i) => [i.id, i]));
  const rows: Row[] = [];

  for (const cust of customers) {
    const row: Row = {
      customer_key: cust.key,
      customer_name: cust.display_name,
      monday_item_id: cust.monday_item_id,
      monday_item_on_board: cust.monday_item_id != null && itemById.has(cust.monday_item_id),
      sf_account_id: cust.salesforce_account_id,
      sf_account_name: null,
      skipped_customer_reason: null,
      custom_category: cust.custom_category,
      arr_rationale: null,
      renewal_source_opp: null,
      fields: [],
    };

    if (!row.monday_item_on_board || !cust.monday_item_id) {
      row.skipped_customer_reason = "not on Monday board";
      rows.push(row);
      continue;
    }
    if (!cust.salesforce_account_id) {
      row.skipped_customer_reason = "no SF account mapped";
      rows.push(row);
      continue;
    }
    if (SKIP_CUSTOMERS.has(cust.display_name)) {
      row.skipped_customer_reason = "SF mapping flagged as wrong";
      rows.push(row);
      continue;
    }
    if (SKIP_CHURNED_CATEGORY && (cust.custom_category ?? "").toLowerCase() === "churned") {
      row.skipped_customer_reason = "churned — skipping whole customer (user decision)";
      rows.push(row);
      continue;
    }

    const item = itemById.get(cust.monday_item_id)!;
    const valueByCol = new Map(item.column_values.map((cv) => [cv.id, cv]));

    const acc = accounts.get(cust.salesforce_account_id);
    row.sf_account_name = acc?.Name ?? null;

    const accOpps = opps.get(cust.salesforce_account_id) ?? [];
    const arr = deriveArr(accOpps);
    const renewal = deriveRenewalDate(accOpps);
    row.arr_rationale = arr.rationale;
    row.renewal_source_opp = renewal.source_opp?.Name ?? null;

    function pushField(opts: {
      name: string;
      col: MondayColumn | null;
      currentText: string | null;
      proposedDisplay: string | null;
      writeValue: Field["write_value"];
      policySkipReason?: string;
    }) {
      let outcome: FieldOutcome;
      if (!opts.col) outcome = "NOT_MAPPED";
      else if (opts.policySkipReason) outcome = "SKIP_POLICY";
      else if (opts.proposedDisplay == null || opts.writeValue == null) outcome = "SKIP_NO_VALUE";
      else if ((opts.currentText ?? "").trim() === (opts.proposedDisplay ?? "").trim())
        outcome = "SAME";
      else outcome = "WRITE";
      row.fields.push({
        name: opts.name,
        column_id: opts.col?.id ?? null,
        column_type: opts.col?.type ?? null,
        current: opts.currentText,
        proposed: opts.proposedDisplay,
        write_value: outcome === "WRITE" ? opts.writeValue : null,
        outcome,
        note: opts.policySkipReason,
      });
    }

    // ARR
    const arrCv = colArr ? valueByCol.get(colArr.id) : undefined;
    pushField({
      name: "ARR",
      col: colArr,
      currentText: arrCv?.text ?? null,
      proposedDisplay: arr.value != null ? Math.round(arr.value).toString() : null,
      writeValue: arr.value != null ? Math.round(arr.value).toString() : null,
      policySkipReason: SKIP_ARR_FOR.has(cust.display_name)
        ? "ARR derivation unreliable for this customer (user decision)"
        : undefined,
    });

    // Company Revenue
    const crCv = colCompanyRev ? valueByCol.get(colCompanyRev.id) : undefined;
    const crDisplay = acc?.AnnualRevenue != null ? fmtMoneyShort(acc.AnnualRevenue) : null;
    pushField({
      name: "Company Revenue",
      col: colCompanyRev,
      currentText: crCv?.text ?? null,
      proposedDisplay: crDisplay,
      writeValue: crDisplay,
      policySkipReason: SKIP_COMPANY_REVENUE_FOR.has(cust.display_name)
        ? "Monday value is more accurate than SF banded value"
        : undefined,
    });

    // Renewal Date
    const rdCv = colRenewal ? valueByCol.get(colRenewal.id) : undefined;
    pushField({
      name: "Renewal Date",
      col: colRenewal,
      currentText: rdCv?.text ?? null,
      proposedDisplay: renewal.value,
      writeValue: renewal.value ? { date: renewal.value } : null,
    });

    // Employees
    const empCv = colEmployees ? valueByCol.get(colEmployees.id) : undefined;
    pushField({
      name: "Employees",
      col: colEmployees,
      currentText: empCv?.text ?? null,
      proposedDisplay: acc?.NumberOfEmployees != null ? acc.NumberOfEmployees.toLocaleString() : null,
      writeValue: acc?.NumberOfEmployees != null ? acc.NumberOfEmployees.toString() : null,
    });

    // Industry (skipped per policy)
    const indCv = colIndustry ? valueByCol.get(colIndustry.id) : undefined;
    pushField({
      name: "Industry",
      col: colIndustry,
      currentText: indCv?.text ?? null,
      proposedDisplay: acc?.Industry ?? null,
      writeValue: null,
      policySkipReason: SKIP_INDUSTRY ? "SF strings don't match Monday dropdown options" : undefined,
    });

    rows.push(row);
  }

  // ─── per-customer rendering (grouped by category) ─────────────────────
  console.log("─".repeat(100));
  console.log("FINAL PROPOSED CHANGES (with corrected ARR logic + policy skips)");
  console.log("─".repeat(100));

  const order = [
    "At Risk",
    "Upcoming Renewals",
    "Strategic Growth",
    "Active",
    "Partner Managed",
    "POV",
    "Churned",
  ];
  const grouped = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.custom_category ?? "(uncategorised)";
    const list = grouped.get(k) ?? [];
    list.push(r);
    grouped.set(k, list);
  }

  function glyph(o: FieldOutcome): string {
    return o === "WRITE" ? "*" : o === "SAME" ? "=" : "-";
  }

  for (const cat of [...order, ...[...grouped.keys()].filter((k) => !order.includes(k))]) {
    const list = grouped.get(cat);
    if (!list?.length) continue;
    console.log(`\n┃ ${cat.toUpperCase()}  (${list.length})`);
    for (const r of list) {
      if (r.skipped_customer_reason) {
        console.log(`  ✗ ${r.customer_name}  — SKIPPED: ${r.skipped_customer_reason}`);
        continue;
      }
      const writes = r.fields.filter((f) => f.outcome === "WRITE");
      if (writes.length === 0) {
        console.log(`  · ${r.customer_name}  [SF: ${r.sf_account_name}]  no changes`);
        if (r.arr_rationale) console.log(`      ARR derivation: ${r.arr_rationale}`);
        continue;
      }
      console.log(`  ✎ ${r.customer_name}  [SF: ${r.sf_account_name}]`);
      if (r.arr_rationale) console.log(`      ARR derivation: ${r.arr_rationale}`);
      for (const f of r.fields) {
        const g = glyph(f.outcome);
        const cur = f.current && f.current.length > 0 ? f.current : "—";
        const prop = f.proposed && f.proposed.length > 0 ? f.proposed : "—";
        const note = f.note ? ` (${f.note})` : "";
        console.log(`      ${g} ${pad(f.name, 16)} ${pad(`"${cur}"`, 28)} → "${prop}"${note}`);
      }
    }
  }

  // ─── summary ─────────────────────────────────────────────────────────
  const totalWrites = rows.flatMap((r) => r.fields).filter((f) => f.outcome === "WRITE").length;
  const totalSames = rows.flatMap((r) => r.fields).filter((f) => f.outcome === "SAME").length;
  const totalSkipPolicy = rows.flatMap((r) => r.fields).filter((f) => f.outcome === "SKIP_POLICY").length;
  const totalSkipNoVal = rows.flatMap((r) => r.fields).filter((f) => f.outcome === "SKIP_NO_VALUE").length;
  const customersWithChanges = rows.filter((r) =>
    r.fields.some((f) => f.outcome === "WRITE")
  ).length;
  const customersSkipped = rows.filter((r) => r.skipped_customer_reason).length;

  console.log("\n" + "─".repeat(100));
  console.log("SUMMARY");
  console.log("─".repeat(100));
  console.log(`Customers in DeliveryOps        : ${rows.length}`);
  console.log(`  with at least one WRITE       : ${customersWithChanges}`);
  console.log(`  skipped entirely              : ${customersSkipped}`);
  console.log("");
  console.log(`Field-level outcomes:`);
  console.log(`  WRITE                         : ${totalWrites}`);
  console.log(`  SAME                          : ${totalSames}`);
  console.log(`  SKIP no SF value              : ${totalSkipNoVal}`);
  console.log(`  SKIP by policy                : ${totalSkipPolicy}`);

  // Write plan for the writer phase.
  const writePlan = rows
    .filter((r) => !r.skipped_customer_reason && r.fields.some((f) => f.outcome === "WRITE"))
    .map((r) => ({
      customer_key: r.customer_key,
      customer_name: r.customer_name,
      monday_item_id: r.monday_item_id,
      sf_account_id: r.sf_account_id,
      sf_account_name: r.sf_account_name,
      arr_rationale: r.arr_rationale,
      column_values: Object.fromEntries(
        r.fields
          .filter((f) => f.outcome === "WRITE")
          .map((f) => [
            f.column_id!,
            { type: f.column_type, value: f.write_value, display: f.proposed },
          ])
      ),
    }));

  fs.writeFileSync(
    path.resolve(process.cwd(), "scripts/.monday-write-plan.json"),
    JSON.stringify(writePlan, null, 2)
  );
  console.log(
    `\nWrote ${writePlan.length} customer write-plans to scripts/.monday-write-plan.json`
  );
  console.log("(Reads only. Nothing was sent to Monday.)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
