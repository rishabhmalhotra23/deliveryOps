// Operations agent — a portfolio-scoped Claude that talks to the whole
// customer book at once, runs natural-language commands like "Owen left,
// reassign his actives to Binny", and reports back.
//
// Distinct from the per-customer agent in lib/agent/runner.ts: that one
// reasons about a single customer's profile/events/tasks; this one
// reasons across all customers and uses bulk-update tools.

import Anthropic from "@anthropic-ai/sdk";

import {
  bulkUpdateCustomerField,
  findCustomers,
  type CustomerFilter,
} from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import { BRAND_VOICE_BLOCK } from "@/lib/voice/brand-voice";
import { CUSTOMER_CATEGORIES } from "@/lib/supabase/types";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 12;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Missing ANTHROPIC_API_KEY.");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_customers",
    description:
      "Find customers across the whole portfolio. Filters AND together. Returns up to 200 rows. Use this before bulk-updating so you can confirm the scope.",
    input_schema: {
      type: "object",
      properties: {
        ae_owner: { type: "string", description: "Exact match on AE name. Case-sensitive." },
        custom_category: {
          type: "string",
          description: `One of: ${CUSTOMER_CATEGORIES.join(", ")}, or any custom value the team has minted.`,
        },
        custom_category_in: { type: "array", items: { type: "string" } },
        partner: { type: "string" },
        lifecycle_group: { type: "string" },
        exclude_categories: { type: "array", items: { type: "string" } },
        has_salesforce: { type: "boolean" },
        search: { type: "string", description: "Substring match across name + key + ae_owner." },
      },
    },
  },
  {
    name: "update_customer_owner",
    description:
      "Reassign one or many customers to a new AE. Locks ae_owner so the next sync won't overwrite it. Always describe the change in your final reply.",
    input_schema: {
      type: "object",
      properties: {
        customer_keys: { type: "array", items: { type: "string" } },
        new_owner: { type: "string", description: "AE name. Use existing names exactly when matching." },
        reason: { type: "string", description: "Short note recorded against each customer's event log." },
      },
      required: ["customer_keys", "new_owner"],
    },
  },
  {
    name: "update_customer_category",
    description:
      "Move one or many customers to a different DeliveryOps category. Use this when the team's lifecycle bucket no longer matches reality. Locks custom_category against sync.",
    input_schema: {
      type: "object",
      properties: {
        customer_keys: { type: "array", items: { type: "string" } },
        new_category: {
          type: "string",
          description: `Target category. Standard buckets: ${CUSTOMER_CATEGORIES.join(", ")}. You can mint a new bucket — it'll appear in the dashboard automatically.`,
        },
        reason: { type: "string" },
      },
      required: ["customer_keys", "new_category"],
    },
  },
  {
    name: "update_customer_partner",
    description: "Set or change the partner agency for one or many customers (My Paradigm, Wipro BPS, QBotica, Indium, etc.).",
    input_schema: {
      type: "object",
      properties: {
        customer_keys: { type: "array", items: { type: "string" } },
        new_partner: { type: "string", description: "Empty string clears the partner." },
        reason: { type: "string" },
      },
      required: ["customer_keys", "new_partner"],
    },
  },
  {
    name: "summarize_portfolio",
    description: "Aggregate stats across the whole book — counts by AE, category, partner, plus cached SF totals.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

export type AgentSource = "operations";

interface OperationsContext {
  source: AgentSource;
}

async function executeTool(name: string, input: Record<string, unknown>, _ctx: OperationsContext): Promise<string> {
  switch (name) {
    case "find_customers":
      return findCustomersTool(input);
    case "update_customer_owner":
      return updateOwnerTool(input);
    case "update_customer_category":
      return updateCategoryTool(input);
    case "update_customer_partner":
      return updatePartnerTool(input);
    case "summarize_portfolio":
      return summarizePortfolioTool();
    default:
      return `Unknown tool: ${name}`;
  }
}

async function findCustomersTool(input: Record<string, unknown>): Promise<string> {
  const filter: CustomerFilter = {
    ae_owner: stringOrUndefined(input.ae_owner),
    partner: stringOrUndefined(input.partner),
    custom_category: stringOrUndefined(input.custom_category),
    custom_category_in: stringArrayOrUndefined(input.custom_category_in),
    lifecycle_group: stringOrUndefined(input.lifecycle_group),
    exclude_categories: stringArrayOrUndefined(input.exclude_categories),
    has_salesforce: typeof input.has_salesforce === "boolean" ? input.has_salesforce : undefined,
    search: stringOrUndefined(input.search),
  };
  const rows = await findCustomers(filter);
  if (rows.length === 0) return "No customers matched.";
  const summary = `${rows.length} customer${rows.length === 1 ? "" : "s"}.`;
  const lines = rows
    .slice(0, 100)
    .map(
      (r) =>
        `- ${r.display_name} (${r.key}) · category=${r.custom_category ?? "—"} · ae=${r.ae_owner ?? "—"} · partner=${r.partner ?? "—"} · lifecycle=${r.lifecycle_group ?? "—"}`
    );
  if (rows.length > 100) lines.push(`… ${rows.length - 100} more not shown.`);
  return `${summary}\n${lines.join("\n")}`;
}

async function updateOwnerTool(input: Record<string, unknown>): Promise<string> {
  const keys = stringArrayOrThrow(input.customer_keys, "customer_keys");
  const newOwner = stringOrThrow(input.new_owner, "new_owner");
  const reason = stringOrUndefined(input.reason);

  if (keys.length === 0) return "No customer_keys provided — nothing to update.";

  const before = await findCustomers({ search: undefined }).then((all) =>
    new Map(all.map((c) => [c.key, c.ae_owner ?? null]))
  );

  const updated = await bulkUpdateCustomerField(keys, "ae_owner", newOwner);

  const lines: string[] = [];
  for (const c of updated) {
    const prev = before.get(c.key) ?? "(none)";
    lines.push(`- ${c.display_name}: ${prev} → ${newOwner}`);
    try {
      await appendEvent(
        c.key,
        "OWNER_CHANGED",
        { from: prev, to: newOwner, reason: reason ?? null, source: "operations-chat" },
        { summary: `AE changed: ${prev} → ${newOwner}`, tags: ["ownership", "operations"] }
      );
    } catch {
      /* event logging is best-effort */
    }
  }

  return `Reassigned ${updated.length} customer${updated.length === 1 ? "" : "s"} to ${newOwner}${reason ? ` (${reason})` : ""}.\n${lines.join("\n")}`;
}

async function updateCategoryTool(input: Record<string, unknown>): Promise<string> {
  const keys = stringArrayOrThrow(input.customer_keys, "customer_keys");
  const newCategory = stringOrThrow(input.new_category, "new_category");
  const reason = stringOrUndefined(input.reason);

  if (keys.length === 0) return "No customer_keys provided — nothing to update.";

  const before = await findCustomers({}).then((all) =>
    new Map(all.map((c) => [c.key, c.custom_category ?? null]))
  );

  const updated = await bulkUpdateCustomerField(keys, "custom_category", newCategory);

  const lines: string[] = [];
  for (const c of updated) {
    const prev = before.get(c.key) ?? "(none)";
    lines.push(`- ${c.display_name}: ${prev} → ${newCategory}`);
    try {
      await appendEvent(
        c.key,
        "CATEGORY_CHANGED",
        { from: prev, to: newCategory, reason: reason ?? null, source: "operations-chat" },
        { summary: `Category changed: ${prev} → ${newCategory}`, tags: ["category", "operations"] }
      );
    } catch {
      /* */
    }
  }

  return `Recategorised ${updated.length} customer${updated.length === 1 ? "" : "s"} as "${newCategory}"${reason ? ` (${reason})` : ""}.\n${lines.join("\n")}`;
}

async function updatePartnerTool(input: Record<string, unknown>): Promise<string> {
  const keys = stringArrayOrThrow(input.customer_keys, "customer_keys");
  const newPartner = stringOrThrow(input.new_partner, "new_partner");

  const value = newPartner.trim() || null;
  const before = await findCustomers({}).then((all) =>
    new Map(all.map((c) => [c.key, c.partner ?? null]))
  );

  const updated = await bulkUpdateCustomerField(keys, "partner", value);
  const lines = updated.map(
    (c) => `- ${c.display_name}: ${before.get(c.key) ?? "(none)"} → ${value ?? "(none)"}`
  );
  return `Updated partner on ${updated.length} customer${updated.length === 1 ? "" : "s"}.\n${lines.join("\n")}`;
}

async function summarizePortfolioTool(): Promise<string> {
  const all = await findCustomers({});
  const byAe = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byPartner = new Map<string, number>();
  for (const c of all) {
    const ae = c.ae_owner ?? "(unassigned)";
    const cat = c.custom_category ?? "(none)";
    const partner = c.partner ?? "(direct)";
    byAe.set(ae, (byAe.get(ae) ?? 0) + 1);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    byPartner.set(partner, (byPartner.get(partner) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");
  return [
    `Portfolio: ${all.length} customers.`,
    "",
    `By AE:\n${fmt(byAe)}`,
    "",
    `By category:\n${fmt(byCategory)}`,
    "",
    `By partner:\n${fmt(byPartner)}`,
  ].join("\n");
}

// ─── arg coercion ────────────────────────────────────────────────────────

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function stringOrThrow(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required.`);
  return v.trim();
}
function stringArrayOrUndefined(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const cleaned = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
  return cleaned.length ? cleaned : undefined;
}
function stringArrayOrThrow(v: unknown, name: string): string[] {
  const out = stringArrayOrUndefined(v);
  if (!out) throw new Error(`${name} must be a non-empty string array.`);
  return out;
}

// ─── system prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are the **DeliveryOps Operations Agent** — the portfolio-wide brain for Kognitos's post-sales team. You operate across all customers at once, not per-customer.

## What you do
- Answer questions about the whole book ("how many customers does Owen own?", "which renewals are due this quarter?").
- Reassign ownership when AEs leave / change roles.
- Recategorise customers when their lifecycle bucket no longer matches reality.
- Update partner assignments.
- Summarise portfolio state for the team.

## How you work
1. **Find before you change.** When the user asks for a bulk operation, always call \`find_customers\` first to confirm the scope and report the count + names back.
2. **Describe what you're about to do** in your final text reply, even when the operation succeeds. The team needs to be able to undo confidently.
3. **Source-of-truth rule.** When you change a field via your tools, that field is locked from sync overwrites. Be deliberate.
4. **Don't fabricate categories.** Use existing categories unless the user explicitly says to mint a new one. The standard set is: At Risk, Upcoming Renewals, Strategic Growth, Active, Partner Managed, POV, Churned.
5. **Don't touch churned customers** unless explicitly asked. They're frozen for retro/win-loss analysis.
6. **One question at a time.** If a request is ambiguous (e.g. "rename Owen's accounts to Binny" — which Owen's accounts? all? actives only?), ask once, then proceed.

${BRAND_VOICE_BLOCK}
`;
}

// ─── streaming runner ────────────────────────────────────────────────────

export type OpsStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool_name: string; tool_input: unknown }
  | { type: "tool_result"; tool_name: string; content: string }
  | { type: "done"; full_text: string }
  | { type: "error"; content: string };

export async function* streamOperationsAgent(opts: {
  userMessage: string;
  history?: Anthropic.MessageParam[];
}): AsyncGenerator<OpsStreamEvent, void, void> {
  const messages: Anthropic.MessageParam[] = [
    ...(opts.history ?? []),
    { role: "user", content: opts.userMessage },
  ];
  const system = buildSystemPrompt();
  let fullText = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOLS,
      messages,
    });

    const textChunks: string[] = [];
    let textBuffer = "";
    stream.on("text", (text) => {
      textBuffer += text;
      textChunks.push(text);
    });

    let finalMessage: Anthropic.Message;
    try {
      finalMessage = await stream.finalMessage();
    } catch (err) {
      yield { type: "error", content: err instanceof Error ? err.message : String(err) };
      return;
    }

    for (const chunk of textChunks) {
      fullText += chunk;
      yield { type: "text", content: chunk };
    }

    const toolBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolBlocks.length === 0) {
      yield { type: "done", full_text: fullText };
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolBlocks) {
      yield { type: "tool_use", tool_name: block.name, tool_input: block.input };
      let result: string;
      try {
        result = await executeTool(block.name, (block.input as Record<string, unknown>) ?? {}, {
          source: "operations",
        });
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      yield {
        type: "tool_result",
        tool_name: block.name,
        content: result.length > 320 ? result.slice(0, 320) + "…" : result,
      };
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "assistant", content: finalMessage.content });
    messages.push({ role: "user", content: toolResults });

    if (textBuffer.length > 0) {
      yield { type: "text", content: "\n\n" };
      fullText += "\n\n";
    }
  }

  yield { type: "done", full_text: fullText };
}
