import { NextResponse } from "next/server";

import { verifySlackSignature } from "@/lib/slack/signature";
import {
  postMessage,
  fetchUserInfo,
  fetchFile,
  downloadSlackFile,
} from "@/lib/slack/client";
import { mdToBlocks, mdToMrkdwn } from "@/lib/slack/mrkdwn";
import { resolveCustomerFromChannel } from "@/lib/customers";
import { runAgent } from "@/lib/agent/runner";
import { saveConversation } from "@/lib/conversations";
import { inngest } from "@/inngest/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SlackEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  channel?: string;
  channel_id?: string;
  user?: string;
  user_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: Array<{ id: string; name: string; mimetype: string }>;
  file?: { id: string };
  file_id?: string;
}

interface SlackPayload {
  type: "url_verification" | "event_callback" | string;
  challenge?: string;
  event?: SlackEvent;
  team_id?: string;
  api_app_id?: string;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? "";
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  // In strict prod we'd 401 on missing creds. For Phase 1 we let unsigned
  // requests through ONLY when no signing secret is configured (i.e. a
  // local dev session before .env.local is wired up); never in production.
  if (signingSecret) {
    const ok = verifySlackSignature({ signingSecret, timestamp, signature, rawBody });
    if (!ok) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "SLACK_SIGNING_SECRET not configured." }, { status: 500 });
  }

  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Slack URL verification handshake.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge ?? "" });
  }

  if (payload.type !== "event_callback" || !payload.event) {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;

  // ACK immediately — Slack times out at 3s. Do work without awaiting in the
  // happy path; surface errors via console.
  handleEvent(event).catch((err) => console.error("[slack] event handler failed:", err));
  return NextResponse.json({ ok: true });
}

async function handleEvent(event: SlackEvent): Promise<void> {
  switch (event.type) {
    case "message":
      await handleMessage(event);
      return;
    case "file_shared":
      await handleFileShared(event);
      return;
    case "app_mention":
      await handleAppMention(event);
      return;
    default:
      // Drop everything else silently.
      return;
  }
}

function ignoreMessage(event: SlackEvent): boolean {
  if (event.bot_id) return true;
  const subtype = event.subtype;
  if (subtype === "bot_message" || subtype === "message_changed" || subtype === "message_deleted") {
    return true;
  }
  return false;
}

async function resolveChannelName(channelId: string): Promise<string> {
  // We can resolve via conversations.info — but to keep this route lean and
  // avoid an extra round-trip for every message, treat the channel ID as the
  // name when prefixed with C/D and look up by the customer's slack_channel
  // field directly. The legacy code did a round-trip; in Phase 2 we'll add a
  // channel-name cache table.
  return channelId;
}

async function handleMessage(event: SlackEvent): Promise<void> {
  if (ignoreMessage(event)) return;

  const channelId = event.channel ?? "";
  const text = (event.text ?? "").trim();
  const files = event.files ?? [];

  if (!channelId) return;
  if (!text && files.length === 0) return;

  // Files trigger the ingestion path — fan out one Inngest event per file.
  if (files.length > 0) {
    for (const f of files) {
      await inngest.send({
        name: "delivery-ops/document.uploaded",
        data: {
          customerKey: await customerKeyForChannel(channelId),
          filename: f.name,
          mimeType: f.mimetype,
          source: "slack",
          sourceDetail: `Slack channel ${channelId}`,
          slackFileId: f.id,
        },
      }).catch((err) => console.warn("[slack] failed to enqueue ingestion:", err));
    }
    if (!text) return; // file-only message — done.
  }

  const customerKey = await customerKeyForChannel(channelId);
  if (!customerKey) return;

  const userId = event.user ?? "unknown";
  const userName = await resolveUserName(userId);

  let response: string;
  try {
    const result = await runAgent({
      customerKey,
      userMessage: text,
      source: "slack",
    });
    response = result.text || "(empty response)";
  } catch (err) {
    console.error("[slack] agent failed:", err);
    response = "Something went wrong on our side. Try again.";
  }

  try {
    const blocks = mdToBlocks(response);
    await postMessage(channelId, mdToMrkdwn(response), {
      blocks,
      thread_ts: event.thread_ts,
    });
  } catch (err) {
    console.error("[slack] postMessage failed:", err);
  }

  try {
    await saveConversation(customerKey, {
      channel: channelId,
      user_id: userId,
      user_name: userName,
      user_message: text,
      bot_response: response,
    });
  } catch (err) {
    console.warn("[slack] saveConversation failed:", err);
  }
}

