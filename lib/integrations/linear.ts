// Linear GraphQL client — read-only.
//
// Used to sync ticket metadata relevant to the V2 migration into
// linear_tickets (see lib/sync/linear-tickets.ts). Deliberately has no
// mutation helpers and none should be added: team_asks / linear_tickets
// classification is never written back to Linear — a human updates the
// real ticket by hand. See supabase/migrations/0017_linear_tickets.sql.
//
// Auth: personal API key, sent as the raw Authorization header value (NOT
// "Bearer <token>" — that prefix is only for OAuth2 access tokens). See
// https://linear.app/developers/graphql.

const ENDPOINT = "https://api.linear.app/graphql";

export function linearConfigured(): boolean {
  return Boolean(process.env.LINEAR_API_TOKEN?.trim());
}

function config(): { token: string } {
  const token = process.env.LINEAR_API_TOKEN?.trim();
  if (!token) throw new Error("Missing LINEAR_API_TOKEN env var.");
  return { token };
}

async function request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { token } = config();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear API returned errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Linear API returned no data.");
  return json.data;
}

// ─── Domain types ────────────────────────────────────────────────────────────

export interface LinearIssue {
  /** Human-readable identifier, e.g. "KOG-11842" — used as our primary key. */
  identifier: string;
  title: string;
  url: string;
  team: string | null;
  project: string | null;
  labels: string[];
  /** priorityLabel: Urgent/High/Medium/Low/No priority. */
  priority: string | null;
  /** Workflow state name, e.g. "In Review (in progress)". */
  status: string;
  /** Workflow state type: triage/backlog/unstarted/started/completed/canceled. */
  statusType: string;
  createdAt: string;
  completedAt: string | null;
  canceledAt: string | null;
}

// Tickets relevant to the V2 migration — scoped to the "v2 Migration
// Blockers" label only (Rishabh, 2026-08-10: the prior net additionally
// pulled in gc-feedback/ux-quality/Bugathon-labelled tickets, any "cust*"
// label, and anything from the On-Call/Integrations/Product Improvements
// teams — general engineering-roadmap noise, not migration blockers. Every
// browser-automation-domain ticket already carries the "v2 Migration
// Blockers" label in production, so narrowing to just this label doesn't
// drop any real blocker — it drops 78 of 150 previously-synced tickets that
// were never actually migration-relevant. in_scope on linear_tickets was
// meant to flip that noise back out via a periodic classification pass, but
// that pass never ran for this batch — narrowing the net here means a
// future sync can't reintroduce the same class of noise even if that pass
// is skipped again).
export const SOURCE_LABELS = ["v2 Migration Blockers"];

const PAGE_SIZE = 100;
const MAX_ISSUES = 2000; // safety cap — current volume is in the low hundreds

const ISSUES_QUERY = `
  query RelevantIssues($after: String) {
    issues(
      first: ${PAGE_SIZE}
      after: $after
      includeArchived: true
      filter: {
        labels: { name: { in: ${JSON.stringify(SOURCE_LABELS)} } }
      }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        identifier
        title
        url
        priorityLabel
        createdAt
        completedAt
        canceledAt
        team { name }
        project { name }
        state { name type }
        labels { nodes { name } }
      }
    }
  }
`;

interface RawIssuesResponse {
  issues: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      identifier: string;
      title: string;
      url: string;
      priorityLabel: string | null;
      createdAt: string;
      completedAt: string | null;
      canceledAt: string | null;
      team: { name: string } | null;
      project: { name: string } | null;
      state: { name: string; type: string };
      labels: { nodes: Array<{ name: string }> };
    }>;
  };
}

export async function listRelevantIssues(): Promise<LinearIssue[]> {
  const out: LinearIssue[] = [];
  let after: string | null = null;
  do {
    const data: RawIssuesResponse = await request<RawIssuesResponse>(ISSUES_QUERY, { after });
    for (const n of data.issues.nodes) {
      out.push({
        identifier: n.identifier,
        title: n.title,
        url: n.url,
        team: n.team?.name ?? null,
        project: n.project?.name ?? null,
        labels: n.labels.nodes.map((l) => l.name),
        priority: n.priorityLabel ?? null,
        status: n.state.name,
        statusType: n.state.type,
        createdAt: n.createdAt,
        completedAt: n.completedAt ?? null,
        canceledAt: n.canceledAt ?? null,
      });
    }
    after = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
  } while (after && out.length < MAX_ISSUES);
  return out;
}

/** Which label surfaced this ticket — mirrors the "source" column filled in
 *  by hand during the original triage pass. Every ticket listRelevantIssues()
 *  returns already carries the "v2 Migration Blockers" label (the query's
 *  own filter guarantees it), so this always resolves to that one label. */
export function resolveSource(labels: string[]): string {
  return labels.includes("v2 Migration Blockers") ? "v2 Migration Blockers" : labels[0] ?? "unknown";
}
