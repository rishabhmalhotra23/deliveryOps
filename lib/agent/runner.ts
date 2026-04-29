// Agent runner — Claude streaming + tool-use loop.
// Port of legacy/brain/agent.py::run.

import Anthropic from "@anthropic-ai/sdk";
import { requireCustomerByKey } from "@/lib/customers";
import { getRules } from "@/lib/rules/rules";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { DELIVERY_OPS_TOOLS } from "@/lib/agent/tools";
import { executeTool, type AgentSource } from "@/lib/agent/handlers";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 8;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Missing ANTHROPIC_API_KEY.");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

export interface RunAgentInput {
  customerKey: string;
  userMessage: string;
  history?: Anthropic.MessageParam[];
  source?: AgentSource;
}

export interface RunAgentResult {
  text: string;
  iterations: number;
  toolsUsed: string[];
}

/**
 * Run the DeliveryOps agent for a single user message and return the final
 * assistant text. For streaming, use streamAgent below.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { customerKey, userMessage, history = [], source = "web" } = input;
  const customer = await requireCustomerByKey(customerKey);
  const rules = await getRules(customerKey);
  const system = buildSystemPrompt({ customer, rules });

  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userMessage }];
  const toolsUsed: string[] = [];

  let final: Anthropic.Message | null = null;
  let iter = 0;

  for (iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    final = await client().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: DELIVERY_OPS_TOOLS,
      messages,
    });

    const toolBlocks = final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolBlocks) {
      toolsUsed.push(block.name);
      let result: string;
      try {
        result = await executeTool(
          block.name,
          (block.input as Record<string, unknown>) ?? {},
          { customerKey, source }
        );
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "assistant", content: final.content });
    messages.push({ role: "user", content: toolResults });
  }

  const text =
    final?.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n") ?? "";

  return { text, iterations: iter, toolsUsed };
}

// ─── streaming variant ───────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool_name: string; tool_input: unknown }
  | { type: "tool_result"; tool_name: string; content: string }
  | { type: "done"; full_text: string }
  | { type: "error"; content: string };

export async function* streamAgent(
  input: RunAgentInput
): AsyncGenerator<StreamEvent, void, void> {
  const { customerKey, userMessage, history = [], source = "web" } = input;

  let customer;
  let rules: string;
  try {
    customer = await requireCustomerByKey(customerKey);
    rules = await getRules(customerKey);
  } catch (err) {
    yield { type: "error", content: err instanceof Error ? err.message : String(err) };
    return;
  }

  const system = buildSystemPrompt({ customer, rules });
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userMessage }];
  let fullText = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: DELIVERY_OPS_TOOLS,
      messages,
    });

    const textChunks: string[] = [];
    let textBuffer = "";
    const onText = (text: string) => {
      textBuffer += text;
      textChunks.push(text);
    };
    stream.on("text", onText);

    let finalMessage: Anthropic.Message;
    try {
      finalMessage = await stream.finalMessage();
    } catch (err) {
      yield { type: "error", content: err instanceof Error ? err.message : String(err) };
      return;
    }

    // Yield buffered text in chunks (we already collected via on('text')).
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
        result = await executeTool(
          block.name,
          (block.input as Record<string, unknown>) ?? {},
          { customerKey, source }
        );
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      yield {
        type: "tool_result",
        tool_name: block.name,
        content: result.length > 240 ? result.slice(0, 240) + "…" : result,
      };
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "assistant", content: finalMessage.content });
    messages.push({ role: "user", content: toolResults });

    // Insert a blank line between iterations so the streamed output reads
    // cleanly when there's interstitial text + tools.
    if (textBuffer.length > 0) {
      yield { type: "text", content: "\n\n" };
      fullText += "\n\n";
    }
  }

  yield { type: "done", full_text: fullText };
}
