import { req, ORG_ID, WORKSPACE_ID, AUTOMATION_ID } from "@/lib/kognitos";

let cachedCode: string | null = null;

async function getAutomationCode(): Promise<string> {
  if (cachedCode !== null) return cachedCode;
  try {
    const res = await req(
      `/organizations/${ORG_ID}/workspaces/${WORKSPACE_ID}/automations/${AUTOMATION_ID}`
    );
    if (res.ok) {
      const data = await res.json();
      cachedCode = data.english_code ?? "";
    }
  } catch {
    /* don't cache failures — allow retry on next request */
  }
  return cachedCode ?? "";
}

/**
 * Build the Claude system prompt. Customize this for your domain:
 * - Replace the description of what the automation does
 * - Map domain terminology (what is a "run" in user language?)
 * - List the output fields users care about
 * - Add domain-specific rules for how Claude should respond
 */
export async function buildSystemPrompt(): Promise<string> {
  const code = await getAutomationCode();

  return `You are a helpful assistant for a dashboard built on the Kognitos automation platform.

## What the automation does
<!-- Replace this section with a description of the specific automation -->
This automation processes incoming data, extracts information, and produces structured outputs.

## Domain terminology
<!-- Map Kognitos terms to your domain language -->
- "Run" = one execution of the automation (rename to your domain term, e.g. "referral", "invoice", "order")
- "Completed" = processed successfully
- "Awaiting guidance" = needs human review
- "Executing" = currently processing
- "Pending" = queued
- "Failed" = unrecoverable error

## Output fields from a completed run
<!-- List the output fields your automation produces -->
- Describe each output field, its type, and what it represents

## Tools available
You have tools to query the Kognitos API. Use them to answer user questions. Always use the tools rather than guessing.

## Rules
- Use domain language, not Kognitos jargon (run, automation, execution)
- Be concise but thorough
- Format data clearly when presenting it
- If you don't have enough information, say so and suggest what tools could help

## Automation code (for context)
${code}`;
}
