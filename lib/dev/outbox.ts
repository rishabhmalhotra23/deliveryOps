// Dev outbox — every outbound mock-mode action becomes a row in `events` so we
// can replay them, browse them at /dev/outbox, and verify the agent did the
// right thing without touching real Slack / Gmail / Drive.
//
// Storage strategy: we tag the event with `dev-outbox` + a per-kind tag and
// stash the structured payload under `details`. Reusing the events table
// avoids a parallel migration and means the dashboard's events feed shows
// dev outbox entries inline (which is exactly what we want during dev).

import { appendEvent } from "@/lib/events/events";
import { supabaseEnabled } from "@/lib/dev/mode";

export type OutboxKind =
  | "slack.message"
  | "slack.escalation"
  | "gmail.send"
  | "drive.upload"
  | "calendar.list";

export interface OutboxEntry {
  kind: OutboxKind;
  customerKey: string;
  summary: string;
  payload: Record<string, unknown>;
}

// In-memory fallback for the case where Supabase isn't running yet — keeps
// /dev/outbox working on a fresh clone before `supabase start`.
const memoryFallback: Array<OutboxEntry & { ts: string }> = [];

export async function recordOutbox(entry: OutboxEntry): Promise<void> {
  const ts = new Date();
  const tagBase = entry.kind.replace(".", "-");
  const summary = `[mock] ${entry.summary}`;

  if (supabaseEnabled()) {
    try {
      await appendEvent(
        entry.customerKey,
        "DEV_OUTBOX",
        { kind: entry.kind, ...entry.payload },
        {
          summary,
          tags: ["dev-outbox", tagBase],
          ts,
        }
      );
      return;
    } catch (err) {
      // Fall through to memory if Supabase is configured but the customer
      // doesn't exist yet — that's a useful UX for first-time setup.
      console.warn("[dev-outbox] supabase write failed, falling back to memory:", err);
    }
  }

  memoryFallback.push({ ...entry, summary, ts: ts.toISOString() });
  if (memoryFallback.length > 200) memoryFallback.shift();

  // Always log so an engineer running `npm run dev` sees the outbox without
  // needing to open the UI.
  console.log(
    `[dev-outbox] ${entry.kind} — ${entry.summary}\n  payload: ${JSON.stringify(entry.payload, null, 2).split("\n").join("\n  ")}`
  );
}

export function memoryOutbox(): Array<OutboxEntry & { ts: string }> {
  return [...memoryFallback].reverse();
}
