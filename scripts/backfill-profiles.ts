// Backfill profiles + internal_profiles for all 41 customers from the
// freshly-synced Salesforce + Monday + customers data. Idempotent: re-runs
// only refresh derived fields, never overwrite human-edited ones (tracked
// via last_updated_by != "backfill-*").
//
// Derivations:
//   profile.industry          ← sf_accounts.industry
//   profile.employee_count    ← sf_accounts.number_of_employees
//   profile.website           ← sf_accounts.website
//   profile.headquarters      ← sf_accounts.billing_city + billing_country
//   profile.tier              ← inferred from custom_category
//   profile.deployment_stage  ← inferred from custom_category
//   profile.renewal_date      ← latest open SF opp w/ prob >= 50% CloseDate
//   profile.arr               ← Amount of latest signed/expected SF opp
//                               (the corrected derivation from preview script)
//   profile.contacts          ← SF Contact records for the account
//
//   internal_profile.health_score   ← inferred from custom_category
//   internal_profile.nps_score      ← from cached monday_nps_responses if any
//   internal_profile.churn_risk     ← inferred from custom_category
//   internal_profile.next_qbr_date  ← today + 90 days (default; agent updates later)
//
// Run: npx tsx scripts/backfill-profiles.ts

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

const BACKFILL_TAG = "backfill-2026-05-11";

