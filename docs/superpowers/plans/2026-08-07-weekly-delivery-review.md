# Weekly Delivery Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new report at `/reports/delivery-review` — customer-grouped, per-process detail, Done / Coming Up / Blocked, for the Delivery + Customer Success team only (not company-wide) — and retire the old `/reports/weekly` ("Delivery Update") it replaces, landing the platform at exactly two reports.

**Architecture:** One new loader (`lib/reports/delivery-review-loader.ts`) reads `processes` natively (same pattern as `lib/processes/loader.ts`, not through the Monday-legacy-string translation `weekly-loader.ts` uses — this is new UI with no old-UI compatibility constraint), tags each process Done/Coming Up/Blocked/Live for the selected period, groups by customer, and sorts customers by urgency. A separate "longest untouched" list flags active work that hasn't moved in 30+ days regardless of status tag.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase, Vitest.

## Global Constraints

- **Recommended order: run the All-Hands report plan (`2026-08-07-allhands-migration-report.md`) first.** Both plans touch `app/(app)/reports/page.tsx` (the catalog) and this plan deletes `lib/reports/weekly-loader.ts`; Task 1 and Task 5 below include guards for running this plan first anyway, but the guards are simpler if All-Hands has already landed.
- Approved layout reference: `docs/mockups/2026-08-07-delivery-review-layout.html` (customer-grouped structure) and `docs/mockups/2026-08-07-delivery-review-card-detail.html` (per-process card detail) — open both before building the UI task.
- Visual language: reuse the `.report-theme` CSS class from the All-Hands plan's Task 1. If that plan hasn't run yet, add the identical block to `app/globals.css` first (copy Task 1, Step 1 from that plan verbatim — it's the same tokens, no report-specific values).
- No PNG/print export for this report — internal working review, not a presented artifact (explicit call, confirmed with Rishabh 2026-08-07; revisit if he later wants to project it somewhere).
- Date range: only "Week" and "Custom" presets (simpler than the All-Hands report's four — this is a working review, not a flexible historical report).
- Run `npx tsc --noEmit`, `npx vitest run`, and `npm run build` after every task that touches TypeScript.

---

### Task 1: Ensure `.report-theme` CSS tokens exist

**Files:**
- Modify: `app/globals.css` (conditionally — see guard below)

- [ ] **Step 1: Check whether the tokens already exist**

Run: `grep -n "report-theme" app/globals.css`

If it prints a match, the All-Hands plan already added this — skip to Task 2. If it prints nothing, add the exact block from the All-Hands plan's Task 1, Step 1 (same file, same content — copy it verbatim so the two reports share one definition, not two drifting copies).

- [ ] **Step 2: Commit (only if Step 1 required a change)**

```bash
git add app/globals.css
git commit -m "reports: add scoped report-theme CSS tokens (shared with All-Hands report)"
```

---

### Task 2: Delivery Review derivation (pure function, unit-tested)

**Files:**
- Create: `lib/reports/delivery-review.ts`
- Test: `tests/reports/delivery-review.test.ts`

**Interfaces:**
- Consumes: `Process[]` (native, `lib/supabase/types.ts`), customer rows `{ id, key, display_name }`, `Map<string, { arr: number; renewal_date: string | null }>` (from `getConfirmedArrForCustomer`), a reference `now: Date` and period `{ start: Date; end: Date }`.
- Produces: `DeliveryReviewStatus`, `DeliveryReviewProcessItem`, `DeliveryReviewCustomerGroup`, `LongestUntouchedItem`, `buildDeliveryReview(...)`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/reports/delivery-review.test.ts
import { describe, it, expect } from "vitest";
import { buildDeliveryReview, statusForProcess } from "@/lib/reports/delivery-review";
import type { Process } from "@/lib/supabase/types";

function proc(overrides: Partial<Process>): Process {
  return {
    id: "p1", account: "Acme", customer_key: "acme", process_name: "Test Process",
    process_status: null, platform: "v1", migration_stage: "not_required",
    is_blocked: false, priority: null, fde_owner: null, engg_owner: null,
    date_parity_complete: null, date_customer_handover: null, date_customer_validation: null,
    go_live_date: null, completion_pct: null, effort_required: null, went_live_at: null,
    active_usage: null, customer_notified: null, customer_contact: null, blockers: null,
    notes: null, feature_delta: null, linear_ticket_ids: [], v2_workspace_url: null,
    arr: null, company_size: null, source_phase: null, source_board: null, updated_by: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    lifecycle: "in_development", phase: null, health: null, blocked_on: "none", work_mode: null,
    complexity: null, customer_id: "c1", k2_process_id: null, k2_workspace_id: null,
    kickoff_date: null, ttv_days: null, tam_owner: null, partner: null,
    total_effort_hours: null, value_minutes_saved_per_run: null, value_basis: null,
    value_confirmed_by: null, value_confirmed_at: null, reviewed_at: null, reviewed_by: null,
    field_provenance: {}, source_system: null, source_item_id: null, source_raw: {},
    needs_attention: false, needs_attention_reason: null,
    ...overrides,
  };
}
const PERIOD = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-07T23:59:59Z") };

describe("statusForProcess", () => {
  it("tags a process that went live within the period as done", () => {
    expect(statusForProcess(proc({ lifecycle: "live", go_live_date: "2026-08-03" }), PERIOD)).toBe("done");
  });

  it("tags an already-live process outside the period as live (steady state)", () => {
    expect(statusForProcess(proc({ lifecycle: "live", go_live_date: "2026-05-01" }), PERIOD)).toBe("live");
  });

  it("tags a blocked_on process as blocked regardless of lifecycle", () => {
    expect(statusForProcess(proc({ lifecycle: "in_development", blocked_on: "customer" }), PERIOD)).toBe("blocked");
  });

  it("tags an at-risk or off-track process as blocked", () => {
    expect(statusForProcess(proc({ health: "at_risk" }), PERIOD)).toBe("blocked");
    expect(statusForProcess(proc({ health: "off_track" }), PERIOD)).toBe("blocked");
  });

  it("tags active non-blocked work as coming_up", () => {
    expect(statusForProcess(proc({ lifecycle: "uat" }), PERIOD)).toBe("coming_up");
    expect(statusForProcess(proc({ lifecycle: "backlog" }), PERIOD)).toBe("coming_up");
  });

  it("returns null for archived work (cancelled/churned/retired) — excluded entirely", () => {
    expect(statusForProcess(proc({ lifecycle: "cancelled" }), PERIOD)).toBeNull();
    expect(statusForProcess(proc({ lifecycle: "churned" }), PERIOD)).toBeNull();
    expect(statusForProcess(proc({ lifecycle: "retired" }), PERIOD)).toBeNull();
  });
});

describe("buildDeliveryReview", () => {
  const customers = [{ id: "c1", key: "acme", display_name: "Acme" }, { id: "c2", key: "beta", display_name: "Beta Corp" }];
  const arrByCustomer = new Map([
    ["c1", { arr: 94000, renewal_date: "2026-08-25" }], // 18 days out
    ["c2", { arr: 41000, renewal_date: null }],
  ]);

  it("groups processes by customer and sorts blocked-first, then by renewal proximity", () => {
    const processes = [
      proc({ id: "p1", customer_id: "c2", lifecycle: "uat" }),
      proc({ id: "p2", customer_id: "c1", blocked_on: "customer" }),
    ];
    const now = new Date("2026-08-07T00:00:00Z");
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, now);
    expect(result.customerGroups.map((g) => g.customerKey)).toEqual(["acme", "beta"]);
    expect(result.customerGroups[0].hasBlocked).toBe(true);
  });

  it("omits customers with no non-archived work in the tagged set", () => {
    const processes = [proc({ id: "p1", customer_id: "c1", lifecycle: "cancelled" })];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07"));
    expect(result.customerGroups).toEqual([]);
  });

  it("computes renewalInDays from the confirmed-ARR map, null when no renewal date", () => {
    const processes = [proc({ id: "p1", customer_id: "c1" }), proc({ id: "p2", customer_id: "c2" })];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07T00:00:00Z"));
    const acme = result.customerGroups.find((g) => g.customerKey === "acme");
    const beta = result.customerGroups.find((g) => g.customerKey === "beta");
    expect(acme?.renewalInDays).toBe(18);
    expect(beta?.renewalInDays).toBeNull();
  });

  it("flags the longest-untouched list — active, non-archived, updated 30+ days ago, oldest first", () => {
    const processes = [
      proc({ id: "p1", customer_id: "c1", process_name: "Old One", updated_at: "2026-06-01T00:00:00Z" }),
      proc({ id: "p2", customer_id: "c1", process_name: "Recent One", updated_at: "2026-08-05T00:00:00Z" }),
      proc({ id: "p3", customer_id: "c1", process_name: "Older One", lifecycle: "live", updated_at: "2026-05-01T00:00:00Z" }), // live — excluded, not "active" work
    ];
    const result = buildDeliveryReview(processes, customers, arrByCustomer, PERIOD, new Date("2026-08-07T00:00:00Z"));
    expect(result.longestUntouched.map((i) => i.processName)).toEqual(["Old One"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reports/delivery-review.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// lib/reports/delivery-review.ts
//
// Weekly Delivery Review — customer-grouped, per-process detail, for the
// Delivery + Customer Success team (Rishabh, 2026-08-07: "club customers'
// work and data together" — grouping by customer, not by status bucket,
// after seeing both laid out). Reads `processes` natively, no Monday-legacy
// translation needed since this is new UI.

import type { Process, ProcessBlockedOn } from "@/lib/supabase/types";

export type DeliveryReviewStatus = "done" | "coming_up" | "blocked" | "live";

export interface Period {
  start: Date;
  end: Date;
}

const ARCHIVE_LIFECYCLES = new Set(["cancelled", "churned", "retired"]);

function inPeriod(iso: string | null, period: Period): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= period.start && d <= period.end;
}

/** Per-process status for this report. Blocked beats everything else — a
 *  process that is technically "live" but flagged at_risk still needs
 *  attention. Archived lifecycles return null: excluded entirely, they're
 *  not part of a "what's happening right now" review. */
export function statusForProcess(p: Process, period: Period): DeliveryReviewStatus | null {
  if (ARCHIVE_LIFECYCLES.has(p.lifecycle)) return null;
  if (p.blocked_on !== "none" || p.health === "at_risk" || p.health === "off_track" || p.needs_attention) {
    return "blocked";
  }
  if (p.lifecycle === "live") {
    return inPeriod(p.go_live_date, period) || inPeriod(p.went_live_at, period) ? "done" : "live";
  }
  return "coming_up";
}

const BLOCKED_ON_LABEL: Record<ProcessBlockedOn, string> = {
  none: "",
  customer: "Blocked on customer",
  kognitos_engg: "Blocked on engineering",
  kognitos_delivery: "Blocked on delivery",
  partner: "Blocked on partner",
};

export interface DeliveryReviewProcessItem {
  id: string;
  name: string;
  status: DeliveryReviewStatus;
  phase: string | null;
  complexity: string | null;
  platform: string;
  goLiveDate: string | null;
  kickoffDate: string | null;
  ttvDays: number | null;
  blockedReasonLabel: string | null; // e.g. "Blocked on customer" — null when not blocked
  blockedNote: string | null; // free-text from Process.blockers
  daysSinceUpdate: number;
  linkedTicketIds: string[];
}

function toItem(p: Process, status: DeliveryReviewStatus, now: Date): DeliveryReviewProcessItem {
  return {
    id: p.id,
    name: p.process_name,
    status,
    phase: p.phase,
    complexity: p.complexity,
    platform: p.platform,
    goLiveDate: p.go_live_date,
    kickoffDate: p.kickoff_date,
    ttvDays: p.ttv_days,
    blockedReasonLabel: status === "blocked" && p.blocked_on !== "none" ? BLOCKED_ON_LABEL[p.blocked_on] : null,
    blockedNote: p.blockers,
    daysSinceUpdate: Math.floor((now.getTime() - new Date(p.updated_at).getTime()) / 86_400_000),
    linkedTicketIds: p.linear_ticket_ids,
  };
}

export interface DeliveryReviewCustomerGroup {
  customerKey: string;
  customerName: string;
  arr: number;
  renewalInDays: number | null;
  hasBlocked: boolean;
  processes: DeliveryReviewProcessItem[];
}

export interface LongestUntouchedItem {
  customerName: string;
  processName: string;
  daysSinceUpdate: number;
  lifecycle: string;
}

export interface DeliveryReviewReport {
  customerGroups: DeliveryReviewCustomerGroup[];
  longestUntouched: LongestUntouchedItem[];
}

const STALE_THRESHOLD_DAYS = 30;
const LONGEST_UNTOUCHED_MAX = 10;

export function buildDeliveryReview(
  processes: Process[],
  customers: Array<{ id: string; key: string; display_name: string }>,
  arrByCustomer: Map<string, { arr: number; renewal_date: string | null }>,
  period: Period,
  now: Date
): DeliveryReviewReport {
  const custById = new Map(customers.map((c) => [c.id, c]));
  const itemsByCustomer = new Map<string, DeliveryReviewProcessItem[]>();

  for (const p of processes) {
    if (!p.customer_id) continue;
    const status = statusForProcess(p, period);
    if (!status) continue;
    const list = itemsByCustomer.get(p.customer_id) ?? [];
    list.push(toItem(p, status, now));
    itemsByCustomer.set(p.customer_id, list);
  }

  const customerGroups: DeliveryReviewCustomerGroup[] = [];
  for (const [customerId, items] of itemsByCustomer) {
    const customer = custById.get(customerId);
    if (!customer) continue;
    const arr = arrByCustomer.get(customerId);
    const renewalInDays = arr?.renewal_date
      ? Math.round((new Date(arr.renewal_date).getTime() - now.getTime()) / 86_400_000)
      : null;
    customerGroups.push({
      customerKey: customer.key,
      customerName: customer.display_name,
      arr: arr?.arr ?? 0,
      renewalInDays,
      hasBlocked: items.some((i) => i.status === "blocked"),
      processes: items,
    });
  }

  customerGroups.sort((a, b) => {
    if (a.hasBlocked !== b.hasBlocked) return a.hasBlocked ? -1 : 1;
    if (a.renewalInDays != null && b.renewalInDays != null) return a.renewalInDays - b.renewalInDays;
    if (a.renewalInDays != null) return -1;
    if (b.renewalInDays != null) return 1;
    return a.customerName.localeCompare(b.customerName);
  });

  const longestUntouched: LongestUntouchedItem[] = processes
    .filter((p) => !ARCHIVE_LIFECYCLES.has(p.lifecycle) && p.lifecycle !== "live")
    .map((p) => ({
      customerName: custById.get(p.customer_id ?? "")?.display_name ?? p.account,
      processName: p.process_name,
      daysSinceUpdate: Math.floor((now.getTime() - new Date(p.updated_at).getTime()) / 86_400_000),
      lifecycle: p.lifecycle,
    }))
    .filter((i) => i.daysSinceUpdate >= STALE_THRESHOLD_DAYS)
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, LONGEST_UNTOUCHED_MAX);

  return { customerGroups, longestUntouched };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/delivery-review.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reports/delivery-review.ts tests/reports/delivery-review.test.ts
git commit -m "reports: customer-grouped Done/Coming Up/Blocked derivation for Delivery Review"
```

---

### Task 3: Compose the Delivery Review loader

**Files:**
- Create: `lib/reports/delivery-review-loader.ts`

**Interfaces:**
- Consumes: `buildDeliveryReview()` (Task 2), `resolveRange()`/`RangeRequest` (`lib/reports/date-range.ts` — from the All-Hands plan's Task 2; if that plan hasn't run, do that task first here instead of duplicating it), `getConfirmedArrForCustomer()`.
- Produces: `loadDeliveryReview(req?: RangeRequest): Promise<DeliveryReviewReport & { range: DateRange; generatedAt: string }>`. Consumed by Task 4.

- [ ] **Step 1: Confirm the date-range module exists**

Run: `test -f lib/reports/date-range.ts && echo exists || echo missing`

If `missing`, stop and run Task 2 of the All-Hands report plan (`docs/superpowers/plans/2026-08-07-allhands-migration-report.md`) first — this plan depends on it and duplicating that module would create two drifting copies of the same logic.

- [ ] **Step 2: Implement**

```typescript
// lib/reports/delivery-review-loader.ts
import { requireAdmin } from "@/lib/supabase/server";
import { resolveRange, type DateRange, type RangeRequest } from "@/lib/reports/date-range";
import { buildDeliveryReview, type DeliveryReviewReport } from "@/lib/reports/delivery-review";
import { getConfirmedArrForCustomer } from "@/lib/commercials/confirmed-arr";
import type { Process } from "@/lib/supabase/types";

export interface DeliveryReviewLoaderResult extends DeliveryReviewReport {
  range: DateRange;
  generatedAt: string;
}

export async function loadDeliveryReview(req: RangeRequest = {}): Promise<DeliveryReviewLoaderResult> {
  const sb = requireAdmin();
  const range = resolveRange(req);
  const now = new Date();

  const [processesRes, customersRes, oppsRes] = await Promise.all([
    sb.from("processes").select("*"),
    sb.from("customers").select("id, key, display_name").is("deleted_at", null),
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed"),
  ]);

  type CustomerRow = { id: string; key: string; display_name: string };
  const customers = (customersRes.data as CustomerRow[] | null) ?? [];

  type OppRow = { customer_id: string; amount: number | null; close_date: string | null; is_won: boolean; is_closed: boolean };
  const oppsByCustomer = new Map<string, OppRow[]>();
  for (const o of (oppsRes.data as OppRow[] | null) ?? []) {
    const list = oppsByCustomer.get(o.customer_id) ?? [];
    list.push(o);
    oppsByCustomer.set(o.customer_id, list);
  }
  const arrByCustomer = new Map(
    customers.map((c) => [c.id, getConfirmedArrForCustomer(c.key, oppsByCustomer.get(c.id) ?? [])])
  );

  const processes = (processesRes.data as Process[] | null) ?? [];
  const report = buildDeliveryReview(processes, customers, arrByCustomer, { start: range.start, end: range.end }, now);

  return { ...report, range, generatedAt: now.toISOString() };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/reports/delivery-review-loader.ts
git commit -m "reports: compose the Delivery Review loader"
```

---

### Task 4: Build the Delivery Review page and client component

**Files:**
- Create: `app/(app)/reports/delivery-review/page.tsx`
- Create: `app/(app)/reports/delivery-review/delivery-review-client.tsx`

**Interfaces:**
- Consumes: `DeliveryReviewLoaderResult` (Task 3).

- [ ] **Step 1: Open the approved layout references**

`docs/mockups/2026-08-07-delivery-review-layout.html` for the customer-grouped page structure (header with Week/Custom picker, then one card per customer, sorted blocked-first then renewal-proximity, then a "longest untouched" strip at the bottom) and `docs/mockups/2026-08-07-delivery-review-card-detail.html` for the richer per-process card fields inside each customer group (phase/complexity/platform chips, the customer-context row with ARR + renewal, the blocked reason + linked ticket chips).

- [ ] **Step 2: Write the client component**

```typescript
// app/(app)/reports/delivery-review/delivery-review-client.tsx
"use client";

import type { DeliveryReviewLoaderResult } from "@/lib/reports/delivery-review-loader";

const STATUS_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  done: { text: "Done", bg: "#4ADE80", fg: "#171717" },
  coming_up: { text: "Coming up", bg: "#60A5FA", fg: "#171717" },
  blocked: { text: "Blocked", bg: "#F87171", fg: "#171717" },
  live: { text: "Live", bg: "#1F1F1F", fg: "#A3A3A3" },
};

export function DeliveryReviewClient({ report }: { report: DeliveryReviewLoaderResult }) {
  return (
    <div className="report-theme rounded-2xl p-6">
      {/* Header: Week/Custom picker (same client-side pattern as the All-Hands
          report's date picker — reuse RangePreset, no "Month"/"Quarter" options
          here per the global constraint above). No export button — this report
          has no PNG export. */}

      {/* One card per report.customerGroups entry, in the order the loader
          already sorted them (blocked-first, then renewal proximity, then
          alphabetical) — do not re-sort in the component. Customer header row:
          name, ARR, and renewalInDays badge (omit the renewal badge entirely
          when renewalInDays is null — no "no renewal" placeholder). Inside,
          one row per process in g.processes, showing STATUS_LABEL[item.status]
          as the trailing pill, phase/complexity/platform as leading chips, and
          — only when item.status === "blocked" — the blockedReasonLabel,
          daysSinceUpdate, blockedNote, and linkedTicketIds (as chips linking to
          https://linear.app/kognitos/issue/${id}) beneath the process name,
          matching the card-detail mockup. */}

      {/* Footer: report.longestUntouched as a compact list — "{processName} —
          {customerName} — {daysSinceUpdate} days, {lifecycle}". Render nothing
          if the array is empty (don't show an empty section header). */}
    </div>
  );
}
```

Fill in each commented block per the two mockup files — do not invent new spacing/color values, reuse the `--rt-*` tokens.

- [ ] **Step 3: Write the page**

```typescript
// app/(app)/reports/delivery-review/page.tsx
import { BackButton } from "@/app/_components/back-button";
import { loadDeliveryReview } from "@/lib/reports/delivery-review-loader";
import { DeliveryReviewClient } from "./delivery-review-client";
import type { RangePreset } from "@/lib/reports/date-range";

export const dynamic = "force-dynamic";

export default async function DeliveryReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const preset = (params.preset as RangePreset | undefined) ?? "week";
  const report = await loadDeliveryReview({ preset, from: params.from, to: params.to });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <DeliveryReviewClient report={report} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. Confirm `/reports/delivery-review` appears in the build's route list.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/reports/delivery-review"
git commit -m "reports: build /reports/delivery-review — customer-grouped delivery review"
```

---

### Task 5: Retire the old `/reports/weekly` report

**Files:**
- Delete: `app/(app)/reports/weekly/` (entire directory — page + client components)
- Delete: `lib/reports/weekly-loader.ts` (conditionally — see guard)
- Modify: `app/(app)/reports/page.tsx` (only if the All-Hands plan hasn't already updated it)

**Interfaces:** Removes `loadWeeklyBundle`, `WeeklyBundle`, `WeeklyProject` — confirm nothing outside the deleted directory still imports them before deleting.

- [ ] **Step 1: Confirm no other importers**

Run: `grep -rln "weekly-loader\|loadWeeklyBundle" app lib --include=*.ts --include=*.tsx`
Expected: only files under `app/(app)/reports/weekly/`. If anything else appears (e.g. an agent tool), stop and check whether that caller should move to `lib/reports/delivery-review-loader.ts` or `lib/reports/allhands-loader.ts` instead before deleting.

- [ ] **Step 2: Delete the old report**

```bash
rm -rf "app/(app)/reports/weekly"
rm lib/reports/weekly-loader.ts
```

- [ ] **Step 3: Update the Reports catalog**

Run: `grep -n '"delivery-review"' "app/(app)/reports/page.tsx"`

If it finds a match, the All-Hands plan's Task 9 already added the two-card catalog — nothing to do here. If it finds nothing, apply the All-Hands plan's Task 9 in full now (replace `REPORT_CARDS` with the two-entry array shown there).

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors, and the build's route list no longer includes `/reports/weekly`.

- [ ] **Step 5: Commit**

```bash
git add -A "app/(app)/reports" lib/reports/weekly-loader.ts 2>/dev/null
git commit -m "reports: retire /reports/weekly — replaced by Weekly Delivery Review"
```

---

### Task 6: Verify against production

**Files:** None (verification only).

- [ ] **Step 1: Run the loader live against production**

```typescript
// scripts/tmp-verify-delivery-review.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.cloud", override: true });

async function main() {
  const { loadDeliveryReview } = await import("../lib/reports/delivery-review-loader");
  const report = await loadDeliveryReview({ preset: "week" });
  console.log(`Customer groups: ${report.customerGroups.length}`);
  console.log(`Longest untouched: ${report.longestUntouched.length}`);
  console.log(JSON.stringify(report.customerGroups.slice(0, 2), null, 2));
}
main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
```

Run: `npx tsx scripts/tmp-verify-delivery-review.ts`
Expected: no exceptions. Sanity-check: customer group count should be well under the full 28-customer roster (only customers with active/blocked/recent work show); at least one group should have `hasBlocked: true` given production currently has active blocked work (confirmed 2026-08-07: 8 of 39 active processes have `blocked_on != 'none'`).

- [ ] **Step 2: Delete the throwaway script**

```bash
rm scripts/tmp-verify-delivery-review.ts
```

- [ ] **Step 3: Push and confirm the Vercel deployment reaches READY**

```bash
git push origin main
```

Then check the deployment status via the Vercel connector (project "delivery-ops") until it reports `READY`.
