// Loaders for the dashboard's overnight surface — "what changed overnight"
// + pending-approval queue. Both run as server queries with timestamps so
// the dashboard reflects the real activity since 9am yesterday.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";

export interface OvernightChange {
  customer_id: string;
  customer_key: string;
  customer_display_name: string;
  customer_logo_url: string | null;
  customer_email_alias: string | null;
  customer_category: string | null;
  customer_lifecycle_group: string | null;
  event_count: number;
  latest_summary: string | null;
  latest_ts: string | null;
}

export interface PendingApprovalSummary {
  id: string;
  customer_key: string;
  customer_display_name: string;
  kind: "email_draft" | "gated_action";
  tool_name: string;
  preview: string;
  created_at: string;
  slack_channel: string | null;
}

const HOURS_WINDOW = 18; // ~since yesterday morning

export async function loadOvernightChanges(limit = 6): Promise<OvernightChange[]> {
  const sb = requireAdmin();
  const customers = await listCustomers();
  if (customers.length === 0) return [];

  const cutoff = new Date(Date.now() - HOURS_WINDOW * 60 * 60 * 1000).toISOString();

  // Pull recent events across all customers in one query, then bucket
  // by customer in TS. Avoids one round-trip per customer.
  const { data, error } = await sb
    .from("events")
    .select("customer_id, summary, ts")
    .gte("ts", cutoff)
    .order("ts", { ascending: false })
    .limit(1000);
  if (error) return [];

  const byCustomer = new Map<string, { count: number; latest_summary: string; latest_ts: string }>();
  for (const row of (data as Array<{ customer_id: string; summary: string; ts: string }> | null) ?? []) {
    const existing = byCustomer.get(row.customer_id);
    if (existing) {
      existing.count++;
    } else {
      byCustomer.set(row.customer_id, {
        count: 1,
        latest_summary: row.summary,
        latest_ts: row.ts,
      });
    }
  }

  const mapped: Array<OvernightChange | null> = customers.map((c) => {
    const bucket = byCustomer.get(c.id);
    if (!bucket) return null;
    return {
      customer_id: c.id,
      customer_key: c.key,
      customer_display_name: c.display_name,
      customer_logo_url: c.logo_url,
      customer_email_alias: c.email_alias,
      customer_category: c.custom_category,
      customer_lifecycle_group: c.lifecycle_group,
      event_count: bucket.count,
      latest_summary: bucket.latest_summary,
      latest_ts: bucket.latest_ts,
    };
  });
  const out: OvernightChange[] = mapped
    .filter((x): x is OvernightChange => x !== null)
    .sort((a, b) => b.event_count - a.event_count)
    .slice(0, limit);
  return out;
}

export async function loadPendingApprovals(limit = 10): Promise<PendingApprovalSummary[]> {
  const sb = requireAdmin();
  const customers = await listCustomers();
  const byId = new Map(customers.map((c) => [c.id, c]));

  const { data, error } = await sb
    .from("pending_approvals")
    .select(
      "id, customer_id, kind, tool_name, email_subject, slack_channel, created_at"
    )
    .eq("state", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];

  const rows: PendingApprovalSummary[] = [];
  for (const r of (data as Array<{
    id: string;
    customer_id: string;
    kind: "email_draft" | "gated_action";
    tool_name: string;
    email_subject: string | null;
    slack_channel: string | null;
    created_at: string;
  }> | null) ?? []) {
    const cust = byId.get(r.customer_id);
    if (!cust) continue;
    rows.push({
      id: r.id,
      customer_key: cust.key,
      customer_display_name: cust.display_name,
      kind: r.kind,
      tool_name: r.tool_name,
      preview:
        r.kind === "email_draft"
          ? r.email_subject ?? "Email draft"
          : `Action: ${r.tool_name}`,
      created_at: r.created_at,
      slack_channel: r.slack_channel,
    });
  }
  return rows;
}
