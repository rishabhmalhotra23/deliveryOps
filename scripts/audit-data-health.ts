// Read-only data health audit. For each customer, scores completeness
// across Postgres + integration caches and surfaces gaps:
//   - missing or wrong SF mappings (cross-referenced with SF live names)
//   - missing Monday workspace mappings
//   - empty profiles
//   - missing rules
//   - cache freshness
//   - per-data-source counts (opps, cases, projects, activities, NPS)
//
// Also identifies SF account candidates for the 5 customers we know need
// remapping, so we can hand the user a ready-to-answer mapping table.
//
// Run with:  npx tsx scripts/audit-data-health.ts

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

// ─── SF + Monday clients (inline; identical pattern to other scripts) ─
let _sf: { token: string; instanceUrl: string; expiresAt: number } | null = null;
async function sfToken() {
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
  if (!res.ok) throw new Error(`SF auth ${res.status}: ${body.error}`);
  _sf = { token: body.access_token, instanceUrl: body.instance_url, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
  return _sf;
}

async function soql<T>(query: string): Promise<T[]> {
  const { token, instanceUrl } = await sfToken();
  const url = `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`SOQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json() as { records: T[] }).records;
}

interface SfAccountLite {
  Id: string;
  Name: string;
  Industry: string | null;
  NumberOfEmployees: number | null;
  AnnualRevenue: number | null;
}

async function lookupSfAccountsByName(fragments: string[]): Promise<Map<string, SfAccountLite[]>> {
  // For each fragment, find SF accounts whose Name contains it, exclude
  // the junk account ".". Cap at 6 candidates each.
  const out = new Map<string, SfAccountLite[]>();
  for (const frag of fragments) {
    const safe = frag.replace(/'/g, "\\'");
    const rows = await soql<SfAccountLite>(
      `SELECT Id, Name, Industry, NumberOfEmployees, AnnualRevenue
       FROM Account
       WHERE Name LIKE '%${safe}%' AND Name != '.'
       ORDER BY NumberOfEmployees DESC NULLS LAST
       LIMIT 6`
    );
    out.set(frag, rows);
  }
  return out;
}

// ─── Supabase reader ───────────────────────────────────────────────────
interface CustomerRow {
  id: string;
  key: string;
  display_name: string;
  monday_item_id: string | null;
  monday_workspace_id: string | null;
  salesforce_account_id: string | null;
  kognitos_v1_department_id: string | null;
  kognitos_v1_workspace_id: string | null;
  kognitos_v2_workspace_id: string | null;
  slack_channel: string | null;
  email_alias: string | null;
  drive_folder_id: string | null;
  partner: string | null;
  ae_owner: string | null;
  lifecycle_group: string | null;
  custom_category: string | null;
  deliveryops_protected_fields: string[] | null;
  last_manually_edited_at: string | null;
}

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadAll() {
  const s = sb();
  const [customers, profiles, internalProfiles, rules, sfAcc, sfOpps, sfCases, mProj, mAct, mNps, events, tasks, syncRuns] =
    await Promise.all([
      s.from("customers").select("*").is("deleted_at", null),
      s.from("profiles").select("customer_id, industry, arr, renewal_date, tier, deployment_stage, contacts, business_objectives"),
      s.from("internal_profiles").select("customer_id, health_score, nps_score, churn_risk, next_qbr_date"),
      s.from("rules").select("customer_id, content"),
      s.from("sf_accounts").select("customer_id, sf_id, name, synced_at, annual_revenue, number_of_employees, industry"),
      s.from("sf_opportunities").select("customer_id, sf_id, is_closed, is_won, amount"),
      s.from("sf_cases").select("customer_id, sf_id, is_closed"),
      s.from("monday_projects").select("customer_id, monday_item_id"),
      s.from("monday_activities").select("customer_id, monday_item_id"),
      s.from("monday_nps_responses").select("customer_id, monday_item_id"),
      s.from("events").select("customer_id"),
      s.from("tasks").select("customer_id, status").is("deleted_at", null),
      s.from("sync_runs").select("source, started_at, finished_at, status, rows_synced").order("started_at", { ascending: false }).limit(40),
    ]);
  for (const r of [customers, profiles, internalProfiles, rules, sfAcc, sfOpps, sfCases, mProj, mAct, mNps, events, tasks, syncRuns]) {
    if (r.error) throw r.error;
  }
  return {
    customers: (customers.data as CustomerRow[]) ?? [],
    profiles: profiles.data as Array<{
      customer_id: string;
      industry: string;
      arr: number;
      renewal_date: string | null;
      tier: string | null;
      deployment_stage: string;
      contacts: unknown[];
      business_objectives: unknown[];
    }>,
    internalProfiles: internalProfiles.data as Array<{
      customer_id: string;
      health_score: number;
      nps_score: number;
      churn_risk: string;
      next_qbr_date: string | null;
    }>,
    rules: rules.data as Array<{ customer_id: string; content: string }>,
    sfAcc: sfAcc.data as Array<{
      customer_id: string;
      sf_id: string;
      name: string;
      synced_at: string;
      annual_revenue: number | null;
      number_of_employees: number | null;
      industry: string | null;
    }>,
    sfOpps: sfOpps.data as Array<{ customer_id: string; sf_id: string; is_closed: boolean; is_won: boolean; amount: number | null }>,
    sfCases: sfCases.data as Array<{ customer_id: string; sf_id: string; is_closed: boolean }>,
    mProj: mProj.data as Array<{ customer_id: string; monday_item_id: string }>,
    mAct: mAct.data as Array<{ customer_id: string; monday_item_id: string }>,
    mNps: mNps.data as Array<{ customer_id: string; monday_item_id: string }>,
    events: events.data as Array<{ customer_id: string }>,
    tasks: tasks.data as Array<{ customer_id: string; status: string }>,
    syncRuns: syncRuns.data as Array<{ source: string; started_at: string; finished_at: string | null; status: string; rows_synced: number }>,
  };
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, Math.max(0, n - 1)) + "…";
  return s + " ".repeat(n - s.length);
}

