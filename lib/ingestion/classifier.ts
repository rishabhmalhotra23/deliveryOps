// LLM document classifier — port of legacy/ingestion/classifier.py.

import Anthropic from "@anthropic-ai/sdk";

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

export async function classifyDocument(
  filename: string,
  markdown: string
): Promise<DocumentCategory> {
  const preview = (markdown ?? "").slice(0, 2000) || "(empty)";
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";

  try {
    const res = await client().messages.create({
      model,
      max_tokens: 16,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Filename: ${filename}\n\nContent preview:\n${preview}`,
        },
      ],
    });
    const block = res.content[0];
    const raw = block.type === "text" ? block.text.trim().toLowerCase() : "other";
    if ((DOCUMENT_CATEGORIES as readonly string[]).includes(raw)) {
      return raw as DocumentCategory;
    }
    console.warn("[classifier] unknown category %s for %s", raw, filename);
    return "other";
  } catch (err) {
    console.warn("[classifier] failed for %s: %s", filename, err);
    return "other";
  }
}
