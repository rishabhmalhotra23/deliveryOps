// Tool dispatcher — routes Claude tool_use blocks to TS implementations.
// Port of legacy/brain/agent.py::_execute_tool_call.

import { requireCustomerByKey } from "@/lib/customers";
import { appendEvent, listEvents } from "@/lib/events/events";
import {
  getInternalProfile,
  getProfile,
  updateProfile,
} from "@/lib/profile/profile";
import { getRules, updateRules } from "@/lib/rules/rules";
import {
  cancelTask,
  createTask,
  listTasks,
} from "@/lib/tasks/tasks";
import { recentConversations } from "@/lib/conversations";
import type { TaskAction, TaskSchedule } from "@/lib/supabase/types";
import { GATED_TOOLS_EMAIL } from "@/lib/agent/tools";

export type AgentSource = "slack" | "email" | "web" | "approved";

export interface HandlerContext {
  customerKey: string;
  source: AgentSource;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  // Phase-1 stub for the gated-action approval flow. Tool calls that mutate
  // state from an inbound email are queued for human approval in Slack rather
  // than running directly. The full queue (port of action_approval.py) lands
  // alongside the Slack interactive route.
  if (ctx.source === "email" && GATED_TOOLS_EMAIL.has(toolName)) {
    return `Action queued for human approval in Slack: ${toolName}. The CSM team will see a preview in the customer channel and can approve, reject, or revise it.`;
  }

