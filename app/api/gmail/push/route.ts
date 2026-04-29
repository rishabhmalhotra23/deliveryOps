import { NextResponse } from "next/server";

import { fetchHistory, fetchMessage } from "@/lib/integrations/google/gmail";
import { listCustomers } from "@/lib/customers";
import { inngest } from "@/inngest/client";
import { appendEvent } from "@/lib/events/events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pub/Sub push payload shape:
// {
//   message: {
//     data: <base64 of {"emailAddress":"alias@kognitos.com","historyId":12345}>,
//     messageId: ...,
//     publishTime: ...
//   },
//   subscription: "projects/.../subscriptions/..."
// }
//
// To verify pushes, set GMAIL_PUBSUB_VERIFICATION_TOKEN as the query string
// on the push subscription URL; we check it here.
export async function POST(request: Request) {
  const verificationToken = process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN;
  const url = new URL(request.url);
  if (verificationToken) {
    if (url.searchParams.get("token") !== verificationToken) {
      return NextResponse.json({ error: "Invalid token." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "GMAIL_PUBSUB_VERIFICATION_TOKEN not configured." },
      { status: 500 }
    );
  }

  let payload: { message?: { data?: string } };
  try {
    payload = (await request.json()) as { message?: { data?: string } };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const data = payload.message?.data;
  if (!data) return NextResponse.json({ ok: true });

  let parsed: { emailAddress: string; historyId: number };
  try {
    parsed = JSON.parse(Buffer.from(data, "base64").toString("utf-8"));
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Resolve which customer this alias belongs to.
  const customers = await listCustomers();
  const customer = customers.find(
    (c) => (c.email_alias ?? "").toLowerCase() === parsed.emailAddress.toLowerCase()
  );
  if (!customer) {
    console.warn("[gmail] unknown alias %s — ignoring", parsed.emailAddress);
    return NextResponse.json({ ok: true });
  }

  // Walk the history starting at the supplied historyId. Each new message
  // gets dispatched as an Inngest event so the queue handles retries.
  let history;
  try {
    history = await fetchHistory(String(parsed.historyId));
  } catch (err) {
    console.warn("[gmail] history fetch failed:", err);
    return NextResponse.json({ ok: true });
  }

  const seen = new Set<string>();
  for (const entry of history.history ?? []) {
    for (const m of entry.messages ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);

      try {
        const msg = await fetchMessage(m.id);
        const headers = msg.payload?.headers ?? [];
        const subject = header(headers, "Subject");
        const from = header(headers, "From");

        await appendEvent(
          customer.key,
          "EMAIL_RECEIVED",
          { messageId: m.id, threadId: m.threadId, from, subject, snippet: msg.snippet ?? "" },
          { summary: `Email from ${from}: ${subject}`, tags: ["email", "inbound"] }
        );

        // Hand off the heavy lifting (parse body, ingest attachments, run
        // the agent) to Inngest so the push handler stays under 3s.
        await inngest.send({
          name: "delivery-ops/email.received",
          data: {
            customerKey: customer.key,
            messageId: m.id,
            threadId: m.threadId,
            subject,
            from,
          },
        });
      } catch (err) {
        console.warn("[gmail] message process failed:", err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

function header(
  headers: Array<{ name: string; value: string }>,
  name: string
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