function ago(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

async function main() {
  console.log("Loading state from Supabase…\n");
  const data = await loadAll();

  // Pre-bucket lookups by customer_id.
  const profilesByC = new Map(data.profiles.map((p) => [p.customer_id, p]));
  const internalsByC = new Map(data.internalProfiles.map((p) => [p.customer_id, p]));
  const rulesByC = new Map(data.rules.map((r) => [r.customer_id, r]));
  const sfAccByC = new Map(data.sfAcc.map((a) => [a.customer_id, a]));
  const oppsByC = new Map<string, typeof data.sfOpps>();
  for (const o of data.sfOpps) {
    const list = oppsByC.get(o.customer_id) ?? [];
    list.push(o);
    oppsByC.set(o.customer_id, list);
  }
  const casesByC = new Map<string, typeof data.sfCases>();
  for (const o of data.sfCases) {
    const list = casesByC.get(o.customer_id) ?? [];
    list.push(o);
    casesByC.set(o.customer_id, list);
  }
  const projByC = new Map<string, number>();
  for (const r of data.mProj) projByC.set(r.customer_id, (projByC.get(r.customer_id) ?? 0) + 1);
  const actByC = new Map<string, number>();
  for (const r of data.mAct) actByC.set(r.customer_id, (actByC.get(r.customer_id) ?? 0) + 1);
  const npsByC = new Map<string, number>();
  for (const r of data.mNps) npsByC.set(r.customer_id, (npsByC.get(r.customer_id) ?? 0) + 1);
  const eventsByC = new Map<string, number>();
  for (const r of data.events) eventsByC.set(r.customer_id, (eventsByC.get(r.customer_id) ?? 0) + 1);
  const tasksByC = new Map<string, number>();
  for (const r of data.tasks) if (r.status === "active") tasksByC.set(r.customer_id, (tasksByC.get(r.customer_id) ?? 0) + 1);

  // The 5 customers we already know have wrong/missing mappings.
  // For the *non-churned* ones, we'll fetch candidate SF accounts.
  const KNOWN_WRONG = new Set(["TSM Law", "American Towers", "Bradley & Beams", "TPI", "PPC"]);
  const KNOWN_UNMAPPED = new Set(["iHeartRadio", "SSD/SKP", "IOHK"]);

  const candidatesNeeded = data.customers
    .filter((c) => (KNOWN_WRONG.has(c.display_name) || KNOWN_UNMAPPED.has(c.display_name)) && (c.custom_category ?? "").toLowerCase() !== "churned")
    .map((c) => ({ name: c.display_name, search: c.display_name.replace(/[&,]/g, " ").split(/[\s\-/]+/).find((p) => p.length >= 3) ?? c.display_name }));

  console.log(`Looking up SF candidates for ${candidatesNeeded.length} non-churned customers needing remap…`);
  const candidates = await lookupSfAccountsByName(candidatesNeeded.map((c) => c.search));
  console.log("");

  // ─── Per-customer scoring ──────────────────────────────────────────
  type CustomerScore = {
    name: string;
    key: string;
    category: string | null;
    sf_mapped: boolean;
    sf_name: string | null;
    sf_synced_ago: string | null;
    sf_opps: number;
    sf_cases: number;
    monday_mapped: boolean;
    monday_workspace: boolean;
    monday_projects: number;
    monday_activities: number;
    monday_nps: number;
    has_slack: boolean;
    has_email_alias: boolean;
    has_drive_folder: boolean;
    has_kognitos_v1: boolean;
    has_kognitos_v2: boolean;
    has_profile: boolean;
    has_internal_profile: boolean;
    has_rules: boolean;
    events: number;
    active_tasks: number;
    issues: string[];
    candidate_remaps?: SfAccountLite[];
  };

  const scores: CustomerScore[] = [];

  for (const cust of data.customers) {
    const profile = profilesByC.get(cust.id);
    const internal = internalsByC.get(cust.id);
    const rules = rulesByC.get(cust.id);
    const sfAcc = sfAccByC.get(cust.id);
    const issues: string[] = [];

    if (cust.salesforce_account_id && !sfAcc) issues.push("SF mapped but no cache row (sync gap)");
    if (sfAcc && cust.salesforce_account_id !== sfAcc.sf_id) issues.push("SF cache row sf_id ≠ customers.salesforce_account_id");
    if (KNOWN_WRONG.has(cust.display_name)) issues.push("SF mapping flagged wrong");
    if (KNOWN_UNMAPPED.has(cust.display_name)) issues.push("no SF mapping");
    if (cust.monday_item_id && !projByC.get(cust.id) && !actByC.get(cust.id) && !npsByC.get(cust.id))
      issues.push("Monday item mapped but no Monday data cached");
    if (!profile) issues.push("no profile row");
    else if (!profile.arr && !profile.renewal_date) issues.push("profile is empty (arr=0, no renewal date)");
    if (!internal) issues.push("no internal_profile row");

    scores.push({
      name: cust.display_name,
      key: cust.key,
      category: cust.custom_category,
      sf_mapped: !!cust.salesforce_account_id,
      sf_name: sfAcc?.name ?? null,
      sf_synced_ago: sfAcc?.synced_at ? ago(sfAcc.synced_at) : null,
      sf_opps: oppsByC.get(cust.id)?.length ?? 0,
      sf_cases: casesByC.get(cust.id)?.length ?? 0,
      monday_mapped: !!cust.monday_item_id,
      monday_workspace: !!cust.monday_workspace_id,
      monday_projects: projByC.get(cust.id) ?? 0,
      monday_activities: actByC.get(cust.id) ?? 0,
      monday_nps: npsByC.get(cust.id) ?? 0,
      has_slack: !!cust.slack_channel,
      has_email_alias: !!cust.email_alias,
      has_drive_folder: !!cust.drive_folder_id,
      has_kognitos_v1: !!cust.kognitos_v1_department_id || !!cust.kognitos_v1_workspace_id,
      has_kognitos_v2: !!cust.kognitos_v2_workspace_id,
      has_profile: !!profile,
      has_internal_profile: !!internal,
      has_rules: !!rules?.content?.trim(),
      events: eventsByC.get(cust.id) ?? 0,
      active_tasks: tasksByC.get(cust.id) ?? 0,
      issues,
    });
  }

  for (const need of candidatesNeeded) {
    const score = scores.find((s) => s.name === need.name);
    if (score) score.candidate_remaps = candidates.get(need.search) ?? [];
  }

  // ─── Section 1: top-level health stats ────────────────────────────
  const total = scores.length;
  const sfMapped = scores.filter((s) => s.sf_mapped).length;
  const sfWrong = scores.filter((s) => s.issues.includes("SF mapping flagged wrong")).length;
  const sfUnmapped = scores.filter((s) => s.issues.includes("no SF mapping")).length;
  const mondayMapped = scores.filter((s) => s.monday_mapped).length;
  const withWorkspace = scores.filter((s) => s.monday_workspace).length;
  const withSlack = scores.filter((s) => s.has_slack).length;
  const withProfile = scores.filter((s) => s.has_profile).length;
  const withInternal = scores.filter((s) => s.has_internal_profile).length;
  const withRules = scores.filter((s) => s.has_rules).length;
  const cleanCustomers = scores.filter((s) => s.issues.length === 0).length;

  const lastSf = data.syncRuns.find((r) => r.source === "salesforce" && r.status === "ok");
  const lastMon = data.syncRuns.find((r) => r.source === "monday" && r.status === "ok");

  console.log("─".repeat(100));
  console.log("OVERALL DATA HEALTH");
  console.log("─".repeat(100));
  console.log(`Customers (active, non-deleted)   : ${total}`);
  console.log(`  with no flagged issues          : ${cleanCustomers}`);
  console.log(`  with at least one issue         : ${total - cleanCustomers}`);
  console.log("");
  console.log(`Salesforce`);
  console.log(`  mapped to an SF account         : ${sfMapped}/${total}`);
  console.log(`  flagged as wrong mapping        : ${sfWrong}`);
  console.log(`  no mapping at all               : ${sfUnmapped}`);
  console.log(`  last successful sync            : ${lastSf ? ago(lastSf.finished_at ?? lastSf.started_at) + " ago, " + lastSf.rows_synced + " rows" : "never"}`);
  console.log("");
  console.log(`Monday`);
  console.log(`  mapped to a Monday item         : ${mondayMapped}/${total}`);
  console.log(`  with own workspace              : ${withWorkspace}/${total}`);
  console.log(`  last successful sync            : ${lastMon ? ago(lastMon.finished_at ?? lastMon.started_at) + " ago" : "never"}`);
  console.log("");
  console.log(`Other identifiers`);
  console.log(`  Slack channel set               : ${withSlack}/${total}`);
  console.log(`  Email alias set                 : ${scores.filter(s=>s.has_email_alias).length}/${total}`);
  console.log(`  Drive folder set                : ${scores.filter(s=>s.has_drive_folder).length}/${total}`);
  console.log(`  Kognitos v1 set                 : ${scores.filter(s=>s.has_kognitos_v1).length}/${total}`);
  console.log(`  Kognitos v2 set                 : ${scores.filter(s=>s.has_kognitos_v2).length}/${total}`);
  console.log("");
  console.log(`Postgres tables`);
  console.log(`  profile rows                    : ${withProfile}/${total}`);
  console.log(`  internal_profile rows           : ${withInternal}/${total}`);
  console.log(`  customers with rules content    : ${withRules}/${total}`);
  console.log("");

  // ─── Section 2: per-customer ────────────────────────────────────────
  console.log("─".repeat(100));
  console.log("PER-CUSTOMER (grouped by category)");
  console.log("─".repeat(100));
  console.log("Columns: SF=mapped/synced  M=monday item/projects  Slack/Email/Drive/K1/K2  Pro/IPro/Rul  Issues");
  console.log("");

  const order = ["At Risk", "Upcoming Renewals", "Strategic Growth", "Active", "Partner Managed", "POV", "Churned", "(uncategorised)"];
  const byCat = new Map<string, CustomerScore[]>();
  for (const s of scores) {
    const cat = s.category ?? "(uncategorised)";
    const list = byCat.get(cat) ?? [];
    list.push(s);
    byCat.set(cat, list);
  }

  for (const cat of order) {
    const list = byCat.get(cat);
    if (!list?.length) continue;
    console.log(`┃ ${cat.toUpperCase()}  (${list.length})`);
    for (const s of list) {
      const sfTag = s.sf_mapped
        ? `SF:${pad(s.sf_name ?? "?", 28)} ${s.sf_synced_ago ? "(synced " + s.sf_synced_ago + " ago)" : "(uncached)"}`
        : "SF:—";
      const mondayTag = `M:${s.monday_mapped ? "✓" : "—"}/p${s.monday_projects}/a${s.monday_activities}/n${s.monday_nps}`;
      const idTag = `${s.has_slack ? "S" : "_"}${s.has_email_alias ? "E" : "_"}${s.has_drive_folder ? "D" : "_"}${s.has_kognitos_v1 ? "1" : "_"}${s.has_kognitos_v2 ? "2" : "_"}`;
      const pgTag = `${s.has_profile ? "P" : "_"}${s.has_internal_profile ? "I" : "_"}${s.has_rules ? "R" : "_"}`;
      const issuesTag = s.issues.length ? `⚠ ${s.issues.join("; ")}` : "✓ clean";
      console.log(`  ${pad(s.name, 32)}  ${pad(sfTag, 60)}  ${mondayTag}  ${idTag}  ${pgTag}  ${issuesTag}`);
    }
    console.log("");
  }

  // ─── Section 3: mapping decisions for actives ──────────────────────
  const needsAnswer = scores.filter((s) => s.candidate_remaps !== undefined);
  if (needsAnswer.length > 0) {
    console.log("─".repeat(100));
    console.log(`SF MAPPING DECISIONS NEEDED (${needsAnswer.length} non-churned customers)`);
    console.log("─".repeat(100));
    for (const s of needsAnswer) {
      console.log(`\n  ${s.name}  [${s.category}]`);
      console.log(`    current mapping: ${s.sf_mapped ? `${s.sf_name} (problematic)` : "(none)"}`);
      console.log(`    candidates:`);
      const cands = s.candidate_remaps ?? [];
      if (cands.length === 0) {
        console.log(`      (no SF account names contain "${s.name.split(/\s+/)[0]}")`);
        continue;
      }
      for (const c of cands) {
        console.log(
          `      • ${pad(c.Name, 50)}  Industry=${pad(c.Industry ?? "—", 28)}  Emp=${c.NumberOfEmployees ?? "—"}  ARR=${c.AnnualRevenue ?? "—"}  id=${c.Id}`
        );
      }
    }
    console.log("");
  }

  // ─── Section 4: write a JSON snapshot so we can diff later ─────────
  const snapshot = {
    generated_at: new Date().toISOString(),
    summary: {
      total,
      clean: cleanCustomers,
      sf_mapped: sfMapped,
      sf_wrong: sfWrong,
      sf_unmapped: sfUnmapped,
      monday_mapped: mondayMapped,
      with_workspace: withWorkspace,
      last_sf_sync: lastSf?.finished_at ?? null,
      last_monday_sync: lastMon?.finished_at ?? null,
    },
    scores,
  };
  fs.writeFileSync(
    path.resolve(process.cwd(), "scripts/.data-health-snapshot.json"),
    JSON.stringify(snapshot, null, 2)
  );
  console.log(`Snapshot written: scripts/.data-health-snapshot.json`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