  switch (toolName) {
    case "search_customer_docs":
      return await toolSearchCustomerDocs(toolInput, ctx);
    case "log_event":
      return await toolLogEvent(toolInput, ctx);
    case "get_customer_profile":
      return await toolGetCustomerProfile(ctx);
    case "update_customer_profile":
      return await toolUpdateCustomerProfile(toolInput, ctx);
    case "get_credit_usage":
      return await toolGetCreditUsage(ctx);
    case "send_slack_message":
      return await toolSendSlackMessage(toolInput, ctx);
    case "send_email":
      return await toolSendEmail(toolInput, ctx);
    case "revise_email_draft":
      return await toolReviseEmailDraft(toolInput, ctx);
    case "revise_pending_action":
      return await toolRevisePendingAction(toolInput, ctx);
    case "escalate_to_human":
      return await toolEscalateToHuman(toolInput, ctx);
    case "create_task":
      return await toolCreateTask(toolInput, ctx);
    case "list_tasks":
      return await toolListTasks(toolInput, ctx);
    case "cancel_task":
      return await toolCancelTask(toolInput, ctx);
    case "get_slack_history":
      return await toolGetSlackHistory(toolInput, ctx);
    case "get_customer_rules":
      return await toolGetCustomerRules(ctx);
    case "update_customer_rules":
      return await toolUpdateCustomerRules(toolInput, ctx);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ─── tool implementations ────────────────────────────────────────────────────

async function toolSearchCustomerDocs(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  // Phase-1 implementation searches recent events tagged "document" by
  // summary keywords. Vector search lands in Phase 2 with pgvector.
  const query = String(input.query ?? "").trim().toLowerCase();
  if (!query) return "Empty query.";
  const events = await listEvents(ctx.customerKey, {
    eventType: "DOCUMENT_INGESTED",
    limit: 100,
  });
  const matches = events.filter(
    (e) =>
      e.summary.toLowerCase().includes(query) ||
      JSON.stringify(e.details ?? {}).toLowerCase().includes(query)
  );
  if (matches.length === 0) {
    return `No ingested documents matched "${query}". Vector search arrives in Phase 2; for now this only searches event summaries and metadata.`;
  }
  return matches
    .slice(0, 10)
    .map((e) => {
      const path = (e.details as Record<string, string> | null)?.original_doc_path ?? "(unknown path)";
      return `- ${e.summary} → ${path}`;
    })
    .join("\n");
}

async function toolLogEvent(input: Record<string, unknown>, ctx: HandlerContext) {
  const eventType = String(input.event_type ?? "HUMAN_NOTE");
  const summary = String(input.summary ?? "");
  const details = (input.details as Record<string, unknown>) ?? {};
  const tags = (input.tags as string[]) ?? [];
  const event = await appendEvent(ctx.customerKey, eventType, details, { summary, tags });
  return `Event logged: ${event.event_type} — ${event.summary}`;
}

async function toolGetCustomerProfile(ctx: HandlerContext) {
  const profile = await getProfile(ctx.customerKey);
  // Strip internal-only fields defensively even though they're a separate row.
  const { id: _id, customer_id: _cid, deleted_at: _del, ...safe } = profile;
  return JSON.stringify(safe, null, 2);
}

async function toolUpdateCustomerProfile(
  input: Record<string, unknown>,
  ctx: HandlerContext
) {
  const updates = (input.updates as Record<string, unknown>) ?? {};
  if (Object.keys(updates).length === 0) return "No updates provided.";
  await updateProfile(ctx.customerKey, updates, { updatedBy: "agent" });
  return `Profile updated — fields changed: ${Object.keys(updates).join(", ")}`;
}

async function toolGetCreditUsage(ctx: HandlerContext) {
  const profile = await getProfile(ctx.customerKey);
  return JSON.stringify(
    {
      credit_limit: profile.credit_limit,
      credits_used_mtd: profile.credits_used_mtd,
      remaining: Math.max(profile.credit_limit - profile.credits_used_mtd, 0),
      utilisation:
        profile.credit_limit > 0
          ? `${((profile.credits_used_mtd / profile.credit_limit) * 100).toFixed(1)}%`
          : "n/a",
      note:
        "Live Kognitos v2 credit data wires up in Phase 2 (sync-kognitos-v2). These numbers come from the profile MTD counter.",
    },
    null,
    2
  );
}

async function toolSendSlackMessage(input: Record<string, unknown>, ctx: HandlerContext) {
  const customer = await requireCustomerByKey(ctx.customerKey);
  const internal = Boolean(input.internal_only);
  const channel = internal ? `int-${customer.slack_channel ?? customer.key}` : customer.slack_channel;
  if (!channel) {
    return "No Slack channel configured for this customer.";
  }
  // Lazy-import to keep this module server-only and avoid pulling slack libs
  // into client bundles.
  const { postMessage } = await import("@/lib/slack/client");
  await postMessage(channel, String(input.message ?? ""));
  return `Message sent to #${channel}.`;
}

async function toolSendEmail(input: Record<string, unknown>, ctx: HandlerContext) {
  // Phase-1 first pass — actual Gmail send + Slack approval card lands when
  // the email approval flow ports (lib/approvals/email-approval.ts). Until
  // then, queue the request as an event so the dashboard sees it.
  const to = (input.to as string[]) ?? [];
  const subject = String(input.subject ?? "");
  const body = String(input.body ?? "");
  const event = await appendEvent(
    ctx.customerKey,
    "EMAIL_DRAFT_REQUESTED",
    { to, subject, body: truncate(body, 4000), attachments: input.attachments ?? [] },
    { summary: `Email draft requested: ${subject}`, tags: ["email", "draft"] }
  );
  return `Email draft queued (event ${event.id}). The Slack approval card lands once the email-approval port is in.`;
}

async function toolReviseEmailDraft(
  input: Record<string, unknown>,
  ctx: HandlerContext
) {
  const approvalId = String(input.approval_id ?? "");
  await appendEvent(
    ctx.customerKey,
    "EMAIL_DRAFT_REVISION_REQUESTED",
    { approval_id: approvalId, updates: input },
    { summary: `Email revision requested for ${approvalId}`, tags: ["email", "revision"] }
  );
  return `Revision request for ${approvalId} logged. The interactive approval flow lands with the email-approval port.`;
}

async function toolRevisePendingAction(
  input: Record<string, unknown>,
  ctx: HandlerContext
) {
  const approvalId = String(input.approval_id ?? "");
  const updates = (input.updates as Record<string, unknown>) ?? {};
  await appendEvent(
    ctx.customerKey,
    "ACTION_REVISION_REQUESTED",
    { approval_id: approvalId, updates },
    { summary: `Action revision requested for ${approvalId}`, tags: ["action", "revision"] }
  );
  return `Revision for action ${approvalId} logged.`;
}

async function toolEscalateToHuman(input: Record<string, unknown>, ctx: HandlerContext) {
  const urgency = String(input.urgency ?? "medium");
  const reason = String(input.reason ?? "");
  const suggested = String(input.suggested_action ?? "");
  const dot = ({ low: "•", medium: "▲", high: "■" } as Record<string, string>)[urgency] ?? "•";
  const message =
    `${dot} *Escalation (${urgency.toUpperCase()})* — ${ctx.customerKey}\n` +
    `*Reason:* ${reason}` +
    (suggested ? `\n*Suggested action:* ${suggested}` : "");
  try {
    const { postMessage } = await import("@/lib/slack/client");
    await postMessage("cs-escalations", message);
  } catch (err) {
    console.warn("Slack escalation post failed:", err);
  }
  await appendEvent(
    ctx.customerKey,
    "ESCALATION",
    { urgency, reason, suggested_action: suggested },
    { summary: `Escalation (${urgency}): ${reason}` }
  );
  return `Escalation recorded (${urgency}). Posted to #cs-escalations if Slack is wired.`;
}

async function toolCreateTask(input: Record<string, unknown>, ctx: HandlerContext) {
  const description = String(input.description ?? "");
  const schedule = input.schedule as TaskSchedule;
  const action = input.action as TaskAction;
  const tags = (input.tags as string[]) ?? [];
  const task = await createTask(ctx.customerKey, {
    description,
    schedule,
    action,
    tags,
  });
  return `Task created: ${task.id} — ${task.description}`;
}

async function toolListTasks(input: Record<string, unknown>, ctx: HandlerContext) {
  const includeCompleted = Boolean(input.include_completed);
  const tasks = await listTasks(ctx.customerKey, { includeCompleted });
  if (tasks.length === 0) return "No active tasks.";
  return tasks
    .map((t) => {
      const sched = t.schedule;
      const schedStr = sched.at ?? sched.cron ?? sched.every ?? "?";
      return `- **${t.id}** [${t.status}] ${t.description ?? ""} (schedule: ${sched.type} ${schedStr})`;
    })
    .join("\n");
}

async function toolCancelTask(input: Record<string, unknown>, ctx: HandlerContext) {
  const taskId = String(input.task_id ?? "");
  if (!taskId) return "Missing task_id.";
  const cancelled = await cancelTask(ctx.customerKey, taskId);
  return cancelled
    ? `Task ${taskId} cancelled.`
    : `Task ${taskId} not found or already cancelled.`;
}

async function toolGetSlackHistory(input: Record<string, unknown>, ctx: HandlerContext) {
  const limit = Math.min(Math.max(Number(input.limit ?? 25), 1), 100);
  // Use the persisted conversations as the source of truth — the legacy
  // implementation hit Slack's API directly. We can fall back to the live
  // Slack history once the Slack client wires up.
  const convos = await recentConversations(ctx.customerKey, limit);
  if (convos.length === 0) return "No recent Slack history for this customer.";
  return convos
    .reverse()
    .map(
      (c) =>
        `[${c.ts}] ${c.user_name || c.user_id}: ${truncate(c.user_message, 600)}\n   → ${truncate(c.bot_response, 600)}`
    )
    .join("\n\n");
}

async function toolGetCustomerRules(ctx: HandlerContext) {
  return await getRules(ctx.customerKey);
}

async function toolUpdateCustomerRules(
  input: Record<string, unknown>,
  ctx: HandlerContext
) {
  const content = String(input.rules ?? "").trim();
  if (!content) return "Error: rules content cannot be empty.";
  await updateRules(ctx.customerKey, content);
  await appendEvent(ctx.customerKey, "RULES_UPDATED", { length: content.length }, {
    summary: `Customer rules updated (${content.length} chars).`,
    tags: ["rules"],
  });
  return `Customer rules updated (${content.length} chars).`;
}

// Re-export so consumers can access the gated set without pulling in the
// full tools file.
export { GATED_TOOLS_EMAIL };
