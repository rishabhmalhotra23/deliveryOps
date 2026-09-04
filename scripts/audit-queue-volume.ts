// Read-only. Measures how much work a "Today" queue would actually hold,
// before anyone designs one.
//
// This exists because the Platform IA plan (PLATFORM-IA-CLAUDE-CODE-PROMPT.md,
// PR 00) gates PR 04 on the answer: if Today would hold 40 items a day it
// needs ranking rules and a snooze model; if it holds one, Today is a card on
// Customers rather than a destination. The four sources it would assemble from
// are the four things counted below.
//
// It also checks the health of the signals themselves, which turned out to
// matter more than the volume: a source that is empty and a source that is
// stale look identical in a count, and two of these are one or the other.
//
// Run with:  npx tsx scripts/audit-queue-volume.ts
//
// Reads whatever .env.local points at, which is the local Supabase by
// default. That database lags production, so to measure the real queue point
// it at the production project for the duration of one run — every query here
// is a SELECT:
//
//   AUDIT_SUPABASE_URL=https://<ref>.supabase.co \
//   AUDIT_SUPABASE_SERVICE_ROLE_KEY=<key> \
//   npx tsx scripts/audit-queue-volume.ts

import "dotenv/config";
import "@/lib/supabase/ws-polyfill";

import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

import { createClient } from "@supabase/supabase-js";

const WINDOW_DAYS = 30;
const RENEWAL_HORIZON_DAYS = 90;
const STALE_DAYS = 30;

/** Event types a human would actually act on, as opposed to sync noise. Kept
 *  explicit rather than "everything": the IA plan makes "Changed overnight" a
 *  read-only stream precisely so it can't become a second to-do list, and
 *  that only works if the actionable subset is known. */
const ACTIONABLE_EVENT_TYPES = new Set([
  "escalation",
  "exception",
  "blocker",
  "churn_signal",
  "nps_detractor",
  "contact_change",
]);

function sb() {
  // AUDIT_* wins so a single run can be pointed at production without
  // editing .env.local and risking it being left that way.
  const url = process.env.AUDIT_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  console.log(`Reading ${url.replace(/\/\/([^.]{6})[^/]*/, "//$1…")}`);
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 42703 is "undefined_column". It means this database is behind on
 *  migrations, not that the query is wrong — the local Supabase is pre-0030
 *  and has no processes.deleted_at, which produces a bare Postgres error
 *  three frames deep. Worth naming, because the fix is a command. */
function explainSchemaMismatch(err: unknown): never {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42703") {
    console.error(
      [
        "",
        `This database is behind on migrations: ${e.message}`,
        "",
        "Either bring it up to date:",
        "    npm run db:start && npx tsx scripts/safe-migrate.ts",
        "",
        "or point this run at a database that already has them (read-only):",
        "    AUDIT_SUPABASE_URL=... AUDIT_SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/audit-queue-volume.ts",
        "",
      ].join("\n")
    );
    process.exit(2);
  }
  throw err;
}

const ACTIVE_LIFECYCLES = ["backlog", "upcoming", "discovery", "in_development", "uat", "on_hold"];

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

interface ApprovalRow {
  created_at: string;
  decided_at: string | null;
  kind: string;
  state: string;
}

/** Open-queue depth per day, reconstructed from create/decide timestamps —
 *  an approval counts against every day between the two. A plain
 *  `count(*) where state='pending'` would only ever describe today, which
 *  says nothing about whether the queue is usually deep. */
function openPerDay(rows: ApprovalRow[]): { day: string; open: number }[] {
  const out: { day: string; open: number }[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const day = dayKey(isoDaysAgo(i));
    const endOfDay = `${day}T23:59:59.999Z`;
    const open = rows.filter(
      (r) => r.created_at <= endOfDay && (r.decided_at == null || r.decided_at > endOfDay)
    ).length;
    out.push({ day, open });
  }
  return out;
}

function stat(values: number[]): { mean: number; max: number } {
  if (values.length === 0) return { mean: 0, max: 0 };
  return {
    mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    max: Math.max(...values),
  };
}

