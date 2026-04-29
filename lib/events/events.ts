// Append-only event log. Port of legacy/storage/event_log.py — JSONL files
// become typed Postgres rows, week_key is computed in JS instead of disk paths.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type CuratorEvent, type EventType } from "@/lib/supabase/types";
import { requireCustomerByKey } from "@/lib/customers";

export function weekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function appendEvent(
  customerKey: string,
  eventType: EventType | string,
  details: Record<string, unknown> = {},
  opts: { summary?: string; tags?: string[]; ts?: Date } = {}
): Promise<CuratorEvent> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();
  const ts = opts.ts ?? new Date();

  const { data, error } = await sb
    .from(TABLES.events)
    .insert({
      customer_id: customer.id,
      event_type: eventType,
      summary: opts.summary ?? eventType,
      details,
      tags: opts.tags ?? [],
      week_key: weekKey(ts),
      ts: ts.toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CuratorEvent;
}

export interface ListEventsOpts {
  limit?: number;
  before?: Date;
  weekKey?: string;
  eventType?: string;
  tags?: string[];
}

export async function listEvents(
  customerKey: string,
  opts: ListEventsOpts = {}
): Promise<CuratorEvent[]> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  let q = sb
    .from(TABLES.events)
    .select("*")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .order("ts", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));

  if (opts.before) q = q.lt("ts", opts.before.toISOString());
  if (opts.weekKey) q = q.eq("week_key", opts.weekKey);
  if (opts.eventType) q = q.eq("event_type", opts.eventType);
  if (opts.tags?.length) q = q.contains("tags", opts.tags);

  const { data, error } = await q;
  if (error) throw error;
  return (data as CuratorEvent[]) ?? [];
}
