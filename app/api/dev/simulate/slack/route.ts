import { NextResponse } from "next/server";

import { runAgent } from "@/lib/agent/runner";
import { saveConversation } from "@/lib/conversations";
import { requireCustomerByKey } from "@/lib/customers";
import { recordOutbox } from "@/lib/dev/outbox";
import { mdToBlocks, mdToMrkdwn } from "@/lib/slack/mrkdwn";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  customerKey?: string;
  userName?: string;
  text?: string;
}

// Synthesize a Slack message inbound and run it through the agent the same way
// the real /api/slack/events route does — minus the signature check.
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const customerKey = body.customerKey?.trim();
  const text = body.text?.trim();
  const userName = body.userName?.trim() || "Dev simulator";

  if (!customerKey || !text) {
    return NextResponse.json({ error: "customerKey and text are required." }, { status: 400 });
  }

  let customer;
  try {
    customer = await requireCustomerByKey(customerKey);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Customer not found." },
      { status: 404 }
    );
  }

  const channel = customer.slack_channel ?? customer.key;
  const fakeUserId = `U-DEV-${userName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}`;

  let response = "";
  try {
    const result = await runAgent({
      customerKey,
      userMessage: text,
      source: "slack",
    });
    response = result.text || "(empty agent response)";
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  // Persist the conversation exactly like the real listener does.
  try {
    await saveConversation(customerKey, {
      channel,
      user_id: fakeUserId,
      user_name: userName,
      user_message: text,
      bot_response: response,
    });
  } catch (err) {
    console.warn("[dev/simulate/slack] saveConversation failed:", err);
  }

  // The agent's reply is what would have been posted to Slack — record it in
  // the outbox so /dev/outbox shows the round-trip.
  await recordOutbox({
    kind: "slack.message",
    customerKey,
    summary: `Slack reply → #${channel}: ${response.slice(0, 80)}${response.length > 80 ? "…" : ""}`,
    payload: {
      channel,
      text: mdToMrkdwn(response),
      blocks: mdToBlocks(response),
      in_response_to: text,
      from: userName,
    },
  });

  return NextResponse.json({
    ok: true,
    message: `Simulated Slack message from ${userName} processed. Response below routed to outbox (#${channel}).`,
    agent_response: response,
    raw: { channel, customerKey, userName, fakeUserId },
  });
}
