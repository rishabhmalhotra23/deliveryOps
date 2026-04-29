import { NextResponse } from "next/server";

import { verifySlackSignature } from "@/lib/slack/signature";
import { appendEvent } from "@/lib/events/events";
import { resolveCustomerFromChannel } from "@/lib/customers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Slack POSTs `application/x-www-form-urlencoded` with a `payload` field
// containing the JSON. Block actions arrive here when a user clicks a button
// in an approval card.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? "";
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  if (signingSecret) {
    const ok = verifySlackSignature({ signingSecret, timestamp, signature, rawBody });
    if (!ok) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "SLACK_SIGNING_SECRET not configured." }, { status: 500 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) return NextResponse.json({ ok: true });

  let payload: {
    type?: string;
    user?: { id: string; name?: string; real_name?: string };
    channel?: { id: string; name?: string };
    actions?: Array<{ action_id: string; value?: string }>;
  };
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const action = payload.actions?.[0];
  if (!action) return NextResponse.json({ ok: true });

  const channelName = payload.channel?.name ?? payload.channel?.id ?? "";
  let customerKey: string | null = null;
  try {
    const customer = await resolveCustomerFromChannel(channelName);
    customerKey = customer?.key ?? null;
  } catch {
    /* ignore */
  }

  const user = payload.user?.real_name ?? payload.user?.name ?? payload.user?.id ?? "unknown";

  if (customerKey) {
    await appendEvent(
      customerKey,
      "APPROVAL_ACTION",
      {
        action_id: action.action_id,
        approval_id: action.value ?? "",
        actor: user,
      },
      {
        summary: `Approval action: ${action.action_id} by ${user}`,
        tags: ["approval", action.action_id],
      }
    );
  }

  // Phase 1 stub — full approve/reject/discuss handlers land alongside the
  // email-approval port. Slack expects a 200 within 3 seconds.
  return NextResponse.json({
    ok: true,
    note: "DeliveryOps received the action. The full approval flow lands in the email-approval port.",
  });
}
