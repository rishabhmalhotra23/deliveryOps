// Inngest worker for `delivery-ops/email.received`.
//
// The Gmail Pub/Sub push handler at app/api/gmail/push/route.ts walks new
// messages on each customer alias, logs an EMAIL_RECEIVED event, then
// emits this event. The work below mirrors Curator's legacy email_listener:
//
//   1. Fetch the full Gmail message (body + parts).
//   2. Decode the text/plain body.
//   3. Extract attachments and fan-out one delivery-ops/document.uploaded
//      event per attachment (the existing ingest-document worker handles
//      Storage + Claude extraction + classification).
//   4. Run the per-customer agent with `source: "email"`. Mutating tools
//      (`update_customer_profile`, `update_customer_rules`) get queued for
//      approval rather than executed inline. The agent's reply (if it
//      chose `send_email`) is sent through the Slack approval flow.
//
// Failure modes:
//   - Missing Gmail credentials → log + skip (we still recorded the
//     EMAIL_RECEIVED event in the push handler).
//   - Per-attachment failures don't abort the body processing.

import { inngest } from "../client";
import { fetchMessage } from "@/lib/integrations/google/gmail";
import { runAgent } from "@/lib/agent/runner";

interface EmailEventData {
  customerKey: string;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}

function decodeBase64Url(s: string): Buffer {
  // Gmail returns base64url with - and _ swapped and padding stripped.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

interface ExtractedEmail {
  text: string;
  attachments: Array<{ filename: string; mimeType: string; data: Buffer }>;
}

// Walk a Gmail message tree and collect (a) the best text body and
// (b) any attachment parts (parts that carry a filename).
function extractEmail(payload: GmailPart | undefined): ExtractedEmail {
  const out: ExtractedEmail = { text: "", attachments: [] };
  if (!payload) return out;

  let bestText = "";

  function walk(part: GmailPart): void {
    const mt = part.mimeType ?? "";
    if (mt.startsWith("multipart/")) {
      for (const sub of part.parts ?? []) walk(sub);
      return;
    }
    // Attachment: parts with a filename.
    if (part.filename && part.filename.length > 0 && part.body?.data) {
      out.attachments.push({
        filename: part.filename,
        mimeType: mt || "application/octet-stream",
        data: decodeBase64Url(part.body.data),
      });
      return;
    }
    if (mt === "text/plain" && part.body?.data) {
      bestText = decodeBase64Url(part.body.data).toString("utf-8");
    } else if (mt === "text/html" && part.body?.data && !bestText) {
      // Use HTML as a fallback when no plain-text part exists; strip tags
      // crudely so the agent gets something readable. Curator's body was
      // always plain-text via Gmail; this is a small cushion.
      const html = decodeBase64Url(part.body.data).toString("utf-8");
      bestText = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  walk(payload);
  out.text = bestText.trim();
  return out;
}

export const processInboundEmail = inngest.createFunction(
  { id: "process-inbound-email", retries: 3 },
  { event: "delivery-ops/email.received" },
  async ({ event, step }) => {
    const data = event.data as EmailEventData;
    if (!data.customerKey || !data.messageId) {
      throw new Error("process-inbound-email: missing customerKey or messageId.");
    }

    // 1. Fetch the full Gmail message.
    const message = await step.run("fetch-gmail-message", async () => {
      return fetchMessage(data.messageId);
    });

    // 2 + 3. Extract body + attachments. Done inline (no Inngest step) so
    // the binary buffers don't get serialised across step boundaries.
    const extracted = extractEmail(message.payload);

    // 4. Fan out one document-ingest event per attachment. Upload the
    // bytes to Storage first so the worker can fetch by storagePath.
    if (extracted.attachments.length > 0) {
      await step.run("ingest-attachments", async () => {
        const { uploadFile, ensureBucket } = await import("@/lib/ingestion/storage");
        await ensureBucket();
        for (let i = 0; i < extracted.attachments.length; i++) {
          const att = extracted.attachments[i];
          try {
            const storagePath = await uploadFile(
              {
                customerKey: data.customerKey,
                packageId: `email-${data.messageId}-${i}`,
                filename: att.filename,
                content: att.data,
                contentType: att.mimeType,
              },
              "raw"
            );
            await inngest.send({
              name: "delivery-ops/document.uploaded",
              data: {
                customerKey: data.customerKey,
                filename: att.filename,
                mimeType: att.mimeType,
                source: "email",
                sourceDetail: `Email from ${data.from} (msg ${data.messageId})`,
                storagePath,
              },
            });
          } catch (err) {
            // Don't fail the whole job for one bad attachment.
            console.warn(
              "[process-inbound-email] attachment %s failed: %s",
              att.filename,
              err instanceof Error ? err.message : err
            );
          }
        }
      });
    }

    // 5. Run the agent on the body. We send a structured prompt so the
    // model knows the source channel and subject. `source: "email"` makes
    // the dispatcher queue mutating tools (update_customer_profile,
    // update_customer_rules) for human approval instead of running them.
    const bodyTrimmed = extracted.text.trim();
    if (bodyTrimmed.length === 0) {
      return {
        ok: true,
        messageId: data.messageId,
        attachments: extracted.attachments.length,
        agentRan: false,
        reason: "Empty body — nothing for the agent to do.",
      };
    }

    const agentInput = `[Email from ${data.from} — subject: "${data.subject}"]\n\n${bodyTrimmed}`;
    const agentResult = await step.run("run-agent", async () => {
      return runAgent({
        customerKey: data.customerKey,
        userMessage: agentInput,
        source: "email",
      });
    });

    return {
      ok: true,
      messageId: data.messageId,
      attachments: extracted.attachments.length,
      agentRan: true,
      agentText: agentResult.text.slice(0, 400),
    };
  }
);
