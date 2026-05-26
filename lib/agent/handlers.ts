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
import { loadCustomerEnrichment } from "@/lib/cache/integrations";
import {
  formatPersonName,
  formatPeopleList,
  isDelivered as txIsDelivered,
} from "@/lib/delivery/taxonomy";

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
  // Email-sourced calls to mutating tools get queued for human approval
  // in Slack rather than executed inline. Approval cards live in
  // pending_approvals + are rendered into the customer's internal Slack
  // channel by lib/approvals/flow.ts. `source: "approved"` bypasses this
  // gate so the interactive handler can execute on approve.
  if (ctx.source === "email" && GATED_TOOLS_EMAIL.has(toolName)) {
    const { queueGatedAction } = await import("@/lib/approvals/flow");
    const approval = await queueGatedAction({
      customerKey: ctx.customerKey,
      toolName,
      toolInput,
    });
    return `Action queued for approval in Slack (\`${approval.id}\`). Reply in the thread under the card to revise; click Approve to execute.`;
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
    case "list_customer_projects":
      return await toolListCustomerProjects(toolInput, ctx);
    case "list_customer_nps":
      return await toolListCustomerNps(toolInput, ctx);
    case "list_customer_opportunities":
      return await toolListCustomerOpportunities(toolInput, ctx);
    case "list_customer_cases":
      return await toolListCustomerCases(toolInput, ctx);
    case "list_customer_activities":
      return await toolListCustomerActivities(toolInput, ctx);
    case "list_customer_events":
      return await toolListCustomerEvents(toolInput, ctx);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ─── tool implementations ────────────────────────────────────────────────────

async function toolSearchCustomerDocs(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  // Keyword search over (a) the DOCUMENT_INGESTED event metadata and
  // (b) the ingested markdown content stored in Supabase Storage. Returns
  // up to 5 matches with a short snippet around each hit. Vector search
  // upgrade (pgvector + Claude embeddings) lands in Stage 4.
  const query = String(input.query ?? "").trim().toLowerCase();
  if (!query) return "Empty query.";
  const scope = String(input.scope ?? "all");

  const events = await listEvents(ctx.customerKey, {
    eventType: "DOCUMENT_INGESTED",
    limit: 200,
  });

  type Details = {
    package_id?: string;
    category?: string;
    filename?: string;
    organized_path?: string;
    original_doc_path?: string;
  };

  // Filter to in-scope categories first.
  let candidates = events.filter((e) => {
    const d = (e.details ?? {}) as Details;
    if (scope === "all") return true;
    return d.category === scope;
  });

  // Quick metadata pre-filter — keep events whose filename / summary /
  // category match the query verbatim. We always also scan content below.
  const fastHits = candidates.filter(
    (e) =>
      e.summary.toLowerCase().includes(query) ||
      JSON.stringify(e.details ?? {}).toLowerCase().includes(query)
  );

  // Content search: download each candidate's content.md (up to 30) and
  // grep for the query. This is bounded by event count + storage download
  // latency; we cap aggressively.
  const { downloadText } = await import("@/lib/ingestion/storage");
  const contentSearchCap = 30;
  candidates = candidates.slice(0, contentSearchCap);

  const contentMatches: Array<{ summary: string; path: string; snippet: string }> = [];
  await Promise.all(
    candidates.map(async (e) => {
      const d = (e.details ?? {}) as Details;
      if (!d.package_id) return;
      const contentPath = `${ctx.customerKey}/${d.package_id}/content.md`;
      try {
        const text = await downloadText(contentPath);
        const idx = text.toLowerCase().indexOf(query);
        if (idx < 0) return;
        const start = Math.max(0, idx - 80);
        const end = Math.min(text.length, idx + 180);
        contentMatches.push({
          summary: e.summary,
          path: d.original_doc_path ?? contentPath,
          snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
        });
      } catch {
        /* skip; doc may be missing or unreadable */
      }
    })
  );

  if (fastHits.length === 0 && contentMatches.length === 0) {
    return `No ingested documents matched "${query}"${scope !== "all" ? ` (scope: ${scope})` : ""}.`;
  }

  const out: string[] = [];
  if (contentMatches.length > 0) {
    out.push(`Content matches (${contentMatches.length}):`);
    for (const m of contentMatches.slice(0, 5)) {
      out.push(`- ${m.summary}\n  ${m.path}\n  …${m.snippet}…`);
    }
  }
  if (fastHits.length > 0) {
    const onlyMeta = fastHits.filter(
      (e) => !contentMatches.some((m) => m.summary === e.summary)
    );
    if (onlyMeta.length > 0) {
      out.push(`Metadata matches (${onlyMeta.length}):`);
      for (const e of onlyMeta.slice(0, 5)) {
        const d = (e.details ?? {}) as Details;
        out.push(`- ${e.summary}${d.category ? ` [${d.category}]` : ""} → ${d.original_doc_path ?? "(unknown path)"}`);
      }
    }
  }
  return out.join("\n");
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
  // Pull from the k2_runs cache (synced daily) — total runs, state mix,
  // and aggregate duration this month. Fall back to the profile MTD
  // counter when no K2 workspace is wired to this customer.
  const customer = await requireCustomerByKey(ctx.customerKey);
  const profile = await getProfile(ctx.customerKey);

  if (!customer.kognitos_v2_workspace_id) {
    return JSON.stringify(
      {
        source: "profile (no K2 workspace linked)",
        credit_limit: profile.credit_limit,
        credits_used_mtd: profile.credits_used_mtd,
        remaining: Math.max(profile.credit_limit - profile.credits_used_mtd, 0),
        utilisation:
          profile.credit_limit > 0
            ? `${((profile.credits_used_mtd / profile.credit_limit) * 100).toFixed(1)}%`
            : "n/a",
        note:
          "No K2 v2 workspace is linked to this customer (customers.kognitos_v2_workspace_id is null). Numbers come from the profile MTD counter.",
      },
      null,
      2
    );
  }

  const { requireAdmin } = await import("@/lib/supabase/server");
  const sb = requireAdmin();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: rows, error } = await sb
    .from("k2_runs")
    .select("state, duration_ms, started_at")
    .eq("customer_id", customer.id)
    .gte("started_at", monthStart.toISOString());
  if (error) {
    return `Error reading k2_runs: ${error.message}`;
  }

  const tally = { total: 0, completed: 0, failed: 0, awaiting_guidance: 0, running: 0, stopped: 0, other: 0 };
  let totalDurationMs = 0;
  for (const r of (rows ?? []) as Array<{ state: string | null; duration_ms: number | null }>) {
    tally.total++;
    totalDurationMs += r.duration_ms ?? 0;
    const key = ((r.state ?? "other").toLowerCase() as keyof typeof tally);
    if (key in tally) tally[key]++;
    else tally.other++;
  }
  const successRate = tally.total > 0 ? ((tally.completed / tally.total) * 100).toFixed(1) + "%" : "n/a";
  const avgDurationSec = tally.total > 0 ? Math.round(totalDurationMs / tally.total / 1000) : 0;

  return JSON.stringify(
    {
      source: "k2_runs cache",
      month: monthStart.toISOString().slice(0, 7),
      runs_mtd: tally,
      success_rate: successRate,
      avg_duration_seconds: avgDurationSec,
      contract_credit_limit: profile.credit_limit,
      profile_credits_used_mtd: profile.credits_used_mtd,
      note:
        "Counts come from the cached Kognitos v2 run history (refreshed daily at 02:30 UTC by /api/cron/daily-sync).",
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
  await postMessage(channel, String(input.message ?? ""), { customerKey: ctx.customerKey });
  return `Message sent to #${channel}.`;
}

async function toolSendEmail(input: Record<string, unknown>, ctx: HandlerContext) {
  const to = (input.to as string[]) ?? [];
  const subject = String(input.subject ?? "");
  const body = String(input.body ?? "");

  // `source: "approved"` flows through executeEmailApproval in
  // lib/approvals/flow.ts — the FDE already clicked "Approve & send" on
  // the Slack card. Send directly via Gmail and skip the approval card.
  if (ctx.source === "approved") {
    const customer = await requireCustomerByKey(ctx.customerKey);
    const fromAddr = customer.email_alias ?? `${customer.key}@kognitos.com`;
    const { sendEmail } = await import("@/lib/integrations/google/gmail");
    const result = await sendEmail({
      fromAddr,
      to,
      subject,
      bodyMarkdown: body,
      customerKey: ctx.customerKey,
    });
    await appendEvent(
      ctx.customerKey,
      "EMAIL_SENT",
      { to, subject, body: truncate(body, 4000), message_id: result.id },
      { summary: `Email sent → ${to.join(", ")}: ${subject}`, tags: ["email", "outbound"] }
    );
    return `Email sent (id ${result.id}). To ${to.join(", ")} — subject "${subject}".`;
  }

  // Default path (web / slack / email sources): queue for Slack approval.
  // The FDE sees a Block Kit card with the draft and clicks Approve / Reject / Discuss.
  const { queueEmailDraft } = await import("@/lib/approvals/flow");
  const approval = await queueEmailDraft({
    customerKey: ctx.customerKey,
    to,
    subject,
    body,
    inReplyTo: typeof input.inReplyTo === "string" ? input.inReplyTo : undefined,
    references: typeof input.references === "string" ? input.references : undefined,
    gmailThreadId: typeof input.gmailThreadId === "string" ? input.gmailThreadId : undefined,
  });
  return `Email draft queued for approval (\`${approval.id}\`). The FDE team sees a preview in the customer's internal Slack channel and can approve, reject, or revise it in thread.`;
}

async function toolReviseEmailDraft(
  input: Record<string, unknown>,
  ctx: HandlerContext
) {
  const approvalId = String(input.approval_id ?? "");
  if (!approvalId) return "Missing approval_id.";

  // Build the patch from any provided fields. Only changed fields land in
  // the revision record; the others stay as-is.
  const patch: Record<string, unknown> = {};
  if (typeof input.to !== "undefined") patch.to = input.to;
  if (typeof input.subject === "string") patch.subject = input.subject;
  if (typeof input.body === "string") patch.body = input.body;

  // add_attachments / remove_attachments aren't surfaced in the schema yet,
  // but we accept them so callers can hint at intent — they go in the
  // revision history for future hooks.
  if (typeof input.add_attachments !== "undefined") patch.add_attachments = input.add_attachments;
  if (typeof input.remove_attachments !== "undefined") patch.remove_attachments = input.remove_attachments;

  if (Object.keys(patch).length === 0) {
    return `No revisions provided for ${approvalId}.`;
  }

  const { applyRevision } = await import("@/lib/approvals/store");
  const { postMessage } = await import("@/lib/slack/client");
  const { buildEmailDraftCard } = await import("@/lib/approvals/slack-cards");

  const revised = await applyRevision(approvalId, patch, "agent", "agent_revise");
  if (!revised) return `Approval ${approvalId} not found.`;

  // Re-post an updated card in the same thread so the FDE can re-approve.
  if (revised.slack_channel && revised.slack_thread_ts) {
    try {
      await postMessage(revised.slack_channel, `Email draft revised — re-review.`, {
        blocks: buildEmailDraftCard(revised),
        thread_ts: revised.slack_thread_ts,
        customerKey: ctx.customerKey,
      });
    } catch (err) {
      console.warn("[handlers] revise_email re-post failed:", err);
    }
  }

  await appendEvent(
    ctx.customerKey,
    "EMAIL_DRAFT_REVISED",
    { approval_id: approvalId, patch },
    { summary: `Email draft revised: ${approvalId}`, tags: ["email", "revision"] }
  );
  return `Email draft ${approvalId} revised. Updated card posted for re-approval.`;
}

async function toolRevisePendingAction(
  input: Record<string, unknown>,
  ctx: HandlerContext
) {
  const approvalId = String(input.approval_id ?? "");
  if (!approvalId) return "Missing approval_id.";
  const updates = (input.updates as Record<string, unknown>) ?? {};
  if (Object.keys(updates).length === 0) {
    return `No updates provided for ${approvalId}.`;
  }

  const { applyRevision } = await import("@/lib/approvals/store");
  const { postMessage } = await import("@/lib/slack/client");
  const { buildActionApprovalCard } = await import("@/lib/approvals/slack-cards");

  const revised = await applyRevision(approvalId, updates, "agent", "agent_revise");
  if (!revised) return `Approval ${approvalId} not found.`;

  if (revised.slack_channel && revised.slack_thread_ts) {
    try {
      await postMessage(revised.slack_channel, `Action revised — re-review.`, {
        blocks: buildActionApprovalCard(revised),
        thread_ts: revised.slack_thread_ts,
        customerKey: ctx.customerKey,
      });
    } catch (err) {
      console.warn("[handlers] revise_action re-post failed:", err);
    }
  }

  await appendEvent(
    ctx.customerKey,
    "ACTION_REVISED",
    { approval_id: approvalId, updates },
    { summary: `Pending action revised: ${approvalId}`, tags: ["action", "revision"] }
  );
  return `Action ${approvalId} revised. Updated card posted for re-approval.`;
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
    await postMessage("cs-escalations", message, { customerKey: ctx.customerKey });
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

// ─── Read-only views into the rest of DeliveryOps's customer data ───────────
//
// Each tool below reads the per-customer enrichment cache that the customer
// page already uses (Monday projects + activities + NPS, Salesforce opps +
// cases).  Result strings are kept under ~3000 chars so they fit comfortably
// in the tool-result window.

async function toolListCustomerProjects(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  const includeDelivered = input.include_delivered !== false; // default true
  const limit = clamp(Number(input.limit ?? 25), 1, 100);
  const customer = await requireCustomerByKey(ctx.customerKey);
  const enrichment = await loadCustomerEnrichment(customer.id);
  let projects = enrichment.projects;
  if (!includeDelivered) {
    projects = projects.filter((p) => !txIsDelivered(p.project_status, p.group_title));
  }
  if (projects.length === 0) return "No projects on file.";

  const lines = projects.slice(0, limit).map((p) => {
    const fde = formatPeopleList(p.fde) || "(no FDE)";
    const parts = [
      p.project_status ?? "—",
      p.current_phase ?? "—",
      p.health ?? null,
      p.dev_platform ?? null,
      p.fiscal_year ?? null,
    ].filter(Boolean);
    const dates = [
      p.kickoff_date ? `kickoff ${p.kickoff_date}` : null,
      p.go_live_date ? `go-live ${p.go_live_date}` : null,
    ].filter(Boolean);
    const update = p.latest_update ? `\n   update: ${truncate(p.latest_update, 200)}` : "";
    return `- ${p.name}\n   ${parts.join(" · ")}\n   FDE: ${fde}${dates.length ? `\n   ${dates.join(" · ")}` : ""}${update}`;
  });
  const more = projects.length > limit ? `\n… ${projects.length - limit} more not shown.` : "";
  return `${projects.length} project${projects.length === 1 ? "" : "s"}.\n${lines.join("\n")}${more}`;
}

async function toolListCustomerNps(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  const limit = clamp(Number(input.limit ?? 10), 1, 50);
  const customer = await requireCustomerByKey(ctx.customerKey);
  const enrichment = await loadCustomerEnrichment(customer.id);
  if (enrichment.nps.length === 0) return "No NPS responses on file.";
  const lines = enrichment.nps.slice(0, limit).map(
    (n) =>
      `- ${n.respondent ?? "?"} · ${n.score ?? "—"} (${n.category ?? "—"})${n.quarter ? ` · ${n.quarter}` : ""}${n.response_date ? ` · ${n.response_date}` : ""}${n.feedback ? `\n   "${truncate(n.feedback, 240)}"` : ""}`
  );
  return `${enrichment.nps.length} response${enrichment.nps.length === 1 ? "" : "s"}.\n${lines.join("\n")}`;
}

async function toolListCustomerOpportunities(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  const includeClosed = input.include_closed === true;
  const customer = await requireCustomerByKey(ctx.customerKey);
  const enrichment = await loadCustomerEnrichment(customer.id);
  const opps = enrichment.opportunities.filter((o) => includeClosed || !o.is_closed);
  if (opps.length === 0) return includeClosed ? "No opportunities on file." : "No open opportunities.";
  const lines = opps.slice(0, 25).map(
    (o) =>
      `- ${o.name ?? "(unnamed)"} · ${o.stage_name ?? "—"} · ${o.amount != null ? `$${o.amount.toLocaleString()}` : "—"}${o.close_date ? ` · closes ${o.close_date}` : ""}${o.probability != null ? ` · ${o.probability}%` : ""}${o.owner_name ? ` · AE ${formatPersonName(o.owner_name)}` : ""}`
  );
  return `${opps.length} ${includeClosed ? "" : "open "}opportunit${opps.length === 1 ? "y" : "ies"}.\n${lines.join("\n")}`;
}

async function toolListCustomerCases(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  const includeClosed = input.include_closed === true;
  const customer = await requireCustomerByKey(ctx.customerKey);
  const enrichment = await loadCustomerEnrichment(customer.id);
  const cases = enrichment.cases.filter((c) => includeClosed || !c.is_closed);
  if (cases.length === 0) return includeClosed ? "No cases on file." : "No open cases.";
  const lines = cases.slice(0, 25).map(
    (c) =>
      `- ${c.case_number ?? "?"} · ${truncate(c.subject ?? "—", 120)} · ${c.status ?? "—"}${c.priority ? ` · ${c.priority}` : ""}${c.origin ? ` · ${c.origin}` : ""}`
  );
  return `${cases.length} ${includeClosed ? "" : "open "}case${cases.length === 1 ? "" : "s"}.\n${lines.join("\n")}`;
}

async function toolListCustomerActivities(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  const includeResolved = input.include_resolved === true;
  const limit = clamp(Number(input.limit ?? 20), 1, 50);
  const customer = await requireCustomerByKey(ctx.customerKey);
  const enrichment = await loadCustomerEnrichment(customer.id);
  const activities = enrichment.activities.filter((a) => {
    if (includeResolved) return true;
    const status = (a.status ?? "").toLowerCase();
    return status !== "closed" && status !== "resolved" && !a.resolved_date;
  });
  if (activities.length === 0) return includeResolved ? "No activities on file." : "No open activities.";
  const lines = activities.slice(0, limit).map((a) => {
    const meta = [
      a.status ?? null,
      a.priority ?? null,
      a.due_date ? `due ${a.due_date}` : null,
    ].filter(Boolean);
    const summary = a.ai_summary ? `\n   ${truncate(a.ai_summary, 200)}` : "";
    return `- ${a.name}${meta.length ? `\n   ${meta.join(" · ")}` : ""}${summary}`;
  });
  const more = activities.length > limit ? `\n… ${activities.length - limit} more not shown.` : "";
  return `${activities.length} activit${activities.length === 1 ? "y" : "ies"}.\n${lines.join("\n")}${more}`;
}

async function toolListCustomerEvents(
  input: Record<string, unknown>,
  ctx: HandlerContext
): Promise<string> {
  const eventType = typeof input.event_type === "string" ? input.event_type : undefined;
  const days = clamp(Number(input.days ?? 30), 1, 365);
  const limit = clamp(Number(input.limit ?? 20), 1, 100);
  // listEvents doesn't have a "since" option, so we overfetch and filter by
  // timestamp in JS.  Cap the fetch at 500 (the loader's max) — far past
  // any practical limit for a single customer event timeline.
  const cutoff = Date.now() - days * 86_400_000;
  const fetched = await listEvents(ctx.customerKey, { eventType, limit: 500 });
  const events = fetched
    .filter((e) => new Date(e.ts).getTime() >= cutoff)
    .slice(0, limit);
  if (events.length === 0) {
    return `No events in the last ${days} day${days === 1 ? "" : "s"}.`;
  }
  const lines = events.map(
    (e) => `- ${e.ts.slice(0, 16).replace("T", " ")} · ${e.event_type} · ${truncate(e.summary, 160)}`
  );
  return `${events.length} event${events.length === 1 ? "" : "s"} (last ${days}d).\n${lines.join("\n")}`;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// Re-export so consumers can access the gated set without pulling in the
// full tools file.
export { GATED_TOOLS_EMAIL };
