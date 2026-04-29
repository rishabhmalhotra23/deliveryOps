// Slack Web API client — lightweight wrapper around the public REST endpoints.
// Replaces the Bolt SDK from the Python service. All calls are server-only.
//
// Dev-mode behaviour: when SLACK_BOT_TOKEN is missing, every outbound call
// falls back to the dev outbox (lib/dev/outbox.ts). Inbound (events route)
// signature verification is bypassed by /api/slack/events when no signing
// secret is set in non-prod.

import { recordOutbox } from "@/lib/dev/outbox";
import { slackEnabled } from "@/lib/dev/mode";

const SLACK_API = "https://slack.com/api";

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("Missing SLACK_BOT_TOKEN.");
  return t;
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function call<T extends SlackResponse>(
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error ?? res.status}`);
  }
  return data;
}

const channelIdCache = new Map<string, string>();

export async function resolveChannelId(channel: string): Promise<string> {
  const trimmed = channel.replace(/^#/, "");
  if (/^[CD][A-Z0-9]+$/.test(trimmed)) return trimmed;
  if (!slackEnabled()) return trimmed;

  const cached = channelIdCache.get(trimmed);
  if (cached) return cached;

  let cursor: string | undefined;
  while (true) {
    const data = await call<SlackResponse & { channels: { id: string; name: string }[]; response_metadata?: { next_cursor?: string } }>(
      "conversations.list",
      {
        types: "public_channel,private_channel",
        limit: 200,
        exclude_archived: true,
        cursor,
      }
    );
    for (const ch of data.channels ?? []) {
      channelIdCache.set(ch.name, ch.id);
      if (ch.name === trimmed) return ch.id;
    }
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  throw new Error(`Slack channel not found: ${trimmed}`);
}

export async function postMessage(
  channel: string,
  text: string,
  opts: { blocks?: unknown[]; thread_ts?: string; customerKey?: string } = {}
): Promise<{ ts: string; channel: string }> {
  if (!slackEnabled()) {
    await recordOutbox({
      kind: "slack.message",
      customerKey: opts.customerKey ?? "unknown",
      summary: `Slack post → #${channel.replace(/^#/, "")}: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`,
      payload: {
        channel,
        text,
        blocks: opts.blocks ?? null,
        thread_ts: opts.thread_ts ?? null,
      },
    });
    return { ts: `mock-${Date.now()}`, channel };
  }

  const channelId = await resolveChannelId(channel);
  const data = await call<SlackResponse & { ts: string; channel: string }>("chat.postMessage", {
    channel: channelId,
    text,
    blocks: opts.blocks,
    thread_ts: opts.thread_ts,
  });
  return { ts: data.ts, channel: data.channel };
}

export async function fetchHistory(channel: string, limit: number = 25) {
  if (!slackEnabled()) {
    return { ok: true as const, messages: [] };
  }
  const channelId = await resolveChannelId(channel);
  return await call<
    SlackResponse & { messages: Array<{ ts: string; user?: string; text?: string }> }
  >("conversations.history", { channel: channelId, limit: Math.min(Math.max(limit, 1), 100) });
}

export async function fetchUserInfo(userId: string) {
  if (!slackEnabled()) {
    return { ok: true as const, user: { real_name: userId, name: userId } };
  }
  return await call<SlackResponse & { user: { real_name?: string; profile?: { display_name?: string }; name?: string } }>(
    "users.info",
    { user: userId }
  );
}

export async function fetchFile(fileId: string) {
  if (!slackEnabled()) {
    return { ok: true as const, file: {} };
  }
  return await call<SlackResponse & { file: { url_private?: string; url_private_download?: string; name?: string; mimetype?: string } }>(
    "files.info",
    { file: fileId }
  );
}

export async function downloadSlackFile(url: string): Promise<Buffer> {
  if (!slackEnabled()) {
    throw new Error("downloadSlackFile called without SLACK_BOT_TOKEN — use the dev simulator at /dev/simulate to upload files instead.");
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
