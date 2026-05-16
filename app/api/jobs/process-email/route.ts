// POST /api/jobs/process-email
//
// Background job: pull a full inbound Gmail message, decode body + attachments,
// fan out attachment ingestion to /api/jobs/ingest-document, then run the
// agent on the body in `source: "email"` mode (mutating tools queue for
// approval rather than executing inline).
//
// Triggered fire-and-forget by app/api/gmail/push/route.ts when a Pub/Sub
// push reports new mail on a customer alias.

import { NextResponse } from "next/server";
import { fetchMessage } from "@/lib/integrations/google/gmail";
import { runAgent } from "@/lib/agent/runner";
import { assertJobAuth, dispatchJob } from "@/lib/jobs/dispatch";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = logger("jobs.process-email");

interface EmailPayload {
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
}

function decodeBase64Url(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

interface ExtractedEmail {
  text: string;
  attachments: Array<{ filename: string; mimeType: string; data: Buffer }>;
}

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
      const html = decodeBase64Url(part.body.data).toString("utf-8");
      bestText = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }
  walk(payload);
  out.text = bestText.trim();
  return out;
}

export async function POST(request: Request) {
  const authErr = await assertJobAuth(request);
  if (authErr) return authErr;

  let data: EmailPayload;
  try {
    data = (await request.json()) as EmailPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!data.customerKey || !data.messageId) {
    return NextResponse.json({ error: "Missing customerKey or messageId." }, { status: 400 });
  }

  try {
    const message = await fetchMessage(data.messageId);
    const extracted = extractEmail(message.payload as GmailPart | undefined);

    // Fan out attachments — upload bytes to Storage, then dispatch an
    // ingest-document job per file.
    if (extracted.attachments.length > 0) {
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
          await dispatchJob("ingest-document", {
            customerKey: data.customerKey,
            filename: att.filename,
            mimeType: att.mimeType,
            source: "email",
            sourceDetail: `Email from ${data.from} (msg ${data.messageId})`,
            storagePath,
          });
        } catch (err) {
          log.warn("attachment ingest failed", { filename: att.filename, ...errorCtx(err) });
        }
      }
    }

    const bodyTrimmed = extracted.text.trim();
    if (!bodyTrimmed) {
      return NextResponse.json({ ok: true, agentRan: false, reason: "empty body" });
    }

    const agentInput = `[Email from ${data.from} — subject: "${data.subject}"]\n\n${bodyTrimmed}`;
    const result = await runAgent({
      customerKey: data.customerKey,
      userMessage: agentInput,
      source: "email",
    });

    return NextResponse.json({
      ok: true,
      messageId: data.messageId,
      attachments: extracted.attachments.length,
      agentRan: true,
      agentText: result.text.slice(0, 400),
    });
  } catch (err) {
    log.error("email processing failed", { messageId: data.messageId, ...errorCtx(err) });
    return NextResponse.json({ error: "Email processing failed." }, { status: 500 });
  }
}
