// Slack Block Kit cards for the approval flow. Each card is keyed by the
// pending_approvals.id and posts to the customer's Slack channel.
//
// Returns Slack Block Kit blocks (Record arrays). Posting + thread tracking
// lives in lib/approvals/flow.ts.

import type { PendingApproval } from "@/lib/supabase/types";

type Block = Record<string, unknown>;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function buildEmailDraftCard(a: PendingApproval): Block[] {
  const to = (a.email_to ?? []).join(", ") || "(no recipients)";
  const subject = a.email_subject ?? "(no subject)";
  const body = truncate(a.email_body ?? "", 2800);

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Email draft — needs approval", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*To*\n${to}` },
        { type: "mrkdwn", text: `*Subject*\n${subject}` },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: body || "_(empty body)_" },
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: `email_${a.id}`,
      elements: [
        {
          type: "button",
          action_id: "approve_email",
          style: "primary",
          text: { type: "plain_text", text: "Approve & send" },
          value: a.id,
        },
        {
          type: "button",
          action_id: "reject_email",
          style: "danger",
          text: { type: "plain_text", text: "Reject" },
          value: a.id,
        },
        {
          type: "button",
          action_id: "discuss_email",
          text: { type: "plain_text", text: "Discuss in thread" },
          value: a.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `\`${a.id}\` · drafted ${new Date(a.created_at).toLocaleString()}` },
      ],
    },
  ];
}

export function buildActionApprovalCard(a: PendingApproval): Block[] {
  const summary = describeAction(a);
  const inputJson = JSON.stringify(a.tool_input, null, 2);

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `Action — needs approval`, emoji: false },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Tool:* \`${a.tool_name}\`\n${summary}` },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Payload*\n```\n" + truncate(inputJson, 2800) + "\n```" },
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: `action_${a.id}`,
      elements: [
        {
          type: "button",
          action_id: "approve_action",
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value: a.id,
        },
        {
          type: "button",
          action_id: "reject_action",
          style: "danger",
          text: { type: "plain_text", text: "Reject" },
          value: a.id,
        },
        {
          type: "button",
          action_id: "discuss_action",
          text: { type: "plain_text", text: "Discuss in thread" },
          value: a.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `\`${a.id}\` · drafted ${new Date(a.created_at).toLocaleString()}` },
      ],
    },
  ];
}

function describeAction(a: PendingApproval): string {
  switch (a.tool_name) {
    case "update_customer_profile": {
      const updates = (a.tool_input.updates as Record<string, unknown>) ?? {};
      const keys = Object.keys(updates);
      return `Update ${keys.length} profile field${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}`;
    }
    case "update_customer_rules":
      return `Replace the customer's rules markdown.`;
    default:
      return `Run \`${a.tool_name}\` with the payload below.`;
  }
}

export function buildDecisionUpdate(a: PendingApproval, decidedBy: string): Block[] {
  const isApproved = a.state === "approved";
  const label = isApproved ? "Approved" : a.state === "rejected" ? "Rejected" : a.state;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          a.kind === "email_draft"
            ? `*${label}* — email${isApproved ? " sent" : " not sent"}.`
            : `*${label}* — action${isApproved ? " executed" : " not executed"}.`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${decidedBy} at ${new Date().toLocaleString()} · \`${a.id}\``,
        },
      ],
    },
  ];
}

export function buildDiscussThreadPrompt(a: PendingApproval): Block[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          a.kind === "email_draft"
            ? "Reply in this thread with what to change (recipients, subject, or new body). The agent will revise the draft and re-post it for approval."
            : "Reply in this thread with what to change (specific field updates). The agent will revise the payload and re-post it for approval.",
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `\`${a.id}\`` }],
    },
  ];
}
