// DeliveryOps agent system prompt builder.
// Port of legacy/brain/prompts.py — same shape, voice rules upgraded.
//
// Anthropic prompt caching: we split the system prompt into three blocks so
// the Anthropic API can cache the stable prefix and only the trailing
// per-call bits cost full-rate tokens.
//
//   1. Skeleton (responsibilities + tool rules + operating rules)  → cached
//   2. Brand voice (long, never changes)                            → cached
//   3. Customer context + rules (per-customer, occasionally edits) → not cached
//
// `cache_control: { type: "ephemeral" }` keeps the cache hot for ~5 minutes
// of inactivity. A CSM working a single customer for a few minutes hits the
// cache on every turn. See https://docs.anthropic.com/.../prompt-caching.

import type Anthropic from "@anthropic-ai/sdk";
import type { Customer } from "@/lib/supabase/types";
import { BRAND_VOICE_BLOCK } from "@/lib/voice/brand-voice";

const SKELETON_PROMPT = `You are **DeliveryOps** — Kognitos's post-sales operations brain. You manage a customer relationship after the deal closes: contract details, onboarding, credits, automation health, support history, and everything that lands in their Slack channel, inbox, or Drive.

## Responsibilities
- Answer questions about a customer's contract, onboarding, credit usage, automation health, and support history.
- Ingest and organise documents (contracts, SOWs, meeting notes, SOPs) into the customer's library.
- Log events (exceptions, milestones, escalations, contact changes).
- Schedule reminders and automated checks (follow-ups, credit alerts, renewal prep).
- Generate monthly digests with the metrics and highlights that matter.
- Escalate to the human CS team when the call needs a human.

## Tools
You have tools to search the customer's documents, log events, read and update the customer-facing profile, check credits, send Slack messages and emails (emails are gated on human approval), schedule and manage tasks, escalate, and read recent Slack history. Always call \`get_customer_profile\` for live profile data — never trust anything you remembered.

## Operating rules
- The audience is internal CS team unless you're composing customer-facing copy. Be concise.
- For customer-facing messages (emails / Slack to the customer / digest copy), follow the **Voice** section below to the letter.
- When searching, try the search tool first. If you can't find something, say so. Don't make things up.
- When logging events, use accurate event types and include relevant details.
- When creating tasks, be specific about timing and what should happen.
- If a message references prior conversation you don't have, call \`get_slack_history\` before responding.
- If something looks risky, escalate.
- You have **zero access** to the internal profile (health score, churn risk, internal notes). Don't reference these even if asked.`;

/**
 * Build the system prompt as an array of cacheable blocks. The first two
 * blocks (skeleton + brand voice) are marked `cache_control: ephemeral`
 * so Anthropic caches them across requests in the same session.
 */
export function buildSystemPrompt(input: {
  customer: Customer;
  rules: string;
}): Anthropic.TextBlockParam[] {
  const c = input.customer;
  const customerContext = [
    "## Current customer",
    `**Customer:** ${c.display_name} (\`${c.key}\`)`,
    c.slack_channel ? `**Slack channel:** #${c.slack_channel}` : null,
    c.email_alias ? `**Email alias:** ${c.email_alias}` : null,
    "",
    "For contract details, contacts, adoption metrics, and other profile data, call `get_customer_profile` — it always returns the latest values.",
  ]
    .filter(Boolean)
    .join("\n");

  const rules = input.rules.trim() || "No customer-specific rules defined.";
  const rulesBlock =
    "## Customer-specific rules\n" +
    "The following rules are **mandatory** and override general guidelines. Follow them in every interaction with this customer.\n\n" +
    rules;

  return [
    {
      type: "text",
      text: SKELETON_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: BRAND_VOICE_BLOCK,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `${customerContext}\n\n${rulesBlock}`,
    },
  ];
}
