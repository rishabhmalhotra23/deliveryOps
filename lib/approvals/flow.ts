// High-level approval-flow orchestration.
// Composes the store + Slack cards + slack client + tool dispatcher.

import { requireCustomerByKey } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import { postMessage, updateMessage } from "@/lib/slack/client";
import {
  buildEmailDraftCard,
  buildActionApprovalCard,
  buildDecisionUpdate,
  buildDiscussThreadPrompt,
} from "@/lib/approvals/slack-cards";
import {
  createEmailApproval,
  createActionApproval,
  recordSlackCard,
  markApproved,
  markRejected,
  getApproval,
} from "@/lib/approvals/store";
import type { PendingApproval } from "@/lib/supabase/types";

const INTERNAL_PREFIX = "int-";

function approvalChannel(slackChannel: string | null, key: string): string {
  // Approval cards go to the internal mirror channel when present (so we
  // don't leak drafts into the customer-visible channel), otherwise to the
  // customer channel directly. Falls back to the customer key.
  return slackChannel ? `${INTERNAL_PREFIX}${slackChannel}` : `${INTERNAL_PREFIX}${key}`;
}

// ── queue email draft ─────────────────────────────────────────────────────

export interface QueueEmailDraftInput {
  customerKey: string;
  to: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
  gmailThreadId?: string | null;
}

export async function queueEmailDraft(input: QueueEmailDraftInput): Promise<PendingApproval> {
  const customer = await requireCustomerByKey(input.customerKey);
  const approval = await createEmailApproval({
    customerId: customer.id,
    toolInput: {
      to: input.to,
      subject: input.subject,
      body: input.body,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      gmailThreadId: input.gmailThreadId ?? null,
    },
    emailTo: input.to,
    emailSubject: input.subject,
    emailBody: input.body,
    emailInReplyTo: input.inReplyTo ?? null,
    emailReferences: input.references ?? null,
    emailGmailThreadId: input.gmailThreadId ?? null,
  });

  const channel = approvalChannel(customer.slack_channel, customer.key);
  try {
    const blocks = buildEmailDraftCard(approval);
    const summary = `Email draft to ${input.to.join(", ")}: ${input.subject}`;
    const sent = await postMessage(channel, summary, {
      blocks,
      customerKey: input.customerKey,
    });
    await recordSlackCard(approval.id, channel, sent.ts, sent.ts);
  } catch (err) {
    console.warn("[approvals] failed to post email card:", err);
  }

  await appendEvent(
    input.customerKey,
    "EMAIL_DRAFT_QUEUED",
    { approval_id: approval.id, to: input.to, subject: input.subject },
    {
      summary: `Email draft queued for approval → ${input.to.join(", ")}: ${input.subject}`,
      tags: ["email", "approval", "pending"],
    }
  );
  return approval;
}

// ── queue gated action ────────────────────────────────────────────────────

