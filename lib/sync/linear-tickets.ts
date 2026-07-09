// Linear tickets sync — pulls raw ticket metadata for the wide V2-migration
// net (see lib/integrations/linear.ts) into linear_tickets. Upserts raw
// fields only; classification / confidence / rationale / domain / in_scope
// are a separate periodic Claude-assisted pass and are never touched here
// (see supabase/migrations/0017_linear_tickets.sql).
//
// closed_at is stamped by this job the first time it observes a ticket in a
// completed/canceled state — it is NOT copied from Linear's own
// completedAt/canceledAt. Those reflect when Linear closed the ticket, not
// "the day we noticed"; once stamped, later syncs never move it, even if
// the ticket reopens and closes again.

import { requireAdmin } from "@/lib/supabase/server";
import {
  listRelevantIssues,
  resolveSource,
  linearConfigured,
  type LinearIssue,
} from "@/lib/integrations/linear";

export interface LinearTicketsSyncResult {
  fetched: number;
  upserted: number;
  newly_closed: number;
  errors: Array<{ stage: string; error: string }>;
}

const CLOSED_TYPES = new Set(["completed", "canceled"]);

export async function syncLinearTickets(): Promise<LinearTicketsSyncResult> {
  const result: LinearTicketsSyncResult = { fetched: 0, upserted: 0, newly_closed: 0, errors: [] };

  if (!linearConfigured()) {
    result.errors.push({ stage: "config", error: "LINEAR_API_TOKEN missing." });
    return result;
  }

  const sb = requireAdmin();

  // ─── 1. Fetch ─────────────────────────────────────────────────────────────
  let issues: LinearIssue[] = [];
  try {
    issues = await listRelevantIssues();
    result.fetched = issues.length;
  } catch (err) {
    result.errors.push({ stage: "fetch", error: err instanceof Error ? err.message : String(err) });
    return result;
  }

  // ─── 2. Preload existing closed_at so a stamped value never moves ─────────
  const closedAtById = new Map<string, string | null>();
  try {
    const { data, error } = await sb.from("linear_tickets").select("id, closed_at");
    if (error) throw error;
    for (const row of (data as Array<{ id: string; closed_at: string | null }> | null) ?? []) {
      closedAtById.set(row.id, row.closed_at);
    }
  } catch (err) {
    result.errors.push({ stage: "preload", error: err instanceof Error ? err.message : String(err) });
    // Not fatal — proceed treating every ticket as previously unseen. Worst
    // case a ticket already closed gets closed_at re-stamped to "now"
    // instead of keeping its original stamp.
  }

  // ─── 3. Upsert raw fields ───────────────────────────────────────────────
  const now = new Date().toISOString();
  for (const issue of issues) {
    const isClosed = CLOSED_TYPES.has(issue.statusType);
    const existingClosedAt = closedAtById.get(issue.identifier) ?? null;
    const closed_at = existingClosedAt ?? (isClosed ? now : null);

    const row = {
      id: issue.identifier,
      title: issue.title,
      url: issue.url,
      team: issue.team,
      project: issue.project,
      source: resolveSource(issue.labels, issue.team),
      priority: issue.priority,
      linear_status: issue.status,
      status_type: issue.statusType,
      linear_created_at: issue.createdAt,
      closed_at,
      last_synced_at: now,
    };

    const { error } = await sb.from("linear_tickets").upsert(row, { onConflict: "id" });
    if (!error) {
      result.upserted++;
      if (isClosed && existingClosedAt === null) result.newly_closed++;
    } else {
      result.errors.push({ stage: `upsert/${issue.identifier}`, error: error.message });
    }
  }

  return result;
}
