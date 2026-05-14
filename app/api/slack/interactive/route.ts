import { NextResponse } from "next/server";

import { verifySlackSignature } from "@/lib/slack/signature";
import { appendEvent } from "@/lib/events/events";
import { resolveCustomerFromChannel } from "@/lib/customers";
import { approve, reject, postDiscussPrompt, getApproval } from "@/lib/approvals/flow";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Slack POSTs `application/x-www-form-urlencoded` with a `payload` field
// containing the JSON. Block actions arrive here when a user clicks one of
// the buttons on an approval card (built by lib/approvals/slack-cards.ts).
//
// Handled action_ids:
//   approve_email   reject_email   discuss_email
//   approve_action  reject_action  discuss_action
//
// Each button carries the approval_id in its `value` field.
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

  const decidedBy = payload.user?.real_name ?? payload.user?.name ?? payload.user?.id ?? "unknown";
  const approvalId = action.value ?? "";

  // Slack requires a 200 within 3 seconds. Run the actual work without
  // awaiting in the happy path; failures get logged but don't block ack.
  handleAction(action.action_id, approvalId, decidedBy, payload.channel?.name ?? "").catch(
    (err) => console.error("[slack-interactive] handler failed:", err)
  );

  return NextResponse.json({ ok: true });
}

async function handleAction(
  actionId: string,
  approvalId: string,
  decidedBy: string,
  channelName: string
): Promise<void> {
  if (!approvalId) {
    console.warn("[slack-interactive] action without approval_id:", actionId);
    return;
  }
  const approval = await getApproval(approvalId);
  if (!approval) {
    console.warn("[slack-interactive] approval not found: %s", approvalId);
    return;
  }

  switch (actionId) {
    case "approve_email":
    case "approve_action": {
      const result = await approve(approval, decidedBy);
      console.log("[slack-interactive] approve %s by %s → %s", approvalId, decidedBy, result.note);
      return;
    }
    case "reject_email":
    case "reject_action": {
      const result = await reject(approval, decidedBy);
      console.log("[slack-interactive] reject %s by %s → %s", approvalId, decidedBy, result.note);
      return;
    }
    case "discuss_email":
    case "discuss_action": {
      const result = await postDiscussPrompt(approval);
      console.log("[slack-interactive] discuss %s → %s", approvalId, result.note);
      return;
    }
    default: {
      // Unknown action — log against the customer's event log if we can
      // resolve it, for visibility.
      try {
        const customer = await resolveCustomerFromChannel(channelName);
        if (customer?.key) {
          await appendEvent(
            customer.key,
            "APPROVAL_ACTION_UNKNOWN",
            { action_id: actionId, approval_id: approvalId, actor: decidedBy },
            { summary: `Unknown approval action ${actionId} by ${decidedBy}`, tags: ["approval"] }
          );
        }
      } catch {
        /* no-op */
      }
      console.warn("[slack-interactive] unhandled action: %s", actionId);
    }
  }
}
