import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import { listEvents } from "@/lib/events/events";
import type { CuratorEvent } from "@/lib/supabase/types";
import { memoryOutbox } from "@/lib/dev/outbox";

export const dynamic = "force-dynamic";

export default async function DevOutboxPage() {
  let customers: Awaited<ReturnType<typeof listCustomers>> = [];
  let supabaseError: string | null = null;
  try {
    customers = await listCustomers();
  } catch (err) {
    supabaseError = err instanceof Error ? err.message : String(err);
  }

  const allEntries: Array<{
    customerKey: string;
    kind: string;
    summary: string;
    payload: Record<string, unknown>;
    ts: string;
  }> = [];

  if (!supabaseError) {
    for (const c of customers) {
      let events: CuratorEvent[] = [];
      try {
        events = await listEvents(c.key, { eventType: "DEV_OUTBOX", limit: 100 });
      } catch {
        continue;
      }
      for (const e of events) {
        const details = (e.details ?? {}) as Record<string, unknown>;
        allEntries.push({
          customerKey: c.key,
          kind: String(details.kind ?? "unknown"),
          summary: e.summary.replace(/^\[mock\]\s*/, ""),
          payload: details,
          ts: e.ts,
        });
      }
    }
  }

  // Merge in-memory outbox entries (used as fallback when Supabase isn't up yet).
  for (const m of memoryOutbox()) {
    allEntries.push({
      customerKey: m.customerKey,
      kind: m.kind,
      summary: m.summary.replace(/^\[mock\]\s*/, ""),
      payload: m.payload,
      ts: m.ts,
    });
  }

  allEntries.sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="space-y-4">
      <div className="text-sm text-[color:var(--brand-gray)]">
        Every Slack message, email, and Drive upload that&rsquo;s currently being routed through the
        mock layer. When you wire real tokens in <code>.env.local</code>, future entries hit the real
        API instead and stop appearing here.
      </div>

      {supabaseError ? (
        <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
          <div className="font-medium mb-1">Supabase isn&rsquo;t reachable.</div>
          <p className="text-[color:var(--brand-gray)]">{supabaseError}</p>
        </div>
      ) : null}

      {allEntries.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-6 text-sm text-[color:var(--brand-gray)]">
          Outbox is empty. Hit{" "}
          <Link href="/dev/simulate" className="underline">
            Simulate inbound
          </Link>{" "}
          and send a fake Slack message — once the agent responds, its reply lands here.
        </div>
      ) : (
        <ul className="space-y-2">
          {allEntries.map((e, idx) => (
            <li
              key={`${e.ts}-${idx}`}
              className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm"
            >
              <div className="flex justify-between gap-3">
                <span className="font-medium">{e.summary}</span>
                <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
                  {new Date(e.ts).toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-[color:var(--brand-gray)] mt-1">
                {e.kind} · {e.customerKey}
              </div>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]">
                  payload
                </summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