export interface QueueGatedActionInput {
  customerKey: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export async function queueGatedAction(input: QueueGatedActionInput): Promise<PendingApproval> {
  const customer = await requireCustomerByKey(input.customerKey);
  const approval = await createActionApproval({
    customerId: customer.id,
    toolName: input.toolName,
    toolInput: input.toolInput,
  });

  const channel = approvalChannel(customer.slack_channel, customer.key);
  try {
    const blocks = buildActionApprovalCard(approval);
    const summary = `Action queued for approval: ${input.toolName}`;
    const sent = await postMessage(channel, summary, {
      blocks,
      customerKey: input.customerKey,
    });
    await recordSlackCard(approval.id, channel, sent.ts, sent.ts);
  } catch (err) {
    console.warn("[approvals] failed to post action card:", err);
  }

  await appendEvent(
    input.customerKey,
    "ACTION_QUEUED",
    { approval_id: approval.id, tool: input.toolName },
    {
      summary: `Action queued for approval: ${input.toolName}`,
      tags: ["action", "approval", "pending"],
    }
  );
  return approval;
}

// ── decisions ─────────────────────────────────────────────────────────────

export async function approve(
  approval: PendingApproval,
  decidedBy: string
): Promise<{ ok: boolean; note: string }> {
  if (approval.state !== "pending") {
    return { ok: false, note: `Approval ${approval.id} is ${approval.state}, not pending.` };
  }

  if (approval.kind === "email_draft") {
    return executeEmailApproval(approval, decidedBy);
  }
  return executeActionApproval(approval, decidedBy);
}

export async function reject(
  approval: PendingApproval,
  decidedBy: string,
  note?: string
): Promise<{ ok: boolean; note: string }> {
  if (approval.state !== "pending") {
    return { ok: false, note: `Approval ${approval.id} is ${approval.state}.` };
  }
  const updated = await markRejected(approval.id, decidedBy, note);
  if (updated && updated.slack_channel && updated.slack_message_ts) {
    try {
      await updateMessage(updated.slack_channel, updated.slack_message_ts, "Rejected.", {
        blocks: buildDecisionUpdate(updated, decidedBy),
        customerKey: customerKeyFor(updated),
      });
    } catch (err) {
      console.warn("[approvals] reject update failed:", err);
    }
  }
  const customer = await customerForApproval(approval);
  if (customer) {
    await appendEvent(
      customer.key,
      approval.kind === "email_draft" ? "EMAIL_RESPONSE_REJECTED" : "ACTION_REJECTED",
      { approval_id: approval.id, by: decidedBy, note: note ?? null },
      { summary: `${approval.kind === "email_draft" ? "Email draft" : "Action"} rejected by ${decidedBy}` }
    );
  }
  return { ok: true, note: "Rejected." };
}

export async function postDiscussPrompt(
  approval: PendingApproval
): Promise<{ ok: boolean; note: string }> {
  if (!approval.slack_channel || !approval.slack_thread_ts) {
    return { ok: false, note: "Approval has no Slack thread to reply on." };
  }
  await postMessage(approval.slack_channel, "Reply in this thread.", {
    blocks: buildDiscussThreadPrompt(approval),
    thread_ts: approval.slack_thread_ts,
    customerKey: customerKeyFor(approval),
  });
  return { ok: true, note: "Discuss prompt posted in thread." };
}

// ── internals ─────────────────────────────────────────────────────────────

function customerKeyFor(a: PendingApproval): string {
  // We don't store the key, only the customer_id, but the slack channel
  // name carries it indirectly. For dev outbox tagging we fall back to id.
  return a.slack_channel?.replace(INTERNAL_PREFIX, "") ?? a.customer_id;
}

async function customerForApproval(a: PendingApproval): Promise<{ key: string } | null> {
  // Look up the customer by id rather than slack channel — the channel
  // name doesn't have to match the customer key exactly. The store row
  // stores customer_id; convert via the customers helper.
  try {
    const { listCustomers } = await import("@/lib/customers");
    const customers = await listCustomers();
    const match = customers.find((c) => c.id === a.customer_id);
    return match ? { key: match.key } : null;
  } catch {
    return null;
  }
}

async function executeEmailApproval(
  approval: PendingApproval,
  decidedBy: string
): Promise<{ ok: boolean; note: string }> {
  const customer = await customerForApproval(approval);
  if (!customer) return { ok: false, note: "Customer not found for this approval." };

  const fromAddr =
    (await requireCustomerByKey(customer.key)).email_alias ?? `${customer.key}@kognitos.com`;
  const { sendEmail } = await import("@/lib/integrations/google/gmail");
  try {
    const result = await sendEmail({
      fromAddr,
      to: approval.email_to ?? [],
      subject: approval.email_subject ?? "",
      bodyMarkdown: approval.email_body ?? "",
      inReplyTo: approval.email_in_reply_to ?? undefined,
      references: approval.email_references ?? undefined,
      threadId: approval.email_gmail_thread_id ?? undefined,
      customerKey: customer.key,
    });

    const updated = await markApproved(approval.id, decidedBy, `Sent (${result.id})`);
    if (updated && updated.slack_channel && updated.slack_message_ts) {
      try {
        await updateMessage(
          updated.slack_channel,
          updated.slack_message_ts,
          "Approved — email sent.",
          { blocks: buildDecisionUpdate(updated, decidedBy), customerKey: customer.key }
        );
      } catch (err) {
        console.warn("[approvals] approve email update failed:", err);
      }
    }
    await appendEvent(
      customer.key,
      "EMAIL_RESPONSE_SENT",
      {
        approval_id: approval.id,
        to: approval.email_to,
        subject: approval.email_subject,
        message_id: result.id,
      },
      {
        summary: `Email sent → ${(approval.email_to ?? []).join(", ")}: ${approval.email_subject}`,
        tags: ["email", "outbound"],
      }
    );
    return { ok: true, note: `Email sent (${result.id}).` };
  } catch (err) {
    return {
      ok: false,
      note: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function executeActionApproval(
  approval: PendingApproval,
  decidedBy: string
): Promise<{ ok: boolean; note: string }> {
  const customer = await customerForApproval(approval);
  if (!customer) return { ok: false, note: "Customer not found for this approval." };

  const { executeTool } = await import("@/lib/agent/handlers");
  try {
    const result = await executeTool(
      approval.tool_name,
      approval.tool_input,
      { customerKey: customer.key, source: "approved" }
    );

    const updated = await markApproved(approval.id, decidedBy, result.slice(0, 200));
    if (updated && updated.slack_channel && updated.slack_message_ts) {
      try {
        await updateMessage(updated.slack_channel, updated.slack_message_ts, "Approved — action executed.", {
          blocks: buildDecisionUpdate(updated, decidedBy),
          customerKey: customer.key,
        });
      } catch (err) {
        console.warn("[approvals] approve action update failed:", err);
      }
    }
    await appendEvent(
      customer.key,
      "ACTION_APPROVED",
      { approval_id: approval.id, tool: approval.tool_name, result: result.slice(0, 400) },
      { summary: `Action approved: ${approval.tool_name}`, tags: ["action", "approval"] }
    );
    return { ok: true, note: result.slice(0, 200) };
  } catch (err) {
    return {
      ok: false,
      note: `Action failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Re-export so the interactive route can fetch approvals directly without
// importing the store from app/.
export { getApproval };
