// Document extractor — Claude vision drives PDF + image OCR.
// Replaces marker-pdf / pandoc / tesseract from legacy/ingestion/converters.py.
//
// Strategy:
//   - PDFs / images          → Claude vision, returns Markdown.
//   - DOCX / PPTX / XLSX     → mammoth / xlsx / pptx-parser (TODO Phase 2 —
//                              shipping as text-only for now).
//   - Plain text             → as-is.
//   - Anything else          → best-effort UTF-8 decode with a "binary file"
//                              sentinel for unknown types.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 8192;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Missing ANTHROPIC_API_KEY.");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

export interface ExtractedDoc {
  markdown: string;
  pageCount: number;
}

const PDF_PROMPT = `Convert this document to clean, structured Markdown. Rules:
- Use ## for top-level section headings (or # for the document title if obvious).
- Preserve tables using GitHub-flavoured Markdown.
- Keep all numbers, dates, names, and dollar amounts exactly as written.
- Strip page numbers, headers/footers, and watermarks.
- Drop redundant whitespace.
- Return ONLY the Markdown — no preamble, no commentary.`;

const IMAGE_PROMPT = `Transcribe everything visible in this image to clean Markdown. Preserve any tables, lists, dates, and names exactly as written. Return ONLY the Markdown — no preamble.`;

export async function extractPdf(content: Buffer): Promise<ExtractedDoc> {
  const base64 = content.toString("base64");
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          { type: "text", text: PDF_PROMPT },
        ],
      },
    ],
  });
  const text = textFromMessage(res);
  // We can't directly count pages without re-parsing the PDF — Claude's
  // vision endpoint already paged it for us. Use heading heuristics as a
  // proxy. The dashboard treats this as approximate.
  const pageCount = Math.max(1, (text.match(/^#{1,2}\s/gm) ?? []).length);
  return { markdown: text, pageCount };
}

export async function extractImage(
  content: Buffer,
  mimeType: string
): Promise<ExtractedDoc> {
  const base64 = content.toString("base64");
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: normalizeImageMime(mimeType),
              data: base64,
            },
          },
          { type: "text", text: IMAGE_PROMPT },
        ],
      },
    ],
  });
  return { markdown: textFromMessage(res), pageCount: 1 };
}

function normalizeImageMime(mime: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const lower = mime.toLowerCase();
  if (lower === "image/jpg" || lower === "image/jpeg") return "image/jpeg";
  if (lower === "image/png") return "image/png";
  if (lower === "image/gif") return "image/gif";
  if (lower === "image/webp") return "image/webp";
  // Default to PNG — Anthropic's API will reject if it actually doesn't match.
  return "image/png";
}

function textFromMessage(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function extract(content: Buffer, mimeType: string): Promise<ExtractedDoc> {
  if (mimeType === "application/pdf") return extractPdf(content);
  if (mimeType.startsWith("image/")) return extractImage(content, mimeType);
  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/csv"
  ) {
    return { markdown: content.toString("utf-8"), pageCount: 1 };
  }
  // TODO Phase 2: docx via mammoth, pptx via pptx-parser, xlsx via xlsx.
  // First-pass fallback — try UTF-8; if it's mostly junk, fall back to a
  // sentinel so the agent surfaces "binary file, not extracted yet".
  const utf = content.toString("utf-8");
  const printable = (utf.match(/[\x20-\x7E\s]/g) ?? []).length;
  if (utf.length > 0 && printable / utf.length > 0.85) {
    return { markdown: utf, pageCount: 1 };
  }
  return {
    markdown:
      `_Binary file (${mimeType}) — not extracted in Phase 1. ` +
      `Office formats land in Phase 2 (mammoth / xlsx / pptx-parser)._`,
    pageCount: 1,
  };
}
