// Gmail send + send-as alias verification.
// Port of legacy/storage/gmail.py — outbound parts only (read path is replaced
// by the Pub/Sub push handler at app/api/gmail/push/route.ts).
//
// Dev-mode behaviour: when Google OAuth env vars are missing, sendEmail falls
// back to the dev outbox (lib/dev/outbox.ts) and verifySendAsAliases returns
// "all configured" so callers can run end-to-end without Google credentials.

import { getGoogleAccessToken } from "./auth";
import { recordOutbox } from "@/lib/dev/outbox";
import { gmailEnabled } from "@/lib/dev/mode";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailJsonResponse<T> {
  ok: true;
  data: T;
}

async function gmailFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Gmail API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ─── send-as aliases ─────────────────────────────────────────────────────────

interface SendAsListResponse {
  sendAs: Array<{ sendAsEmail: string; isDefault?: boolean; verificationStatus?: string }>;
}

export async function listSendAsAliases(): Promise<string[]> {
  if (!gmailEnabled()) return [];
  const data = await gmailFetch<SendAsListResponse>("/settings/sendAs");
  return (data.sendAs ?? []).map((s) => s.sendAsEmail.toLowerCase());
}

export async function verifySendAsAliases(required: string[]): Promise<string[]> {
  if (!gmailEnabled()) return []; // pretend everything is configured in dev mode
  const configured = new Set(await listSendAsAliases());
  const missing = required.filter((a) => !configured.has(a.toLowerCase()));
  if (missing.length > 0) {
    console.warn(
      "Missing Gmail send-as aliases — emails from these addresses fall back to the primary account:\n  " +
        missing.join("\n  ") +
        "\nFix: Gmail → Settings → Accounts → 'Send mail as' → add each alias."
    );
  }
  return missing;
}

// ─── send ────────────────────────────────────────────────────────────────────

export interface EmailAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface SendEmailInput {
  fromAddr: string;
  to: string[];
  subject: string;
  bodyMarkdown: string;
  attachments?: EmailAttachment[];
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  customerKey?: string; // for dev-mode outbox tagging
}

export interface SendEmailResult {
  id: string;
  threadId: string;
}

const HTML_WRAPPER_OPEN = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a;">
<style>
table { border-collapse: collapse; margin: 12px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
tr:nth-child(even) { background: #fafafa; }
code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
pre { background: #f6f6f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
ol, ul { padding-left: 24px; }
li { margin-bottom: 4px; }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }
</style>`;
const HTML_WRAPPER_CLOSE = "</div>";

// Simple markdown → HTML — handles the cases the legacy markdown2 did
// without dragging in a 4MB dependency. Good enough for outbound copy.
function markdownToHtml(md: string): string {
  let html = md
    // Code blocks
    .replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${escapeHtml(c.trim())}</pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italics
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Headings
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    // Horizontal rules
    .replace(/^-{3,}$/gm, "<hr/>");

  // Paragraphs (split on blank lines, wrap remaining lines that aren't already tags)
  const blocks = html.split(/\n{2,}/).map((b) => {
    const t = b.trim();
    if (!t) return "";
    if (/^<(h\d|pre|hr|ul|ol|table|blockquote)/.test(t)) return t;
    if (/^[\-*]\s/.test(t)) {
      const items = t
        .split("\n")
        .map((l) => l.replace(/^[\-*]\s+/, "").trim())
        .filter(Boolean)
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
  });

  return HTML_WRAPPER_OPEN + blocks.join("\n") + HTML_WRAPPER_CLOSE;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRawMime(input: SendEmailInput): string {
  const boundaryMixed = `mixed-${Math.random().toString(36).slice(2)}`;
  const boundaryAlt = `alt-${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${input.fromAddr}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);

  const altPart = [
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    "",
    `--${boundaryAlt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.bodyMarkdown,
    "",
    `--${boundaryAlt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    markdownToHtml(input.bodyMarkdown),
    "",
    `--${boundaryAlt}--`,
  ].join("\r\n");

  const parts = [headers.join("\r\n"), "", altPart];

  for (const att of input.attachments ?? []) {
    const b64 = att.data.toString("base64").replace(/(.{76})/g, "$1\r\n");
    parts.push(
      [
        `--${boundaryMixed}`,
        `Content-Type: ${att.contentType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        b64,
      ].join("\r\n")
    );
  }
  parts.push(`--${boundaryMixed}--`);
  return parts.join("\r\n");
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!gmailEnabled()) {
    const id = `mock-mail-${Date.now()}`;
    await recordOutbox({
      kind: "gmail.send",
      customerKey: input.customerKey ?? "unknown",
      summary: `Email → ${input.to.join(", ")}: ${input.subject}`,
      payload: {
        from: input.fromAddr,
        to: input.to,
        subject: input.subject,
        body: input.bodyMarkdown,
        attachments: (input.attachments ?? []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.data.length,
        })),
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? null,
        threadId: input.threadId ?? null,
        mock_message_id: id,
      },
    });
    return { id, threadId: input.threadId ?? id };
  }

  const raw = buildRawMime(input);
  const encoded = Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const body: Record<string, unknown> = { raw: encoded };
  if (input.threadId) body.threadId = input.threadId;

  const res = await gmailFetch<{ id: string; threadId: string }>("/messages/send", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: res.id, threadId: res.threadId };
}

// ─── inbound watch (Pub/Sub) ─────────────────────────────────────────────────

export async function startGmailWatch(topicName: string, labelIds?: string[]): Promise<{
  historyId: string;
  expiration: string;
}> {
  const data = await gmailFetch<{ historyId: string; expiration: string }>("/watch", {
    method: "POST",
    body: JSON.stringify({
      topicName,
      labelIds,
      labelFilterAction: labelIds ? "include" : undefined,
    }),
  });
  return data;
}

export async function fetchHistory(historyId: string) {
  return await gmailFetch<{
    history?: Array<{ id: string; messages?: Array<{ id: string; threadId: string }> }>;
    historyId: string;
  }>(`/history?startHistoryId=${historyId}`);
}

export async function fetchMessage(messageId: string) {
  return await gmailFetch<{
    id: string;
    threadId: string;
    payload?: {
      headers?: Array<{ name: string; value: string }>;
      mimeType?: string;
      body?: { data?: string };
      parts?: unknown[];
    };
    snippet?: string;
    labelIds?: string[];
  }>(`/messages/${messageId}?format=full`);
}
