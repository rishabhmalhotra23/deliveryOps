import { NextResponse } from "next/server";

import { runAgent } from "@/lib/agent/runner";
import { requireCustomerByKey } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  customerKey?: string;
  from?: string;
  subject?: string;
  body?: string;
}

// Simulate an inbound email landing on the customer's alias. Mirrors the
// behaviour of /api/gmail/push minus the Pub/Sub envelope and Gmail history
// walk: log EMAIL_RECEIVED, then run the agent against the email body in
// "email" source mode (so gated tools queue for approval rather than
// auto-mutating the profile).
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const customerKey = body.customerKey?.trim();
  const from = (body.from ?? "").trim();
  const subject = (body.subject ?? "").trim() || "(no subject)";
  const text = (body.body ?? "").trim();
  if (!customerKey || !from || !text) {
    return NextResponse.json(
      { error: "customerKey, from, and body are required." },
      { status: 400 }
    );
  }

  try {
    await requireCustomerByKey(customerKey);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Customer not found." },
      { status: 404 }
    );
  }

  const messageId = `mock-${Date.now()}`;

  await appendEvent(
    customerKey,
    "EMAIL_RECEIVED",
    {
      messageId,
      threadId: messageId,
      from,
      subject,
      snippet: text.slice(0, 200),
      body: text,
    },
    { summary: `Email from ${from}: ${subject}`, tags: ["email", "inbound", "simulated"] }
  );

  const agentInput = `[Email from ${from} — subject: "${subject}"]\n\n${text}`;
  let response = "";
  try {
    const result = await runAgent({
      customerKey,
      userMessage: agentInput,
      source: "email",
    });
    response = result.text || "(empty agent response)";
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: `Simulated email logged + agent ran (source=email). Reply below would land in the outbox if the agent chose send_email.`,
    agent_response: response,
    raw: { messageId, from, subject },
  });
}
