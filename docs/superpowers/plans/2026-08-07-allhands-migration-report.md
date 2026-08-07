# All-Hands Migration Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/reports/v2-migration` into the company's one official All-Hands report — live `processes`/Linear data instead of two hand-maintained files, five sections (portfolio & migration status, cumulative migration progress since program start, upcoming-renewal spotlight, this week's blockers, ticket health), same PNG/print export, then retire the old report catalog down to two cards.

**Architecture:** One new loader (`lib/reports/allhands-loader.ts`) composes three already-live sources — `loadV2MigrationOverview()` (processes), `loadTicketsBundle()` (Linear tickets + team_asks), and a new pure derivation for the cumulative-progress chart from each process's own milestone dates. A new client component replaces the two files that read the old hand-written data. The date-range picker is extracted into a shared module so the second report (Weekly Delivery Review, separate plan) can reuse it.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (service-role reads via `requireAdmin()`), Vitest, `html-to-image` (existing PNG export dependency).

## Global Constraints

- Visual language: dark-primary "Bold Brand-Forward" tokens, scoped to this report via a new `.report-theme` CSS class (do NOT touch the app's existing `.dark` class — that's a separate, pre-existing generic dark mode with different literal color values; reconciling the two is Stage A work, out of scope here).
- Approved layout reference: `docs/mockups/2026-08-07-allhands-report-layout.html` — open this in a browser before building the UI task. Real content differs (illustrative numbers in the mockup), but section order, grouping, and card structure are final.
- No new database migration needed — every field this report reads already exists (`processes`, `linear_tickets`, `team_asks`, `customers`, `sf_opportunities`).
- Every loader function is server-only (`requireAdmin()`), matching the existing pattern in `lib/processes/loader.ts` and `lib/reports/weekly-loader.ts`.
- Run `npx tsc --noEmit`, `npx vitest run`, and `npm run build` after every task that touches TypeScript — do not move to the next task if any fail.

---

### Task 1: Add report-theme CSS tokens

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Produces: CSS custom properties consumed by every component in Task 6 — `--rt-bg`, `--rt-surface-1`, `--rt-surface-2`, `--rt-fg`, `--rt-fg-muted`, `--rt-fg-body`, `--rt-accent`, `--rt-status-good`, `--rt-status-warn`, `--rt-status-bad`, all scoped under a `.report-theme` class.

- [ ] **Step 1: Append the new class block**

Add this after the existing `.dark` block (after the closing brace that follows the `.dark input[type="date"], .dark textarea { ... }` rule, i.e. after the native-form-controls dark overrides — search for `color-scheme: dark;` to find the `.dark` block and insert after the whole block, not inside it):

```css
/* ─── Report theme — scoped dark palette for the two live reports (All-Hands,
   Weekly Delivery Review). Deliberately NOT merged into `.dark` above: that
   class is the app's existing generic dark-mode toggle with different literal
   values (#0d0d12 bg, #ECECF1 fg) and touching it would reskin every page a
   user has toggled to dark, which is Stage A's job, not this report's.
   Approved direction: docs/superpowers/specs/2026-08-07-app-design-foundation-design.md,
   validated against real UI in docs/mockups/2026-08-07-visual-direction-approved.html. */
.report-theme {
  --rt-bg:            #171717;
  --rt-surface-1:      #262626;
  --rt-surface-2:      #1F1F1F;
  --rt-fg:            #FAFAFA;
  --rt-fg-muted:      #A3A3A3;
  --rt-fg-body:        #D4D4D4;
  --rt-accent:        #F2FF70;
  --rt-status-good:    #4ADE80;
  --rt-status-warn:    #FB923C;
  --rt-status-bad:     #F87171;
  background: var(--rt-bg);
  color: var(--rt-fg);
  color-scheme: dark;
}
```

- [ ] **Step 2: Verify the build still compiles**

Run: `npm run build`
Expected: succeeds (CSS-only change, no functional risk, but confirms no syntax error broke the stylesheet).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "reports: add scoped report-theme CSS tokens for the two live reports"
```

---

### Task 2: Extract the shared date-range module

**Files:**
- Create: `lib/reports/date-range.ts`
- Modify: `lib/reports/weekly-loader.ts:1-112` (remove the moved code, import from the new module instead)
- Test: `tests/reports/date-range.test.ts`

**Interfaces:**
- Produces: `RangePreset` (`"week" | "month" | "quarter" | "custom"`), `DateRange { start: Date; end: Date; preset: RangePreset; label: string; cadenceLabel: string }`, `RangeRequest { preset?: RangePreset; from?: string; to?: string }`, `resolveRange(req?: RangeRequest, now?: Date): DateRange`. Consumed by Task 6 (this plan) and by the Weekly Delivery Review plan.

- [ ] **Step 1: Write the failing test (copy of weekly-loader's existing behavior, now targeting the new module)**

```typescript
// tests/reports/date-range.test.ts
import { describe, it, expect } from "vitest";
import { resolveRange } from "@/lib/reports/date-range";

