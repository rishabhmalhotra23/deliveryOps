// Persistence layer for the pending_approvals table.
// CRUD only — orchestration lives in lib/approvals/flow.ts.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type ApprovalKind, type ApprovalState, type PendingApproval } from "@/lib/supabase/types";

function makeId(prefix: "appr_email" | "appr_action"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export interface CreateEmailApprovalInput {
  customerId: string;
  toolInput: Record<string, unknown>;
  emailTo: string[];
  emailSubject: string;
  emailBody: string;
  emailInReplyTo?: string | null;
  emailReferences?: string | null;
  emailGmailThreadId?: string | null;
  createdBy?: string;
}

export async function createEmailApproval(input: CreateEmailApprovalInput): Promise<PendingApproval> {
  const sb = requireAdmin();
  const id = makeId("appr_email");
  const row = {
    id,
    customer_id: input.customerId,
    kind: "email_draft" as ApprovalKind,
    state: "pending" as ApprovalState,
    tool_name: "send_email",
    tool_input: input.toolInput,
    email_to: input.emailTo,
    email_subject: input.emailSubject,
    email_body: input.emailBody,
    email_in_reply_to: input.emailInReplyTo ?? null,
    email_references: input.emailReferences ?? null,
    email_gmail_thread_id: input.emailGmailThreadId ?? null,
    created_by: input.createdBy ?? "agent",
  };
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .insert(row)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`createEmailApproval failed: ${error?.message ?? "no row"}`);
  }
  return data as PendingApproval;
}

export interface CreateActionApprovalInput {
  customerId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdBy?: string;
}

export async function createActionApproval(input: CreateActionApprovalInput): Promise<PendingApproval> {
  const sb = requireAdmin();
  const id = makeId("appr_action");
  const row = {
    id,
    customer_id: input.customerId,
    kind: "gated_action" as ApprovalKind,
    state: "pending" as ApprovalState,
    tool_name: input.toolName,
    tool_input: input.toolInput,
    created_by: input.createdBy ?? "agent",
  };
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .insert(row)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`createActionApproval failed: ${error?.message ?? "no row"}`);
  }
  return data as PendingApproval;
}

export async function getApproval(id: string): Promise<PendingApproval | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data as PendingApproval) ?? null;
}

// Lookup by Slack thread — for routing thread replies back to the
// originating approval (the user typing in a thread = "discuss this draft").
export async function getApprovalBySlackThread(threadTs: string): Promise<PendingApproval | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .select("*")
    .eq("slack_thread_ts", threadTs)
    .eq("state", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as PendingApproval) ?? null;
}

export async function recordSlackCard(
  id: string,
  channel: string,
  messageTs: string,
  threadTs: string | null = null
): Promise<void> {
  const sb = requireAdmin();
  await sb
    .from(TABLES.pendingApprovals)
    .update({
      slack_channel: channel,
      slack_message_ts: messageTs,
      slack_thread_ts: threadTs ?? messageTs,
    })
    .eq("id", id);
}

export async function markApproved(id: string, decidedBy: string, note?: string): Promise<PendingApproval | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .update({
      state: "approved",
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note ?? null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return null;
  return data as PendingApproval;
}

export async function markRejected(id: string, decidedBy: string, note?: string): Promise<PendingApproval | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .update({
      state: "rejected",
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note ?? null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return null;
  return data as PendingApproval;
}

export async function applyRevision(
  id: string,
  patch: Record<string, unknown>,
  by: string,
  kind: "user_edit" | "agent_revise"
): Promise<PendingApproval | null> {
  const existing = await getApproval(id);
  if (!existing) return null;
  const revisions = [
    ...existing.revisions,
    { at: new Date().toISOString(), by, kind, patch },
  ];
  const updates: Record<string, unknown> = { revisions, state: "revised" };
  // Merge patch into the email-specific fields or tool_input as appropriate.
  if (existing.kind === "email_draft") {
    if (patch.to) updates.email_to = patch.to;
    if (patch.subject) updates.email_subject = patch.subject;
    if (patch.body) updates.email_body = patch.body;
    // Merge tool_input so the eventual send_email picks up the new fields.
    updates.tool_input = {
      ...existing.tool_input,
      ...(patch.to ? { to: patch.to } : {}),
      ...(patch.subject ? { subject: patch.subject } : {}),
      ...(patch.body ? { body: patch.body } : {}),
    };
  } else {
    updates.tool_input = { ...existing.tool_input, ...patch };
  }
  // Revising re-opens the approval for a new decision.
  updates.state = "pending";

  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.pendingApprovals)
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return null;
  return data as PendingApproval;
}

export async function listOpenApprovalsForCustomer(customerId: string): Promise<PendingApproval[]> {
  const sb = requireAdmin();
  const { data } = await sb
    .from(TABLES.pendingApprovals)
    .select("*")
    .eq("customer_id", customerId)
    .eq("state", "pending")
    .order("created_at", { ascending: false });
  return (data as PendingApproval[]) ?? [];
}