async function handleAppMention(event: SlackEvent): Promise<void> {
  // Strip the leading <@BOTID> mention before sending to the agent.
  const text = (event.text ?? "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();
  const channelId = event.channel ?? "";
  if (!text || !channelId) return;

  const customerKey = await customerKeyForChannel(channelId);
  if (!customerKey) {
    await postMessage(
      channelId,
      "I couldn't tell which customer this is. Mention me in a customer channel or include the customer name.",
      { thread_ts: event.thread_ts }
    );
    return;
  }

  const userId = event.user ?? "unknown";
  const userName = await resolveUserName(userId);

  let response: string;
  try {
    const result = await runAgent({
      customerKey,
      userMessage: text,
      source: "slack",
    });
    response = result.text || "(empty response)";
  } catch (err) {
    console.error("[slack] agent failed:", err);
    response = "Something went wrong on our side. Try again.";
  }

  await postMessage(channelId, mdToMrkdwn(response), {
    blocks: mdToBlocks(response),
    thread_ts: event.thread_ts,
  });

  try {
    await saveConversation(customerKey, {
      channel: channelId,
      user_id: userId,
      user_name: userName,
      user_message: text,
      bot_response: response,
    });
  } catch (err) {
    console.warn("[slack] saveConversation failed:", err);
  }
}

async function handleFileShared(event: SlackEvent): Promise<void> {
  const fileId = event.file?.id ?? event.file_id;
  const channelId = event.channel_id ?? event.channel ?? "";
  if (!fileId || !channelId) return;

  const customerKey = await customerKeyForChannel(channelId);
  if (!customerKey) return;

  let info;
  try {
    info = await fetchFile(fileId);
  } catch (err) {
    console.warn("[slack] fetchFile failed:", err);
    return;
  }
  const file = info.file ?? {};
  const url = file.url_private_download ?? file.url_private;
  if (!url) return;

  // We download the bytes here rather than passing the signed URL through,
  // because Slack's url_private requires the bot token; Inngest workers
  // wouldn't have the right auth context.
  let buffer: Buffer;
  try {
    buffer = await downloadSlackFile(url);
  } catch (err) {
    console.warn("[slack] file download failed:", err);
    return;
  }

  // Stash temporarily in Storage and hand off to Inngest.
  const { uploadFile, ensureBucket } = await import("@/lib/ingestion/storage");
  await ensureBucket();
  const tmpPath = await uploadFile(
    {
      customerKey,
      packageId: `slack-incoming-${fileId}`,
      filename: file.name ?? "slack-file",
      content: buffer,
      contentType: file.mimetype ?? "application/octet-stream",
    },
    "raw"
  );

  await inngest.send({
    name: "delivery-ops/document.uploaded",
    data: {
      customerKey,
      filename: file.name ?? "slack-file",
      mimeType: file.mimetype ?? "application/octet-stream",
      source: "slack",
      sourceDetail: `Slack channel ${channelId}`,
      storagePath: tmpPath,
    },
  });
}

const customerKeyCache = new Map<string, string | null>();

async function customerKeyForChannel(channelId: string): Promise<string | null> {
  if (customerKeyCache.has(channelId)) return customerKeyCache.get(channelId) ?? null;
  // We can't always resolve channel name from ID without a Slack API call —
  // do that lookup, then resolve via the customers table.
  let resolvedName = channelId;
  try {
    // Lazy import to keep this server-only; fetchHistory + similar live in
    // lib/slack/client. We just need conversations.info here.
    const res = await fetch("https://slack.com/api/conversations.info", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN ?? ""}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: channelId }),
    });
    const data = (await res.json()) as { ok: boolean; channel?: { name?: string } };
    if (data.ok && data.channel?.name) resolvedName = data.channel.name;
  } catch {
    /* fall through to using the raw ID — resolveCustomerFromChannel handles both */
  }

  const customer = await resolveCustomerFromChannel(resolvedName);
  // Only cache positive lookups. Caching null here means a transient failure
  // (missing scope, Slack 5xx, race against DB seed) gets baked in for the
  // life of the process and the bot silently drops every subsequent message.
  if (customer?.key) {
    customerKeyCache.set(channelId, customer.key);
  }
  return customer?.key ?? null;
}

const userNameCache = new Map<string, string>();

async function resolveUserName(userId: string): Promise<string> {
  if (!userId || userId === "unknown") return userId;
  const cached = userNameCache.get(userId);
  if (cached) return cached;
  try {
    const res = await fetchUserInfo(userId);
    const u = res.user ?? {};
    const name = u.real_name ?? u.profile?.display_name ?? u.name ?? userId;
    userNameCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}