describe("resolveRange", () => {
  it("defaults to a rolling 7-day window ending now", () => {
    const now = new Date("2026-08-07T14:30:00Z");
    const range = resolveRange({}, now);
    expect(range.preset).toBe("week");
    expect(range.end).toEqual(now);
    expect(range.start.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("resolves a custom range from from/to query strings", () => {
    const now = new Date("2026-08-07T14:30:00Z");
    const range = resolveRange({ preset: "custom", from: "2026-08-01", to: "2026-08-05" }, now);
    expect(range.preset).toBe("custom");
    expect(range.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-05T23:59:59.999Z");
  });

  it("falls back to the week default when custom range is missing from/to", () => {
    const now = new Date("2026-08-07T14:30:00Z");
    const range = resolveRange({ preset: "custom" }, now);
    expect(range.preset).toBe("week");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reports/date-range.test.ts`
Expected: FAIL — `Cannot find module '@/lib/reports/date-range'`

- [ ] **Step 3: Create the module (moved verbatim from `lib/reports/weekly-loader.ts` lines 27-112, unchanged logic)**

```typescript
// lib/reports/date-range.ts
//
// Shared date-range resolution for every report that supports a week /
// month / quarter / custom picker. Moved out of weekly-loader.ts so the
// All-Hands and Weekly Delivery Review reports don't duplicate it.

export type RangePreset = "week" | "month" | "quarter" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
  preset: RangePreset;
  label: string;       // "May 9 – May 15, 2026"
  cadenceLabel: string; // "Weekly" | "Monthly" | "Quarterly" | "Custom"
}

export interface RangeRequest {
  preset?: RangePreset;
  from?: string; // ISO date
  to?: string;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Snap a date to midnight UTC so go-live dates (which are stored date-only
// and parse to 00:00 UTC) are always >= the range start.
function startOfDayUTC(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function resolveRange(req: RangeRequest = {}, now: Date = new Date()): DateRange {
  // Custom range: needs both from + to to be valid.
  if (req.preset === "custom" && req.from && req.to) {
    const start = startOfDayUTC(new Date(req.from));
    const end = new Date(req.to);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      end.setUTCHours(23, 59, 59, 999);
      return { start, end, preset: "custom", label: `${fmtShort(start)} – ${fmtShort(end)}, ${end.getUTCFullYear()}`, cadenceLabel: "Custom" };
    }
  }

  if (req.preset === "month") {
    const start = startOfDayUTC(new Date(now));
    start.setUTCDate(start.getUTCDate() - 30);
    return { start, end: now, preset: "month", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Monthly" };
  }

  if (req.preset === "quarter") {
    const start = startOfDayUTC(new Date(now));
    start.setUTCDate(start.getUTCDate() - 90);
    return { start, end: now, preset: "quarter", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Quarterly" };
  }

  // Default: rolling last 7 days, start snapped to midnight.
  const start = startOfDayUTC(new Date(now));
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end: now, preset: "week", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Weekly" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reports/date-range.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Update `weekly-loader.ts` to import from the new module instead of defining its own copy**

In `lib/reports/weekly-loader.ts`, delete the local `RangePreset`, `DateRange`, `RangeRequest` type/interface declarations, the local `fmtShort`, `startOfDayUTC`, and `resolveRange` function bodies (roughly lines 27-112 of the file as it stood before this task), and add at the top of the file:

```typescript
import { resolveRange, type DateRange, type RangePreset, type RangeRequest } from "@/lib/reports/date-range";
export type { DateRange, RangePreset, RangeRequest };
```

The `export type {}` re-export keeps every existing importer of `weekly-loader.ts`'s `DateRange`/`RangePreset`/`RangeRequest` working without touching their import paths.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — 139+ tests (the pre-existing suite) plus the 3 new ones, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/reports/date-range.ts lib/reports/weekly-loader.ts tests/reports/date-range.test.ts
git commit -m "reports: extract shared date-range resolver out of weekly-loader.ts"
```

---

### Task 3: Cumulative migration-progress derivation (pure function, unit-tested)

**Files:**
- Create: `lib/reports/migration-progress.ts`
- Test: `tests/reports/migration-progress.test.ts`

**Interfaces:**
- Consumes: `Process` rows with `kickoff_date`, `date_parity_complete`, `date_customer_handover`, `date_customer_validation`, `went_live_at`, `migration_stage` (all already on the type in `lib/supabase/types.ts`).
- Produces: `ProgressPoint { weekStart: string; cumulativeAtOrPastParity: number }`, `computeMigrationProgramStart(processes: Process[]): Date | null`, `computeCumulativeProgress(processes: Process[], programStart: Date, asOf: Date): ProgressPoint[]`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/reports/migration-progress.test.ts
import { describe, it, expect } from "vitest";
import { computeMigrationProgramStart, computeCumulativeProgress } from "@/lib/reports/migration-progress";
import type { Process } from "@/lib/supabase/types";

function proc(overrides: Partial<Process>): Process {
  return {
    id: "p1", account: "Acme", customer_key: "acme", process_name: "Test",
    process_status: null, platform: "v1", migration_stage: "not_required",
    is_blocked: false, priority: null, fde_owner: null, engg_owner: null,
    date_parity_complete: null, date_customer_handover: null, date_customer_validation: null,
    go_live_date: null, completion_pct: null, effort_required: null, went_live_at: null,
    active_usage: null, customer_notified: null, customer_contact: null, blockers: null,
    notes: null, feature_delta: null, linear_ticket_ids: [], v2_workspace_url: null,
    arr: null, company_size: null, source_phase: null, source_board: null, updated_by: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
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

describe("computeMigrationProgramStart", () => {
  it("returns the earliest kickoff_date among processes with real V2 evidence", () => {
    const processes = [
      proc({ kickoff_date: "2026-03-01", linear_ticket_ids: ["ENG-1"] }),
      proc({ kickoff_date: "2026-01-15", date_parity_complete: "2026-02-01" }),
      proc({ kickoff_date: "2020-01-01" }), // no V2 evidence — excluded
    ];
    expect(computeMigrationProgramStart(processes)).toEqual(new Date("2026-01-15"));
  });

  it("returns null when no process has any V2 evidence", () => {
    expect(computeMigrationProgramStart([proc({})])).toBeNull();
  });
});

describe("computeCumulativeProgress", () => {
  it("counts a process from the week it first reaches any parity-or-later milestone", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-22T00:00:00Z"); // 3 full weeks
    const processes = [
      proc({ date_parity_complete: "2026-01-05" }), // week 1
      proc({ date_customer_handover: "2026-01-12" }), // week 2 (handover implies parity already passed)
      proc({}), // never reached parity — not counted at all
    ];
    const points = computeCumulativeProgress(processes, programStart, asOf);
    expect(points.map((p) => p.cumulativeAtOrPastParity)).toEqual([1, 2, 2]);
  });

  it("never decreases week over week even with a quiet week in between", () => {
    const programStart = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-29T00:00:00Z"); // 4 weeks
    const processes = [proc({ date_parity_complete: "2026-01-03" }), proc({ went_live_at: "2026-01-24" })];
    const points = computeCumulativeProgress(processes, programStart, asOf);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeAtOrPastParity).toBeGreaterThanOrEqual(points[i - 1].cumulativeAtOrPastParity);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reports/migration-progress.test.ts`
Expected: FAIL — `Cannot find module '@/lib/reports/migration-progress'`

- [ ] **Step 3: Implement**

```typescript
// lib/reports/migration-progress.ts
//
// Cumulative "processes at or past parity" chart for the All-Hands report.
// Deliberately all-time-since-program-start, not reset per fiscal quarter —
// the migration program is one continuous effort, and a quarter boundary
// would be an arbitrary reset (Rishabh, 2026-08-07). Deliberately cumulative,
// not a per-week count — a running total can't look like a step backward on
// a quiet week the way a discrete weekly bar can.

import type { Process } from "@/lib/supabase/types";

export interface ProgressPoint {
  weekStart: string; // ISO date, Monday of that week
  cumulativeAtOrPastParity: number;
}

/** A process counts as "real V2 migration evidence" using the same rule as
 *  lib/processes/loader.ts's hasV2Evidence() / isV2Relevant() — any real
 *  signal of migration activity, not just a platform label. */
function hasV2Evidence(p: Process): boolean {
  return (
    p.linear_ticket_ids.length > 0 ||
    p.date_parity_complete != null ||
    p.date_customer_handover != null ||
    p.date_customer_validation != null ||
    p.went_live_at != null
  );
}

/** Earliest kickoff_date among processes with real V2 evidence — the
 *  program's start date, derived rather than hardcoded so it never needs
 *  manual updating. Returns null if nothing qualifies (e.g. an empty or
 *  freshly-seeded table). */
export function computeMigrationProgramStart(processes: Process[]): Date | null {
  const dates = processes
    .filter(hasV2Evidence)
    .map((p) => p.kickoff_date)
    .filter((d): d is string => d != null)
    .map((d) => new Date(d));
  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}

/** The earliest of a process's parity-or-later milestone dates — the date it
 *  first counted as "at or past parity". Reaching handover, validation, or
 *  go-live all imply parity was reached at or before that date. Returns null
 *  if the process never reached any of them. */
function parityReachedDate(p: Process): Date | null {
  const candidates = [p.date_parity_complete, p.date_customer_handover, p.date_customer_validation, p.went_live_at]
    .filter((d): d is string => d != null)
    .map((d) => new Date(d));
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d < min ? d : min));
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

/** One point per week from programStart to asOf, each a running total of how
 *  many processes had reached parity-or-later by that week. Weeks with no
 *  new milestones simply repeat the previous total. */
export function computeCumulativeProgress(processes: Process[], programStart: Date, asOf: Date): ProgressPoint[] {
  const reachedDates = processes
    .map(parityReachedDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());

  const points: ProgressPoint[] = [];
  const firstWeek = startOfIsoWeek(programStart);
  const lastWeek = startOfIsoWeek(asOf);
  let cumulative = 0;
  let reachedIdx = 0;

  for (let week = new Date(firstWeek); week <= lastWeek; week.setUTCDate(week.getUTCDate() + 7)) {
    const weekEnd = new Date(week);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    while (reachedIdx < reachedDates.length && reachedDates[reachedIdx] < weekEnd) {
      cumulative++;
      reachedIdx++;
    }
    points.push({ weekStart: week.toISOString().slice(0, 10), cumulativeAtOrPastParity: cumulative });
  }
  return points;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/migration-progress.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reports/migration-progress.ts tests/reports/migration-progress.test.ts
git commit -m "reports: cumulative migration-progress derivation for the All-Hands report"
```

---

### Task 4: Renewal spotlight + at-risk-and-migrating cross-signal (pure functions, unit-tested)

**Files:**
- Create: `lib/reports/allhands-signals.ts`
- Test: `tests/reports/allhands-signals.test.ts`

**Interfaces:**
- Consumes: customer rows shaped `{ id: string; key: string; display_name: string; custom_category: string | null; lifecycle_group: string | null }`, confirmed-ARR results from `getConfirmedArrForCustomer` (`lib/commercials/confirmed-arr.ts`), `categoryFromCustomer` (`app/_components/brand.tsx`), and `Process[]` grouped by `customer_id`.
- Produces: `RenewalSpotlight { customerKey: string; customerName: string; renewalInDays: number; arr: number; liveProcessCount: number; migratingProcessCount: number } | null`, `findRenewalSpotlight(...)`, `AtRiskMigratingEntry { customerKey: string; customerName: string; migratingProcessCount: number }`, `findAtRiskMigratingCustomers(...)`. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/reports/allhands-signals.test.ts
import { describe, it, expect } from "vitest";
import { findRenewalSpotlight, findAtRiskMigratingCustomers, type CustomerForSignals } from "@/lib/reports/allhands-signals";
import type { Process } from "@/lib/supabase/types";

function customer(overrides: Partial<CustomerForSignals>): CustomerForSignals {
  return { id: "c1", key: "acme", display_name: "Acme", custom_category: null, lifecycle_group: null, ...overrides };
}
function proc(overrides: Partial<Pick<Process, "customer_id" | "lifecycle" | "migration_stage">>): Pick<Process, "customer_id" | "lifecycle" | "migration_stage"> {
  return { customer_id: "c1", lifecycle: "live", migration_stage: "not_required", ...overrides };
}

describe("findRenewalSpotlight", () => {
  it("returns the soonest-renewing customer within 90 days", () => {
    const customers = [customer({ id: "c1", key: "norco", display_name: "Norco" })];
    const arrByCustomer = new Map([["c1", { arr: 311000, renewal_date: "2026-09-24" }]]);
    const processesByCustomer = new Map([
      ["c1", [proc({ lifecycle: "live" }), proc({ lifecycle: "in_development", migration_stage: "in_development" })]],
    ]);
    const spotlight = findRenewalSpotlight(customers, arrByCustomer, processesByCustomer, new Date("2026-08-07"));
    expect(spotlight?.customerKey).toBe("norco");
    expect(spotlight?.arr).toBe(311000);
    expect(spotlight?.liveProcessCount).toBe(1);
    expect(spotlight?.migratingProcessCount).toBe(1);
  });

  it("returns null when nothing renews within 90 days", () => {
    const customers = [customer({ id: "c1" })];
    const arrByCustomer = new Map([["c1", { arr: 100000, renewal_date: "2027-01-01" }]]);
    expect(findRenewalSpotlight(customers, arrByCustomer, new Map(), new Date("2026-08-07"))).toBeNull();
  });

  it("returns null when no customer has a renewal date at all", () => {
    const customers = [customer({ id: "c1" })];
    expect(findRenewalSpotlight(customers, new Map([["c1", { arr: 0, renewal_date: null }]]), new Map(), new Date("2026-08-07"))).toBeNull();
  });
});

describe("findAtRiskMigratingCustomers", () => {
  it("flags a customer that is both At Risk and has active migration work", () => {
    const customers = [customer({ id: "c1", custom_category: "At Risk" })];
    const processesByCustomer = new Map([
      ["c1", [proc({ migration_stage: "parity_testing" }), proc({ migration_stage: "not_required" })]],
    ]);
    const result = findAtRiskMigratingCustomers(customers, processesByCustomer);
    expect(result).toEqual([{ customerKey: "acme", customerName: "Acme", migratingProcessCount: 1 }]);
  });

  it("excludes At Risk customers with no active migration work", () => {
    const customers = [customer({ id: "c1", custom_category: "At Risk" })];
    const processesByCustomer = new Map([["c1", [proc({ migration_stage: "not_required" })]]]);
    expect(findAtRiskMigratingCustomers(customers, processesByCustomer)).toEqual([]);
  });

  it("excludes migrating customers that are not At Risk", () => {
    const customers = [customer({ id: "c1", custom_category: "Strategic Growth" })];
    const processesByCustomer = new Map([["c1", [proc({ migration_stage: "parity_testing" })]]]);
    expect(findAtRiskMigratingCustomers(customers, processesByCustomer)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reports/allhands-signals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// lib/reports/allhands-signals.ts
//
// Two report-specific signals that tie migration status to commercial
// urgency — the one place Delivery and Customer Success genuinely need the
// same information at the same time (Rishabh, 2026-08-07):
//   1. Upcoming-renewal spotlight — shown only when something is actually
//      due soon; the whole block is omitted otherwise (never an empty state).
//   2. At-risk-and-migrating cross-signal — customers tagged At Risk who
//      also have active migration work right now.

import { categoryFromCustomer } from "@/app/_components/brand";
import type { Process, ProcessLifecycle, MigrationStage } from "@/lib/supabase/types";
import { IN_FLIGHT_STAGES } from "@/lib/supabase/types";

export interface CustomerForSignals {
  id: string;
  key: string;
  display_name: string;
  custom_category: string | null;
  lifecycle_group: string | null;
}

export interface ArrForSignals {
  arr: number;
  renewal_date: string | null;
}

type ProcessForSignals = Pick<Process, "lifecycle" | "migration_stage">;

const RENEWAL_WINDOW_DAYS = 90;

export interface RenewalSpotlight {
  customerKey: string;
  customerName: string;
  renewalInDays: number;
  arr: number;
  liveProcessCount: number;
  migratingProcessCount: number;
}

function isMigrating(stage: MigrationStage): boolean {
  return (IN_FLIGHT_STAGES as MigrationStage[]).includes(stage);
}

function isLive(lifecycle: ProcessLifecycle): boolean {
  return lifecycle === "live";
}

/** The single soonest-renewing customer within RENEWAL_WINDOW_DAYS, or null.
 *  Only ever surfaces one — this is a spotlight, not a table; if several
 *  customers qualify, the nearest renewal is the one that matters most. */
export function findRenewalSpotlight(
  customers: CustomerForSignals[],
  arrByCustomer: Map<string, ArrForSignals>,
  processesByCustomer: Map<string, ProcessForSignals[]>,
  now: Date
): RenewalSpotlight | null {
  let best: { customer: CustomerForSignals; days: number; arr: ArrForSignals } | null = null;

  for (const customer of customers) {
    const arr = arrByCustomer.get(customer.id);
    if (!arr?.renewal_date) continue;
    const days = Math.round((new Date(arr.renewal_date).getTime() - now.getTime()) / 86_400_000);
    if (days < 0 || days > RENEWAL_WINDOW_DAYS) continue;
    if (!best || days < best.days) best = { customer, days, arr };
  }

  if (!best) return null;
  const processes = processesByCustomer.get(best.customer.id) ?? [];
  return {
    customerKey: best.customer.key,
    customerName: best.customer.display_name,
    renewalInDays: best.days,
    arr: best.arr.arr,
    liveProcessCount: processes.filter((p) => isLive(p.lifecycle)).length,
    migratingProcessCount: processes.filter((p) => isMigrating(p.migration_stage)).length,
  };
}

export interface AtRiskMigratingEntry {
  customerKey: string;
  customerName: string;
  migratingProcessCount: number;
}

/** Customers whose *current* category resolves to "At Risk" (via the same
 *  categoryFromCustomer() rule used everywhere else in the app) and who have
 *  at least one process in an in-flight migration stage right now. */
export function findAtRiskMigratingCustomers(
  customers: CustomerForSignals[],
  processesByCustomer: Map<string, ProcessForSignals[]>
): AtRiskMigratingEntry[] {
  const out: AtRiskMigratingEntry[] = [];
  for (const customer of customers) {
    const category = categoryFromCustomer(customer);
    if (category !== "At Risk") continue;
    const migratingCount = (processesByCustomer.get(customer.id) ?? []).filter((p) => isMigrating(p.migration_stage)).length;
    if (migratingCount === 0) continue;
    out.push({ customerKey: customer.key, customerName: customer.display_name, migratingProcessCount: migratingCount });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/allhands-signals.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reports/allhands-signals.ts tests/reports/allhands-signals.test.ts
git commit -m "reports: renewal spotlight + at-risk-and-migrating cross-signal for All-Hands"
```

---

### Task 5: Blockers resolution — team_asks "now" tier, falling back to top hard-blocker tickets

**Files:**
- Create: `lib/reports/allhands-blockers.ts`
- Test: `tests/reports/allhands-blockers.test.ts`

**Interfaces:**
- Consumes: `TeamAsk[]`, `TicketRow[]` (both from `lib/tickets/types.ts`).
- Produces: `BlockerItem { title: string; priorityLabel: "NOW" | "SOON"; linkedTicketIds: string[]; source: "team_ask" | "ticket_fallback" }`, `resolveBlockers(teamAsks: TeamAsk[], openTickets: TicketRow[], max?: number): BlockerItem[]`. Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/reports/allhands-blockers.test.ts
import { describe, it, expect } from "vitest";
import { resolveBlockers } from "@/lib/reports/allhands-blockers";
import type { TeamAsk, TicketRow } from "@/lib/tickets/types";

function ask(overrides: Partial<TeamAsk>): TeamAsk {
  return {
    id: "a1", ask_text: "Fix it", requester: "Rishabh", priority_tier: "now", status: "open",
    notes: null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    tickets: [], ...overrides,
  };
}
function ticket(overrides: Partial<TicketRow>): TicketRow {
  return {
    id: "ENG-1", title: "Something broke", url: "https://linear.app/x", team: null, project: null,
    source: "v2 Migration Blockers", priority: "High", linear_status: "Triage", status_type: "triage",
    linear_created_at: "2026-08-01T00:00:00Z", closed_at: null, in_scope: true,
    classification: "hard_blocker", confidence: "certain", rationale: null, domain: null,
    classified_at: "2026-08-01T00:00:00Z", manual_override: false, last_synced_at: "2026-08-07T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", ...overrides,
  };
}

describe("resolveBlockers", () => {
  it("prefers open team_asks tagged 'now', tagged as team_ask source", () => {
    const asks = [ask({ ask_text: "Kort needs a decision", tickets: [{ id: "ENG-4444", title: "x" }] })];
    const result = resolveBlockers(asks, [ticket({})]);
    expect(result).toEqual([
      { title: "Kort needs a decision", priorityLabel: "NOW", linkedTicketIds: ["ENG-4444"], source: "team_ask" },
    ]);
  });

  it("includes 'soon' asks after all 'now' asks, still from team_asks", () => {
    const asks = [ask({ id: "a1", ask_text: "later thing", priority_tier: "soon" }), ask({ id: "a2", ask_text: "now thing", priority_tier: "now" })];
    const result = resolveBlockers(asks, []);
    expect(result.map((b) => b.title)).toEqual(["now thing", "later thing"]);
  });

  it("ignores closed/done team_asks", () => {
    const asks = [ask({ status: "done" })];
    expect(resolveBlockers(asks, [])).toEqual([]);
  });

  it("falls back to open hard-blocker tickets when no open team_asks exist", () => {
    const tickets = [
      ticket({ id: "ENG-1", title: "Blocker one", classification: "hard_blocker", closed_at: null }),
      ticket({ id: "ENG-2", title: "Not a blocker", classification: "just_a_bug", closed_at: null }),
      ticket({ id: "ENG-3", title: "Closed blocker", classification: "hard_blocker", closed_at: "2026-08-05T00:00:00Z" }),
    ];
    const result = resolveBlockers([], tickets);
    expect(result).toEqual([{ title: "Blocker one", priorityLabel: "NOW", linkedTicketIds: ["ENG-1"], source: "ticket_fallback" }]);
  });

  it("caps the fallback list at `max`", () => {
    const tickets = Array.from({ length: 10 }, (_, i) =>
      ticket({ id: `ENG-${i}`, title: `Blocker ${i}`, classification: "hard_blocker" })
    );
    expect(resolveBlockers([], tickets, 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reports/allhands-blockers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// lib/reports/allhands-blockers.ts
//
// "This week's blockers" for the All-Hands report. team_asks marked open +
// priority "now"/"soon" are the human-curated showcase layer — if Rishabh
// (or anyone) files one, via the /tickets page or an agent tool, it shows up
// here verbatim. When none exist, falls back to the top open hard-blocker
// Linear tickets so the section is never empty just because nobody filed an
// ask that week (Rishabh, 2026-08-07: "if not then it follows the template
// using live data").

import type { TeamAsk, TicketRow } from "@/lib/tickets/types";

export interface BlockerItem {
  title: string;
  priorityLabel: "NOW" | "SOON";
  linkedTicketIds: string[];
  source: "team_ask" | "ticket_fallback";
}

const TIER_ORDER = { now: 0, soon: 1, later: 2 } as const;

export function resolveBlockers(teamAsks: TeamAsk[], openTickets: TicketRow[], max = 5): BlockerItem[] {
  const openAsks = teamAsks
    .filter((a) => a.status === "open" && a.priority_tier !== "later")
    .sort((a, b) => TIER_ORDER[a.priority_tier] - TIER_ORDER[b.priority_tier]);

  if (openAsks.length > 0) {
    return openAsks.slice(0, max).map((a) => ({
      title: a.ask_text,
      priorityLabel: a.priority_tier === "now" ? "NOW" : "SOON",
      linkedTicketIds: a.tickets.map((t) => t.id),
      source: "team_ask" as const,
    }));
  }

  return openTickets
    .filter((t) => t.classification === "hard_blocker" && t.closed_at == null && t.in_scope)
    .slice(0, max)
    .map((t) => ({ title: t.title, priorityLabel: "NOW" as const, linkedTicketIds: [t.id], source: "ticket_fallback" as const }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/allhands-blockers.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reports/allhands-blockers.ts tests/reports/allhands-blockers.test.ts
git commit -m "reports: blockers resolution (team_asks now/soon, fallback to hard-blocker tickets)"
```

---

### Task 6: Compose the All-Hands report loader

**Files:**
- Create: `lib/reports/allhands-loader.ts`

**Interfaces:**
- Consumes: `loadV2MigrationOverview()` (`lib/processes/loader.ts`), `loadTicketsBundle()` (`lib/tickets/loader.ts`), `getConfirmedArrForCustomer()` (`lib/commercials/confirmed-arr.ts`), everything from Tasks 2-5.
- Produces: `AllHandsReport` (full shape below), `loadAllHandsReport(req?: RangeRequest): Promise<AllHandsReport>`. Consumed by Task 7 (the page/client).

- [ ] **Step 1: Implement (no test file — this is an integration composition; verified live against production in Task 9, matching the pattern used for every other loader in this codebase)**

```typescript
// lib/reports/allhands-loader.ts
//
// Composes the All-Hands report from three already-live sources plus two
// report-specific derivations. See docs/mockups/2026-08-07-allhands-report-layout.html
// for the approved layout this feeds.

import { requireAdmin } from "@/lib/supabase/server";
import { loadV2MigrationOverview, type V2MigrationOverview } from "@/lib/processes/loader";
import { loadTicketsBundle, type TicketsBundle } from "@/lib/tickets/loader";
import { getConfirmedArrForCustomer } from "@/lib/commercials/confirmed-arr";
import { resolveRange, type DateRange, type RangeRequest } from "@/lib/reports/date-range";
import { computeMigrationProgramStart, computeCumulativeProgress, type ProgressPoint } from "@/lib/reports/migration-progress";
import { findRenewalSpotlight, findAtRiskMigratingCustomers, type RenewalSpotlight, type AtRiskMigratingEntry } from "@/lib/reports/allhands-signals";
import { resolveBlockers, type BlockerItem } from "@/lib/reports/allhands-blockers";
import { IN_FLIGHT_STAGES, type Process, type MigrationStage } from "@/lib/supabase/types";

export interface AllHandsStatus {
  liveCount: number;
  activeCount: number;
  migratingNowCount: number;
  queuedCount: number;
  byStage: V2MigrationOverview["counts"]["byStage"];
  stageRows: Array<{ stage: string; label: string; count: number; processNames: string[] }>;
}

export interface AllHandsReport {
  range: DateRange;
  generatedAt: string;
  status: AllHandsStatus;
  cumulativeProgress: ProgressPoint[];
  renewalSpotlight: RenewalSpotlight | null;
  atRiskMigrating: AtRiskMigratingEntry[];
  blockers: BlockerItem[];
  ticketHealth: {
    openInScope: number;
    hardBlockers: number;
    closedThisPeriod: number;
    newThisPeriod: number;
  };
}

const STAGE_LABELS: Record<string, string> = {
  live_on_v2: "Live on V2",
  migrated_pending_commercial: "Live on V2",
  customer_validation: "Customer validation",
  parity_testing: "Parity testing",
  engg_pending: "Engg pending",
  in_development: "In development",
};
const STAGE_ORDER = ["live_on_v2", "customer_validation", "parity_testing", "engg_pending", "in_development"];

export async function loadAllHandsReport(req: RangeRequest = {}): Promise<AllHandsReport> {
  const sb = requireAdmin();
  const range = resolveRange(req);

  const [overview, tickets, customersRes, oppsRes, processesRes] = await Promise.all([
    loadV2MigrationOverview(),
    loadTicketsBundle(),
    sb.from("customers").select("id, key, display_name, custom_category, lifecycle_group").is("deleted_at", null),
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed"),
    sb.from("processes").select("*"),
  ]);

  type CustomerRow = { id: string; key: string; display_name: string; custom_category: string | null; lifecycle_group: string | null };
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

  const allProcesses = (processesRes.data as Process[] | null) ?? [];
  const processesByCustomer = new Map<string, Process[]>();
  for (const p of allProcesses) {
    if (!p.customer_id) continue;
    const list = processesByCustomer.get(p.customer_id) ?? [];
    list.push(p);
    processesByCustomer.set(p.customer_id, list);
  }

  // ── Status ──────────────────────────────────────────────────────────────
  const liveCount = allProcesses.filter((p) => p.lifecycle === "live").length;
  const activeCount = allProcesses.filter((p) => !["live", "cancelled", "churned", "retired"].includes(p.lifecycle)).length;
  const queuedCount = allProcesses.filter((p) => p.lifecycle === "backlog" || p.lifecycle === "upcoming").length;
  // "Migrating now" = truly in-flight stages only (IN_FLIGHT_STAGES, the same
  // constant lib/supabase/types.ts already exports for this exact purpose) —
  // does NOT include live_on_v2/migrated_pending_commercial, which are
  // already-finished migrations, not work in progress. The stage board below
  // is a broader view that legitimately includes a "Live on V2" column for
  // context (see the mockup), so it's built from its own filter, not this one.
  const migratingNowRows = overview.rows.filter((r) => (IN_FLIGHT_STAGES as MigrationStage[]).includes(r.migration_stage));
  const stageRows = STAGE_ORDER.map((stage) => {
    const rows = overview.rows.filter((r) => (stage === "live_on_v2" ? r.migration_stage === "live_on_v2" || r.migration_stage === "migrated_pending_commercial" : r.migration_stage === stage));
    return { stage, label: STAGE_LABELS[stage], count: rows.length, processNames: rows.map((r) => r.process_name) };
  }).filter((row) => row.count > 0);

  // ── Cumulative progress (all-time since program start, not per-quarter) ──
  const programStart = computeMigrationProgramStart(allProcesses);
  const cumulativeProgress = programStart ? computeCumulativeProgress(allProcesses, programStart, range.end) : [];

  // ── Renewal spotlight + at-risk cross-signal ─────────────────────────────
  const renewalSpotlight = findRenewalSpotlight(customers, arrByCustomer, processesByCustomer, range.end);
  const atRiskMigrating = findAtRiskMigratingCustomers(customers, processesByCustomer);

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers = resolveBlockers(tickets.team_asks.now.concat(tickets.team_asks.soon), tickets.open_tickets);

  return {
    range,
    generatedAt: new Date().toISOString(),
    status: {
      liveCount,
      activeCount,
      migratingNowCount: migratingNowRows.length,
      queuedCount,
      byStage: overview.counts.byStage,
      stageRows,
    },
    cumulativeProgress,
    renewalSpotlight,
    atRiskMigrating,
    blockers,
    ticketHealth: {
      openInScope: tickets.totals.open,
      hardBlockers: tickets.open_tickets.filter((t) => t.classification === "hard_blocker").length,
      closedThisPeriod: tickets.delta.newly_closed,
      newThisPeriod: tickets.delta.new_count,
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `V2MigrationOverview`, `TicketsBundle`, or any field name doesn't match, fix the mismatch here (not in the already-existing `loadV2MigrationOverview`/`loadTicketsBundle` — those are correct and tested; this file must conform to them).

- [ ] **Step 3: Commit**

```bash
git add lib/reports/allhands-loader.ts
git commit -m "reports: compose the All-Hands report loader from live processes + tickets"
```

---

### Task 7: Build the All-Hands report page and client component

**Files:**
- Create: `app/(app)/reports/v2-migration/allhands-client.tsx`
- Modify: `app/(app)/reports/v2-migration/page.tsx` (replace entirely)

**Interfaces:**
- Consumes: `AllHandsReport` from Task 6, `RangeRequest`/`RangePreset` from Task 2.
- Produces: the page rendered at `/reports/v2-migration`.

- [ ] **Step 1: Open the approved layout reference**

Open `docs/mockups/2026-08-07-allhands-report-layout.html` in a browser (or read it directly) before writing JSX. It is the final approved structure: header with date-range picker + PNG download button, then in order — (1) merged portfolio & migration status (snapshot tiles + stage board in one card, not two), (2) cumulative progress chart (all-time since program start per Task 3/6, not per-quarter — the mockup shows a quarter-scoped example; the *shape* — cumulative area/line, never a discrete weekly bar — is what's approved, not the specific time window drawn), (3) upcoming-renewal spotlight (only rendered when `report.renewalSpotlight` is non-null), (3b) at-risk-and-migrating list directly below the spotlight, same conditional-render pattern, empty array renders nothing, (4) blockers, (5) ticket health. All on the `.report-theme` dark surface from Task 1.

- [ ] **Step 2: Write the client component**

```typescript
// app/(app)/reports/v2-migration/allhands-client.tsx
"use client";

import { useRef, useState } from "react";
import type { AllHandsReport } from "@/lib/reports/allhands-loader";
import type { RangePreset } from "@/lib/reports/date-range";

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "custom", label: "Custom" },
];

export function AllHandsClient({ report }: { report: AllHandsReport }) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exportState, setExportState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function downloadPng() {
    setExportState("loading");
    try {
      const el = reportRef.current;
      if (!el) throw new Error("No report element");
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#171717", style: { maxWidth: "none" } });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `allhands-${report.range.preset}-${report.range.label.replace(/\s+/g, "-")}.png`;
      a.click();
      setExportState("done");
    } catch (err) {
      console.error("[allhands-export]", err);
      setExportState("error");
    } finally {
      setTimeout(() => setExportState("idle"), 3000);
    }
  }

  return (
    <div className="report-theme rounded-2xl p-6" ref={reportRef}>
      {/* Header: preset picker (client-side navigation via search params, same
          pattern as app/(app)/reports/weekly/_components/weekly-report-client.tsx)
          + export button calling downloadPng(). Build per the mockup header row. */}

      {/* Section 1: status — report.status.liveCount / activeCount / migratingNowCount /
          queuedCount as the top tile row, report.status.stageRows as the column group
          beneath, in the SAME card (one section, not two — see mockup). */}

      {/* Section 2: cumulative progress — render report.cumulativeProgress as an SVG
          area/line chart (reuse the path-drawing approach from the mockup file, scaling
          the polyline points to the actual data length instead of the mockup's fixed 6
          points). Label: "N of M tracked migrations at or past parity since the program
          started" (M = report.status.migratingNowCount + count of live-on-v2 stage rows
          + report.cumulativeProgress's final value, i.e. total ever reached parity). */}

      {/* Section 3: renewal spotlight — only when report.renewalSpotlight is non-null.
          Section 3b: at-risk-and-migrating — only when report.atRiskMigrating.length > 0. */}

      {/* Section 4: blockers — map report.blockers, badge text = b.priorityLabel,
          linked tickets = b.linkedTicketIds rendered as chips linking to
          https://linear.app/kognitos/issue/${id} (same LINEAR_ISSUE pattern as the
          deleted lib/reports/v2-migrations.ts, inlined here since that file is deleted
          in Task 9). */}

      {/* Section 5: ticket health — report.ticketHealth's four numbers as tiles. */}
    </div>
  );
}
```

Fill in each commented section following the exact visual structure in the mockup file — tile layout, card radius, colors, and spacing are all specified there; do not invent new values, reuse the `--rt-*` tokens from Task 1.

- [ ] **Step 3: Write the page**

```typescript
// app/(app)/reports/v2-migration/page.tsx
import { BackButton } from "@/app/_components/back-button";
import { loadAllHandsReport } from "@/lib/reports/allhands-loader";
import { AllHandsClient } from "./allhands-client";
import type { RangePreset } from "@/lib/reports/date-range";

export const dynamic = "force-dynamic";

export default async function AllHandsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const preset = (params.preset as RangePreset | undefined) ?? "week";
  const report = await loadAllHandsReport({ preset, from: params.from, to: params.to });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <AllHandsClient report={report} />
    </div>
  );
}
```

- [ ] **Step 4: Delete the old sub-page and its components**

```bash
rm -rf "app/(app)/reports/v2-migration/_components"
```

(This removes the old `V2MigrationClient`, `v2-migration-legacy.tsx`, and any other files under that directory — everything the old page imported. The `tickets/` sub-route stays; it's unrelated existing functionality, not part of the old report.)

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. Fix any leftover import of the deleted `_components` directory.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/reports/v2-migration"
git commit -m "reports: rebuild /reports/v2-migration as the live All-Hands report"
```

---

### Task 8: Delete the two hand-maintained data files

**Files:**
- Delete: `lib/reports/v2-allhands-weeks.ts`
- Delete: `lib/reports/v2-migrations.ts`
- Modify: `lib/reports/weekly-loader.ts` (remove its now-dead import of `v2-migrations.ts` and the `v2_migration_list`/`v2_program`/`v2_migrations` fields — the All-Hands report owns this content now)

**Interfaces:**
- Removes: `WeeklyBundle.v2_migration_list`, `WeeklyBundle.v2_program`, `WeeklyBundle.v2_migrations` (all three were curated-data-only; nothing else in the codebase reads them except `app/(app)/reports/weekly/_components/weekly-report-client.tsx`, which the Weekly Delivery Review plan replaces).

- [ ] **Step 1: Confirm nothing else imports the files being deleted**

Run: `grep -rln "v2-allhands-weeks\|v2-migrations" app lib --include=*.ts --include=*.tsx`
Expected: only `lib/reports/weekly-loader.ts` (for `v2-migrations.ts`) and the files already deleted in Task 7 (for `v2-allhands-weeks.ts`, via the old `V2MigrationClient`). If anything else shows up, stop and investigate before deleting — don't delete a file something still imports.

- [ ] **Step 2: Delete the files**

```bash
rm lib/reports/v2-allhands-weeks.ts lib/reports/v2-migrations.ts
```

- [ ] **Step 3: Remove the dead import and fields from `weekly-loader.ts`**

Remove the `import { loadV2Migrations, ... } from "@/lib/reports/v2-migrations";` line, the `v2Migrations` variable and its `Promise.all` entry, the `v2_migration_list` computation block, and the `v2_migration_list`, `v2_program`, `v2_migrations` fields from both the `WeeklyBundle` interface and the object returned by `loadWeeklyBundle()`. (This file is fully replaced by the Weekly Delivery Review plan regardless — this step just stops it importing a file that no longer exists, in case that plan hasn't run yet.)

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. `app/(app)/reports/weekly/_components/weekly-report-client.tsx` will likely now have type errors referencing the removed fields — leave those for the Weekly Delivery Review plan, which replaces that whole page; note them but do not fix here if this plan is being run standalone before that one (add a one-line `// TODO(weekly-delivery-review plan): this page is being replaced` comment at the top of any file that still references the removed fields, rather than papering over the type error).

- [ ] **Step 5: Commit**

```bash
git add -A lib/reports/weekly-loader.ts
git rm lib/reports/v2-allhands-weeks.ts lib/reports/v2-migrations.ts
git commit -m "reports: delete the two hand-maintained V2 report data files"
```

---

### Task 9: Update the Reports catalog to two cards

**Files:**
- Modify: `app/(app)/reports/page.tsx`

**Interfaces:** None (leaf UI change).

- [ ] **Step 1: Replace `REPORT_CARDS`**

Replace the `REPORT_CARDS` array (and the now-unused `"coming-soon"`/`"needs-access"` status handling can stay in the type for now, just unused) with exactly two entries:

```typescript
const REPORT_CARDS: ReportCard[] = [
  {
    id: "v2-migration",
    title: "All-Hands",
    subtitle: "Company-wide · Delivery & Customer Success",
    description:
      "Portfolio and migration status, cumulative migration progress since the program started, upcoming-renewal spotlight, this week's blockers, and live ticket health. All from live processes + Linear data — export as PNG or print for the meeting.",
    icon: "🚀",
    status: "available",
    needs: [],
    href: "/reports/v2-migration",
  },
  {
    id: "delivery-review",
    title: "Weekly Delivery Review",
    subtitle: "Delivery & Customer Success team",
    description:
      "What's done, what's coming up, and what's blocked — grouped by customer, live from processes. The working review for the team, not a presented artifact.",
    icon: "📋",
    status: "available",
    needs: [],
    href: "/reports/delivery-review",
  },
];
```

(The `/reports/delivery-review` route doesn't exist yet — it's built by the separate Weekly Delivery Review plan. This card will 404 until that plan runs; that's expected and matches how this plan was scoped as independently shippable.)

- [ ] **Step 2: Update the page copy and data-sources footer**

Change the intro paragraph to reflect exactly two reports (remove "QBR", "Monthly Customer Digest", "Customer Health Report" framing). The "Report data sources" footer section can stay as-is — it's generically true (Salesforce, Linear/Kognitos data feed these reports) and not specific to the deleted stub cards.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds. The `/reports/delivery-review` link will produce a working `next build` even though the route doesn't exist yet (Next.js doesn't validate `<Link href>` targets at build time).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/reports/page.tsx"
git commit -m "reports: catalog down to two reports (All-Hands, Weekly Delivery Review)"
```

---

### Task 10: Verify against production

**Files:** None (verification only, no code changes).

- [ ] **Step 1: Pull production credentials and run the loader live**

Using the same pattern as the 2026-08-07 Monday-decommission session (a throwaway `tsx` script in `scripts/`, deleted after use, run with `.env.cloud`):

```typescript
// scripts/tmp-verify-allhands.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.cloud", override: true });

async function main() {
  const { loadAllHandsReport } = await import("../lib/reports/allhands-loader");
  const report = await loadAllHandsReport({ preset: "week" });
  console.log(JSON.stringify(report, null, 2));
}
main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
```

Run: `npx tsx scripts/tmp-verify-allhands.ts`
Expected: no exceptions. Sanity-check by eye: `status.liveCount` should roughly match the `lifecycle='live'` count already confirmed in production (66, as of 2026-08-07); `cumulativeProgress`'s final point should be a plausible number of processes at/past parity (roughly in the same range as `status.migratingNowCount` plus already-live V2 processes); `renewalSpotlight` should be either null or point at a real customer with a real upcoming renewal_date — cross-check its `arr` against what `/customers/[key]` shows for that customer.

- [ ] **Step 2: Delete the throwaway script**

```bash
rm scripts/tmp-verify-allhands.ts
```

- [ ] **Step 3: Push and confirm the Vercel deployment reaches READY**

```bash
git push origin main
```

Then check the deployment status via the Vercel connector (project "delivery-ops") until it reports `READY`.
