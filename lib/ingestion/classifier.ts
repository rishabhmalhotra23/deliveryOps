// LLM document classifier — port of legacy/ingestion/classifier.py.
//
// Two surfaces:
//   • classifyDocument(filename, markdown) — realtime, single doc. Used by
//     the ingestion pipeline as files arrive.
//   • buildClassifyBatchRequests(items) — produces requests for the
//     Anthropic Message Batches API (see lib/agent/batch.ts). Used for
//     bulk reclassification and any catch-up work. 50% cheaper per token
//     than realtime; expect minutes-to-hours latency.

import Anthropic from "@anthropic-ai/sdk";
import type { BatchRequest } from "@/lib/agent/batch";

export const DOCUMENT_CATEGORIES = [
  "contracts",
  "meeting-notes",
  "sops",
  "support",
  "onboarding",
  "invoices",
  "reports",
  "presentations",
  "correspondence",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

const SYSTEM = `You are a document classifier for a customer success team. Given the filename and a content preview, classify into ONE of:

${DOCUMENT_CATEGORIES.map((c) => `- ${c}`).join("\n")}

Reply with ONLY the category name. No explanation. No quotes. If unsure, "other".`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Missing ANTHROPIC_API_KEY.");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

function userPrompt(filename: string, markdown: string): string {
  const preview = (markdown ?? "").slice(0, 2000) || "(empty)";
  return `Filename: ${filename}\n\nContent preview:\n${preview}`;
}

export function parseCategory(raw: string): DocumentCategory {
  const trimmed = raw.trim().toLowerCase();
  if ((DOCUMENT_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as DocumentCategory;
  }
  return "other";
}

export async function classifyDocument(
  filename: string,
  markdown: string
): Promise<DocumentCategory> {
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";

  try {
    const res = await client().messages.create({
      model,
      max_tokens: 16,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(filename, markdown) }],
    });
    const block = res.content[0];
    const raw = block.type === "text" ? block.text : "other";
    const parsed = parseCategory(raw);
    if (parsed === "other" && raw.trim().toLowerCase() !== "other") {
      console.warn("[classifier] unknown category %s for %s", raw, filename);
    }
    return parsed;
  } catch (err) {
    console.warn("[classifier] failed for %s: %s", filename, err);
    return "other";
  }
}

export interface ClassifyBatchItem {
  /** Stable ID used to correlate results back to the caller's source row. */
  customId: string;
  filename: string;
  markdown: string;
}

/**
 * Build the BatchRequest array for the Anthropic Message Batches API.
 * Pass the returned array to `submitBatch` from `lib/agent/batch.ts`,
 * then map results back via `customId` and call `parseCategory` on the
 * extracted text.
 */
export function buildClassifyBatchRequests(items: ClassifyBatchItem[]): BatchRequest[] {
  return items.map((item) => ({
    customId: item.customId,
    params: {
      model: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929",
      max_tokens: 16,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(item.filename, item.markdown) }],
    },
  }));
}