async function main() {
  const s = sb();
  const since = isoDaysAgo(WINDOW_DAYS);
  const horizon = new Date(Date.now() + RENEWAL_HORIZON_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [approvals, processes, opps, events, tasks, suggestions] = await Promise.all([
    s.from("pending_approvals").select("created_at, decided_at, kind, state"),
    s
      .from("processes")
      .select("id, lifecycle, blocked_on, updated_at, process_name")
      .is("deleted_at", null),
    s
      .from("sf_opportunities")
      .select("customer_id, close_date, amount, is_closed, stage_name")
      .eq("is_closed", false)
      .gte("close_date", today)
      .lte("close_date", horizon),
    s.from("events").select("ts, event_type").is("deleted_at", null),
    s.from("tasks").select("id, status").is("deleted_at", null),
    s.from("process_suggestions").select("id, status").eq("status", "open"),
  ]);
  for (const r of [approvals, processes, opps, events, tasks, suggestions]) {
    if (r.error) explainSchemaMismatch(r.error);
  }

  const approvalRows = (approvals.data as ApprovalRow[]) ?? [];
  const processRows =
    (processes.data as {
      id: string;
      lifecycle: string;
      blocked_on: string | null;
      updated_at: string;
      process_name: string;
    }[]) ?? [];
  const eventRows = (events.data as { ts: string; event_type: string }[]) ?? [];

  console.log(`\nQueue volume audit — ${WINDOW_DAYS}-day window, run ${today}\n${"=".repeat(58)}`);

  // ─── 1. Approvals ───────────────────────────────────────────────────────
  const daily = openPerDay(approvalRows);
  const { mean, max } = stat(daily.map((d) => d.open));
  const createdInWindow = approvalRows.filter((r) => r.created_at >= since).length;
  console.log(`\n1. Approvals (pending_approvals)`);
  console.log(`   rows in table, all time  : ${approvalRows.length}`);
  console.log(`   created in window        : ${createdInWindow}`);
  console.log(`   open per day             : mean ${mean}, max ${max}`);
  if (approvalRows.length === 0) {
    console.log(`   -> EMPTY. The approval queue has never been used, so Today's`);
    console.log(`      primary source contributes nothing today.`);
  }

  // ─── 2. Processes needing attention ─────────────────────────────────────
  const active = processRows.filter((p) => ACTIVE_LIFECYCLES.includes(p.lifecycle));
  const blocked = processRows.filter((p) => p.blocked_on && p.blocked_on !== "none");
  const staleCutoff = isoDaysAgo(STALE_DAYS);
  const stale = active.filter((p) => p.updated_at < staleCutoff);
  const both = blocked.filter((p) => stale.some((q) => q.id === p.id));
  console.log(`\n2. Processes needing attention`);
  console.log(`   active (in-flight)       : ${active.length}`);
  console.log(`   blocked_on set           : ${blocked.length}`);
  console.log(`   active + untouched >${STALE_DAYS}d : ${stale.length}`);
  console.log(`   counted twice (both)     : ${both.length}`);
  console.log(`   distinct queue items     : ${new Set([...blocked, ...stale].map((p) => p.id)).size}`);

  // ─── 3. Renewals ────────────────────────────────────────────────────────
  const oppRows = (opps.data as { close_date: string; amount: number | null }[]) ?? [];
  const renewalValue = oppRows.reduce((sum, o) => sum + (o.amount ?? 0), 0);
  console.log(`\n3. Renewals inside ${RENEWAL_HORIZON_DAYS}d (open sf_opportunities)`);
  console.log(`   count                    : ${oppRows.length}`);
  console.log(`   combined amount          : ${renewalValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`);

  // ─── 4. Events ──────────────────────────────────────────────────────────
  const inWindow = eventRows.filter((e) => e.ts >= since);
  const actionable = inWindow.filter((e) => ACTIONABLE_EVENT_TYPES.has(e.event_type));
  const newest = eventRows.reduce<string | null>((a, e) => (a == null || e.ts > a ? e.ts : a), null);
  const perNight = stat(
    Object.values(
      inWindow.reduce<Record<string, number>>((acc, e) => {
        const d = dayKey(e.ts);
        acc[d] = (acc[d] ?? 0) + 1;
        return acc;
      }, {})
    )
  );
  console.log(`\n4. Events ("Changed overnight")`);
  console.log(`   rows in table, all time  : ${eventRows.length}`);
  console.log(`   newest event             : ${newest ?? "—"}`);
  console.log(`   in window                : ${inWindow.length}`);
  console.log(`   per night (days with any): mean ${perNight.mean}, max ${perNight.max}`);
  console.log(`   of a kind a human acts on: ${actionable.length}`);
  if (inWindow.length === 0 && eventRows.length > 0) {
    const ageDays = newest ? Math.round((Date.now() - Date.parse(newest)) / 86_400_000) : 0;
    console.log(`   -> STALE, not empty: ${eventRows.length} rows exist but the newest is`);
    console.log(`      ${ageDays} days old. Nothing is writing to \`events\`.`);
  }

  // ─── 5. Signal health ───────────────────────────────────────────────────
  // updated_at is the input to the staleness number above, so a bulk write
  // that reset it would make item 2 read as zero regardless of reality. Worth
  // printing next to the number that depends on it.
  const touchedToday = processRows.filter((p) => dayKey(p.updated_at) === today).length;
  console.log(`\n5. Signal health`);
  console.log(`   tasks scheduled          : ${(tasks.data ?? []).length}`);
  console.log(`   open process suggestions : ${(suggestions.data ?? []).length}`);
  console.log(`   processes touched today  : ${touchedToday} of ${processRows.length}`);

  // ─── Verdict ────────────────────────────────────────────────────────────
  const queueToday =
    daily.at(-1)!.open +
    new Set([...blocked, ...stale].map((p) => p.id)).size +
    oppRows.length +
    (suggestions.data ?? []).length;
  console.log(`\n${"=".repeat(58)}`);
  console.log(`Today's queue, if built now: ~${queueToday} items`);
  console.log(
    `  ${daily.at(-1)!.open} approvals · ${new Set([...blocked, ...stale].map((p) => p.id)).size} processes · ${oppRows.length} renewals · ${(suggestions.data ?? []).length} suggestions`
  );
  console.log(
    `Daily inflow is what decides ranking/snooze, and it is driven by\napprovals and events — both of which are currently ${
      approvalRows.length === 0 && inWindow.length === 0 ? "contributing zero" : "live"
    }.\n`
  );
}

main().catch((err) => {
  explainSchemaMismatch(err);
});