// ─── SF client (just for Contacts; everything else is already cached) ──
let _sf: { token: string; instanceUrl: string; expiresAt: number } | null = null;
async function sfTok() {
  if (_sf && _sf.expiresAt > Date.now() + 5 * 60_000) return _sf;
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
  _sf = {
    token: body.access_token,
    instanceUrl: body.instance_url,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  return _sf;
}

interface SfContactRow {
  Id: string;
  FirstName: string | null;
  LastName: string | null;
  Title: string | null;
  Email: string | null;
  Phone: string | null;
  AccountId: string;
}

async function fetchContacts(accountIds: string[]): Promise<Map<string, SfContactRow[]>> {
  const out = new Map<string, SfContactRow[]>();
  if (accountIds.length === 0) return out;
  const { token, instanceUrl } = await sfTok();
  // Chunk to keep SOQL under length limits.
  for (let i = 0; i < accountIds.length; i += 50) {
    const slice = accountIds.slice(i, i + 50);
    const list = slice.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(",");
    const q = `SELECT Id, FirstName, LastName, Title, Email, Phone, AccountId
               FROM Contact
               WHERE AccountId IN (${list})
               ORDER BY LastName ASC NULLS LAST LIMIT 500`;
    const url = `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`SF Contacts ${res.status}`);
    const body = (await res.json()) as { records: SfContactRow[] };
    for (const r of body.records) {
      const arr = out.get(r.AccountId) ?? [];
      arr.push(r);
      out.set(r.AccountId, arr);
    }
  }
  return out;
}

// ─── Supabase ─────────────────────────────────────────────────────────
function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface CustomerRow {
  id: string;
  key: string;
  display_name: string;
  salesforce_account_id: string | null;
  custom_category: string | null;
}

interface SfAccountCache {
  customer_id: string;
  sf_id: string;
  name: string;
  industry: string | null;
  number_of_employees: number | null;
  annual_revenue: number | null;
  website: string | null;
  billing_city: string | null;
  billing_country: string | null;
  owner_name: string | null;
}

interface SfOppCache {
  customer_id: string;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  is_closed: boolean;
  is_won: boolean;
}

interface MondayNpsCache {
  customer_id: string;
  raw_columns: Record<string, { text: string | null }>;
}

// ─── Derivations ──────────────────────────────────────────────────────
function deriveTier(category: string | null): "starter" | "growth" | "enterprise" | null {
  switch ((category ?? "").toLowerCase()) {
    case "strategic growth":
    case "upcoming renewals":
    case "at risk":
      return "enterprise";
    case "active":
    case "partner managed":
      return "growth";
    case "pov":
      return "starter";
    case "churned":
      return "enterprise"; // historical — they were paying us when they left
    default:
      return null;
  }
}

function deriveDeploymentStage(
  category: string | null
): "onboarding" | "pilot" | "scaling" | "mature" {
  switch ((category ?? "").toLowerCase()) {
    case "pov":
      return "pilot";
    case "churned":
      return "mature";
    case "active":
    case "strategic growth":
    case "upcoming renewals":
    case "at risk":
    case "partner managed":
      return "scaling";
    default:
      return "onboarding";
  }
}

function deriveHealthScore(category: string | null): number {
  switch ((category ?? "").toLowerCase()) {
    case "at risk":
      return 30;
    case "upcoming renewals":
      return 60;
    case "strategic growth":
      return 75;
    case "active":
      return 70;
    case "partner managed":
      return 65;
    case "pov":
      return 50;
    case "churned":
      return 0;
    default:
      return 50;
  }
}

function deriveChurnRisk(category: string | null): "low" | "medium" | "high" {
  switch ((category ?? "").toLowerCase()) {
    case "at risk":
    case "churned":
      return "high";
    case "upcoming renewals":
      return "medium";
    default:
      return "low";
  }
}

interface ArrDerivation {
  arr: number | null;
  renewal_date: string | null;
}

function deriveArr(opps: SfOppCache[]): ArrDerivation {
  if (opps.length === 0) return { arr: null, renewal_date: null };
  // Closed Won OR open w/ prob >= 50.
  const eligible = opps.filter(
    (o) => o.is_won || (!o.is_closed && (o.probability ?? 0) >= 50)
  );
  if (eligible.length === 0) return { arr: null, renewal_date: null };
  // Latest by close_date.
  const sorted = [...eligible].sort((a, b) =>
    (a.close_date ?? "") < (b.close_date ?? "") ? 1 : -1
  );
  const latest = sorted[0];
  // Renewal date = soonest *future* open opp w/ prob >= 50.
  const today = new Date().toISOString().slice(0, 10);
  const futureOpen = opps
    .filter((o) => !o.is_closed && (o.probability ?? 0) >= 50 && (o.close_date ?? "") >= today)
    .sort((a, b) => ((a.close_date ?? "") < (b.close_date ?? "") ? -1 : 1));
  return {
    arr: latest.amount ?? null,
    renewal_date: futureOpen[0]?.close_date ?? null,
  };
}

function buildContacts(rows: SfContactRow[]): Array<{ name: string; role: string; email: string; phone: string; notes: string }> {
  return rows.slice(0, 12).map((r) => ({
    name: [r.FirstName, r.LastName].filter(Boolean).join(" ") || "(unknown)",
    role: r.Title ?? "",
    email: r.Email ?? "",
    phone: r.Phone ?? "",
    notes: "",
  }));
}

function buildHeadquarters(acc: SfAccountCache | undefined): string {
  if (!acc) return "";
  return [acc.billing_city, acc.billing_country].filter(Boolean).join(", ");
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  const s = sb();

  console.log("Loading customers + cached SF + cached Monday…");
  const [custRes, accRes, oppRes, npsRes, existProfRes, existIntRes] = await Promise.all([
    s.from("customers").select("id, key, display_name, salesforce_account_id, custom_category").is("deleted_at", null),
    s.from("sf_accounts").select("customer_id, sf_id, name, industry, number_of_employees, annual_revenue, website, billing_city, billing_country, owner_name"),
    s.from("sf_opportunities").select("customer_id, name, stage_name, amount, close_date, probability, is_closed, is_won"),
    s.from("monday_nps_responses").select("customer_id, raw_columns"),
    s.from("profiles").select("customer_id, last_updated_by"),
    s.from("internal_profiles").select("customer_id, last_updated_by"),
  ]);
  for (const r of [custRes, accRes, oppRes, npsRes, existProfRes, existIntRes]) {
    if (r.error) throw r.error;
  }
  const customers = (custRes.data as CustomerRow[]) ?? [];
  const accounts = (accRes.data as SfAccountCache[]) ?? [];
  const opps = (oppRes.data as SfOppCache[]) ?? [];
  const nps = (npsRes.data as MondayNpsCache[]) ?? [];
  const existingProfiles = new Map(
    ((existProfRes.data as Array<{ customer_id: string; last_updated_by: string | null }>) ?? []).map(
      (p) => [p.customer_id, p.last_updated_by]
    )
  );
  const existingInternals = new Map(
    ((existIntRes.data as Array<{ customer_id: string; last_updated_by: string | null }>) ?? []).map(
      (p) => [p.customer_id, p.last_updated_by]
    )
  );

  const accByC = new Map(accounts.map((a) => [a.customer_id, a]));
  const oppsByC = new Map<string, SfOppCache[]>();
  for (const o of opps) {
    const list = oppsByC.get(o.customer_id) ?? [];
    list.push(o);
    oppsByC.set(o.customer_id, list);
  }
  const npsByC = new Map<string, MondayNpsCache[]>();
  for (const n of nps) {
    const list = npsByC.get(n.customer_id) ?? [];
    list.push(n);
    npsByC.set(n.customer_id, list);
  }

  // Fetch Contacts for all mapped SF accounts.
  const accountIds = accounts.map((a) => a.sf_id);
  console.log(`Fetching SF Contacts for ${accountIds.length} accounts…`);
  const contactsByAcc = await fetchContacts(accountIds);
  let contactsTotal = 0;
  for (const list of contactsByAcc.values()) contactsTotal += list.length;
  console.log(`  pulled ${contactsTotal} contacts across ${contactsByAcc.size} accounts\n`);

  let profileWrites = 0;
  let profileSkips = 0;
  let internalWrites = 0;
  let internalSkips = 0;

  for (const cust of customers) {
    const acc = accByC.get(cust.id);
    const accOpps = oppsByC.get(cust.id) ?? [];
    const accNps = npsByC.get(cust.id) ?? [];
    const contacts = acc ? buildContacts(contactsByAcc.get(acc.sf_id) ?? []) : [];

    const arrDeriv = deriveArr(accOpps);
    const profile = {
      customer_id: cust.id,
      industry: acc?.industry ?? "",
      employee_count: acc?.number_of_employees ?? 0,
      website: acc?.website ?? "",
      headquarters: buildHeadquarters(acc),
      fiscal_year_end: "",
      tier: deriveTier(cust.custom_category),
      start_date: null as string | null,
      renewal_date: arrDeriv.renewal_date,
      arr: arrDeriv.arr ?? 0,
      credit_limit: 0,
      billing_contact: "",
      deployment_stage: deriveDeploymentStage(cust.custom_category),
      automations_live: 0,
      active_users: 0,
      credits_used_mtd: 0,
      last_active_date: null as string | null,
      contacts,
      business_objectives: [],
      success_criteria: [],
      target_roi: "",
      custom: {},
      last_updated_by: BACKFILL_TAG,
    };

    // NPS: take the most recent score from cache if present.
    let npsScore = 0;
    const scoreCol = "numeric_mm0aqvk3"; // captured in lib/cache/integrations.ts
    if (accNps.length > 0) {
      const scores = accNps
        .map((n) => Number(n.raw_columns?.[scoreCol]?.text ?? ""))
        .filter((n) => Number.isFinite(n));
      if (scores.length > 0) npsScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
    const internal = {
      customer_id: cust.id,
      health_score: deriveHealthScore(cust.custom_category),
      nps_score: npsScore,
      csat_score: 0,
      last_qbr_date: null as string | null,
      next_qbr_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      churn_risk: deriveChurnRisk(cust.custom_category),
      strategic_notes: "",
      internal_notes: "",
      last_updated_by: BACKFILL_TAG,
      custom: {},
    };

    // Idempotency: only overwrite if existing was also a backfill (or doesn't exist).
    // If someone has edited it (last_updated_by != BACKFILL_TAG), respect their edits.
    const profPrior = existingProfiles.get(cust.id);
    if (profPrior !== undefined && profPrior !== null && !profPrior.startsWith("backfill-")) {
      profileSkips++;
      console.log(`  ${cust.display_name.padEnd(32)} profile: skipped (last_updated_by=${profPrior})`);
    } else {
      const { error } = await s.from("profiles").upsert(profile, { onConflict: "customer_id" });
      if (error) {
        console.log(`  ${cust.display_name.padEnd(32)} profile: ERROR ${error.message}`);
      } else {
        profileWrites++;
        const arrTag = arrDeriv.arr ? `ARR $${Math.round(arrDeriv.arr).toLocaleString()}` : "ARR —";
        const indTag = profile.industry ? `[${profile.industry}]` : "[no industry]";
        const cTag = `${profile.contacts.length} contacts`;
        console.log(`  ${cust.display_name.padEnd(32)} profile: ok  ${arrTag}  ${indTag}  ${cTag}`);
      }
    }

    const intPrior = existingInternals.get(cust.id);
    if (intPrior !== undefined && intPrior !== null && !intPrior.startsWith("backfill-")) {
      internalSkips++;
    } else {
      const { error } = await s.from("internal_profiles").upsert(internal, { onConflict: "customer_id" });
      if (error) {
        console.log(`  ${cust.display_name.padEnd(32)} internal: ERROR ${error.message}`);
      } else {
        internalWrites++;
      }
    }
  }

  console.log("");
  console.log("─".repeat(60));
  console.log(`Profiles:          ${profileWrites} written · ${profileSkips} skipped (had human edits)`);
  console.log(`Internal profiles: ${internalWrites} written · ${internalSkips} skipped (had human edits)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
