// Salesforce client — server-to-server via OAuth client_credentials.
// Phase 2 entry point for sync-salesforce Inngest function and the
// /dev/integrations probe routes.
//
// Auth model: the Connected App must have Client Credentials Flow enabled
// with a "Run As" user assigned. The PAT-style flow gives us a fresh access
// token any time we ask (no refresh-token bookkeeping). We cache the token
// in-process for ~90% of its declared lifetime to avoid hammering the
// /token endpoint on every request.

const TOKEN_CACHE_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2h — Salesforce default

interface AccessToken {
  token: string;
  instanceUrl: string;
  expiresAt: number;
}

let _cached: AccessToken | null = null;

function readEnv(name: string, required = true): string | undefined {
  const v = process.env[name]?.trim();
  if (required && !v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function salesforceConfigured(): boolean {
  return Boolean(
    process.env.SALESFORCE_CLIENT_ID?.trim() &&
      process.env.SALESFORCE_CLIENT_SECRET?.trim() &&
      process.env.SALESFORCE_INSTANCE_URL?.trim()
  );
}

export async function getAccessToken(): Promise<AccessToken> {
  if (_cached && _cached.expiresAt > Date.now() + TOKEN_CACHE_BUFFER_MS) {
    return _cached;
  }

  const instance = readEnv("SALESFORCE_INSTANCE_URL")!.replace(/\/+$/, "");
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: readEnv("SALESFORCE_CLIENT_ID")!,
    client_secret: readEnv("SALESFORCE_CLIENT_SECRET")!,
  });

  const res = await fetch(`${instance}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as Record<string, string>).error ?? "unknown";
    const desc = (body as Record<string, string>).error_description ?? "";
    throw new Error(`Salesforce auth failed (${res.status}): ${err} — ${desc}`);
  }

  // Salesforce doesn't return expires_in for client_credentials; assume default.
  _cached = {
    token: (body as Record<string, string>).access_token,
    instanceUrl: (body as Record<string, string>).instance_url,
    expiresAt: Date.now() + DEFAULT_TOKEN_TTL_MS,
  };
  return _cached;
}

// ─── SOQL + REST helpers ────────────────────────────────────────────────────

const API_VERSION = "v60.0";

export interface SoqlResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export async function soql<T = Record<string, unknown>>(query: string): Promise<SoqlResponse<T>> {
  const { token, instanceUrl } = await getAccessToken();
  const url = `${instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce SOQL failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as SoqlResponse<T>;
}

/** Page through a SOQL query until `done` (Salesforce returns ≤2000 per page). */
export async function soqlAll<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const out: T[] = [];
  let page = await soql<T>(query);
  out.push(...page.records);
  while (!page.done && page.nextRecordsUrl) {
    page = await rest<SoqlResponse<T>>(page.nextRecordsUrl);
    out.push(...page.records);
  }
  return out;
}

interface OpportunityListViewDescribe {
  id: string;
  label: string;
  query: string;
}

/** Read the SOQL behind a saved Opportunity list view (Pipeline Inspection filter). */
export async function describeOpportunityListView(
  listViewId: string
): Promise<OpportunityListViewDescribe> {
  return rest<OpportunityListViewDescribe>(
    `/sobjects/Opportunity/listviews/${encodeURIComponent(listViewId)}/describe`
  );
}

const PIPELINE_OPP_SELECT = `
  Id, Name, StageName, Amount, CloseDate, Probability, IsClosed, IsWon,
  Type, AccountId, Account.Name, Owner.Name, LastModifiedDate
`.trim();

/**
 * Opportunities from a Pipeline Inspection / list-view filter (e.g. Binny
 * Gill's Team). Runs the list view's SOQL, then applies a close-date window.
 */
async function fetchOpportunitiesByIds(ids: string[]): Promise<SfOpportunity[]> {
  if (ids.length === 0) return [];
  const out: SfOpportunity[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const inClause = batch.map((id) => `'${escapeSoqlLiteral(id)}'`).join(",");
    const q = `SELECT ${PIPELINE_OPP_SELECT} FROM Opportunity WHERE Id IN (${inClause})`;
    out.push(...(await soqlAll<SfOpportunity>(q)));
  }
  return out;
}

export async function listOpportunitiesFromListView(
  listViewId: string,
  window: { start: string; end: string }
): Promise<{ label: string; records: SfOpportunity[] }> {
  const desc = await describeOpportunityListView(listViewId);
  const stubs = await soqlAll<Record<string, unknown>>(desc.query);

  // List-view SOQL often returns only Id — without CloseDate our 90-day
  // filter would drop every row. Hydrate full rows when needed.
  let records: SfOpportunity[];
  const sample = stubs[0];
  const hasCloseDate =
    sample != null &&
    ("CloseDate" in sample || "closeDate" in sample) &&
    (sample.CloseDate != null || sample.closeDate != null);
  if (!hasCloseDate && stubs.length > 0) {
    const ids = stubs
      .map((s) => (typeof s.Id === "string" ? s.Id : typeof s.id === "string" ? s.id : null))
      .filter((id): id is string => Boolean(id));
    records = await fetchOpportunitiesByIds(ids);
  } else {
    records = stubs as unknown as SfOpportunity[];
  }

  records = records.filter(
    (o) =>
      !o.IsClosed &&
      !o.IsWon &&
      (o.CloseDate ?? "") >= window.start &&
      (o.CloseDate ?? "") <= window.end
  );
  records.sort((a, b) => (b.Amount ?? 0) - (a.Amount ?? 0));
  return { label: desc.label, records };
}

export async function rest<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { token, instanceUrl } = await getAccessToken();
  const url = path.startsWith("http")
    ? path
    : `${instanceUrl}/services/data/${API_VERSION}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ─── Domain types ────────────────────────────────────────────────────────────

export interface SfAccount {
  Id: string;
  Name: string;
  Industry: string | null;
  AnnualRevenue: number | null;
  NumberOfEmployees: number | null;
  Type: string | null;
  Website: string | null;
  Phone: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Owner: { Name: string } | null;
  CreatedDate: string;
  LastModifiedDate: string;
}

export interface SfOpportunity {
  Id: string;
  Name: string;
  StageName: string;
  Amount: number | null;
  CloseDate: string;
  Probability: number | null;
  IsClosed: boolean;
  IsWon: boolean;
  Type?: string | null;
  AccountId: string;
  Account?: { Name: string } | null;
  Owner: { Name: string } | null;
  LastModifiedDate: string;
}

/** Default Pipeline Inspection list view — Binny Gill's Team (GTM weekly). */
export const DEFAULT_PIPELINE_LIST_VIEW_ID = "00BQQ000001ZI7x2AG";

export function pipelineListViewId(): string {
  return process.env.SALESFORCE_PIPELINE_LIST_VIEW_ID?.trim() || DEFAULT_PIPELINE_LIST_VIEW_ID;
}

/** Lightning host for deep links (Pipeline Inspection, opportunity records). */
export function salesforceLightningBase(): string | null {
  const instance = process.env.SALESFORCE_INSTANCE_URL?.trim().replace(/\/+$/, "");
  if (!instance) return null;
  if (instance.includes(".lightning.force.com")) return instance;
  if (instance.includes(".my.salesforce.com")) {
    return instance.replace(".my.salesforce.com", ".lightning.force.com");
  }
  return instance;
}

export function pipelineInspectionUrl(listViewId = pipelineListViewId()): string | null {
  const base = salesforceLightningBase();
  if (!base) return null;
  return `${base}/lightning/o/Opportunity/pipelineInspection?filterName=${encodeURIComponent(listViewId)}`;
}

export function opportunityRecordUrl(sfId: string): string | null {
  const base = salesforceLightningBase();
  if (!base) return null;
  return `${base}/lightning/r/Opportunity/${encodeURIComponent(sfId)}/view`;
}

export interface SfCase {
  Id: string;
  CaseNumber: string;
  Subject: string;
  Status: string;
  Priority: string | null;
  Origin: string | null;
  AccountId: string;
  IsClosed: boolean;
  CreatedDate: string;
  LastModifiedDate: string;
}

// ─── Convenience wrappers ───────────────────────────────────────────────────

export async function listAccounts(opts: { limit?: number; search?: string } = {}): Promise<SfAccount[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const where = opts.search
    ? `WHERE Name LIKE '${escapeSoqlLiteral(opts.search)}%'`
    : "";
  const q = `
    SELECT Id, Name, Industry, AnnualRevenue, NumberOfEmployees, Type, Website,
           Phone, BillingCity, BillingCountry, Owner.Name, CreatedDate, LastModifiedDate
    FROM Account ${where}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `.trim();
  const res = await soql<SfAccount>(q);
  return res.records;
}

export async function getAccount(id: string): Promise<SfAccount | null> {
  const safeId = escapeSoqlLiteral(id);
  const q = `
    SELECT Id, Name, Industry, AnnualRevenue, NumberOfEmployees, Type, Website,
           Phone, BillingCity, BillingCountry, Owner.Name, CreatedDate, LastModifiedDate
    FROM Account
    WHERE Id = '${safeId}'
    LIMIT 1
  `.trim();
  const res = await soql<SfAccount>(q);
  return res.records[0] ?? null;
}

export async function listOpportunities(opts: { accountId?: string; limit?: number } = {}): Promise<SfOpportunity[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const where = opts.accountId
    ? `WHERE AccountId = '${escapeSoqlLiteral(opts.accountId)}'`
    : "";
  const q = `
    SELECT ${PIPELINE_OPP_SELECT}
    FROM Opportunity ${where}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `.trim();
  const res = await soql<SfOpportunity>(q);
  return res.records;
}

export async function listCases(opts: { accountId?: string; limit?: number; openOnly?: boolean } = {}): Promise<SfCase[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const clauses: string[] = [];
  if (opts.accountId) clauses.push(`AccountId = '${escapeSoqlLiteral(opts.accountId)}'`);
  if (opts.openOnly) clauses.push("IsClosed = false");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const q = `
    SELECT Id, CaseNumber, Subject, Status, Priority, Origin, AccountId, IsClosed,
           CreatedDate, LastModifiedDate
    FROM Case ${where}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `.trim();
  const res = await soql<SfCase>(q);
  return res.records;
}

// ─── Safety ──────────────────────────────────────────────────────────────────

// Block trivial SOQL injection. Salesforce IDs are 15/18-char alphanumeric
// and account names rarely contain quotes — but we sanitise anyway.
function escapeSoqlLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
