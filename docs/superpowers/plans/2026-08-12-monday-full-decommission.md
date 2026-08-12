# Full Monday.com Decommission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every runtime dependency DeliveryOps has on Monday.com — the nightly sync, the last live UI reader (Customer 360's Activity tab), the three cache tables, all integration/script code, and the API token — so Monday can be retired without breaking anything.

**Architecture:** No new architecture. This is subtractive: unwire Monday from the sync runner and cron, delete the Activity tab and its data plumbing, fix the handful of dev tools/scripts that would otherwise crash once the tables are gone, drop the tables in a migration, then delete the now-dead integration code, scripts, and docs/env references. Order matters only in that "stop reading the tables" happens before "drop the tables."

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres), Vitest.

## Global Constraints

- Verify every task with `npm run build` (covers Next.js's TS type-check) and `npm test` (`vitest run`) before committing — per this repo's deploy workflow (`CLAUDE.md`).
- Never use `git add -A`; stage only files actually changed in each task.
- The pre-commit hook runs `vitest` automatically (husky) — do not bypass with `--no-verify`.
- The migration in Task 8 contains `DROP TABLE`, which `scripts/check-migration-safety.ts` (the pre-commit hook) blocks unless the file has a top-of-file `-- ALLOW_DESTRUCTIVE: <reason>` marker comment. Include it exactly as shown in Task 8 or the commit will fail.
- Keep, do not delete: `lib/import/monday-taxonomy.ts` and `tests/import/monday-taxonomy.test.ts` (live import for the native `lib/processes/loader.ts`), and `lib/delivery/taxonomy.ts`'s `MONDAY_PROJECT_COLS` / `legacyFieldsFromProcess()` (internal naming shim for native `processes` data, not a Monday API dependency). Also keep `CustomerEnrichment.freshness.monday_synced_at` / `ProjectsCardProps.mondaySyncedAt` in `lib/cache/integrations.ts` / `lib/customers/view-model.ts` — despite the name, it now reflects the most recent native `processes` edit and feeds the live Projects card, unrelated to the Activity tab being removed.
- Out of scope (per approved spec, `docs/superpowers/specs/2026-08-12-monday-full-decommission-design.md`): the local gitignored `monday-backup*/` folders, and building any native replacement for the Activity tab's Fireflies-derived data.

## Two scope additions found during planning (not in the original spec — flagging for visibility)

1. **The whole "Import Customers" dev wizard** (`app/dev/import/page.tsx`, `import-client.tsx`, `app/api/dev/import/{preview,run}/route.ts`, plus 3 nav entries) turned out to exist solely to onboard new customers from Monday's Customers board. The spec only called out deleting the `preview` route; leaving the rest would ship a dev page that 404s. Deleting the whole wizard is the coherent move — Task 6.
2. **`scripts/audit-data-health.ts`, `backfill-profiles.ts`, `db-sanity-check.ts`** all query the doomed tables directly (not just diagnostics — `db-sanity-check.ts` is a pre-flight gate other scripts call). Left alone, they'd throw or false-positive once the tables are dropped. Fixed in Task 7, not deleted (they're real, still-useful tools once the Monday-specific parts are removed).

---

### Task 1: Remove Monday as a sync source

**Files:**
- Modify: `lib/sync/runner.ts`
- Modify: `app/api/cron/daily-sync/route.ts`

**Interfaces:**
- Produces: `SyncSource` type in `lib/sync/runner.ts` becomes `"salesforce" | "kognitos-v2" | "linear-tickets"` (no `"monday"`). `CombinedSyncResult` loses its optional `monday` field. Task 2 deletes the modules this task stops importing.

- [ ] **Step 1: Remove the Monday branch from `runFullSync`**

In `lib/sync/runner.ts`, make these edits:

Remove the import (line 13):
```ts
import { syncMonday, type MondaySyncResult } from "./monday";
```

Change the `SyncSource` type (line 20) from:
```ts
export type SyncSource = "salesforce" | "monday" | "kognitos-v2" | "linear-tickets";
```
to:
```ts
export type SyncSource = "salesforce" | "kognitos-v2" | "linear-tickets";
```

Remove the `monday?: MondaySyncResult;` field from `CombinedSyncResult` (line 26).

Change `DEFAULT_SOURCES` (line 37) from:
```ts
const DEFAULT_SOURCES: SyncSource[] = ["salesforce", "monday", "kognitos-v2", "linear-tickets"];
```
to:
```ts
const DEFAULT_SOURCES: SyncSource[] = ["salesforce", "kognitos-v2", "linear-tickets"];
```

Delete the entire `if (sources.includes("monday")) { ... }` block (currently lines 58–70):
```ts
  if (sources.includes("monday")) {
    await runOne("monday", "all", async () => {
      const r = await syncMonday();
      result.monday = r;
      const rows = r.projects.inserted + r.activities.inserted + r.nps.inserted;
      if (r.errors.length > 0) {
        for (const e of r.errors) result.errors.push(`monday/${e.board}: ${e.error}`);
      }
      return { rows, details: r as unknown as Record<string, unknown> };
    }).catch((err) => {
      result.errors.push(`monday: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
```

- [ ] **Step 2: Update the daily-sync cron route**

In `app/api/cron/daily-sync/route.ts`:

Change the comment on line 6 from:
```ts
export const maxDuration = 300; // 5 min — covers ~40 customers across SF + Monday + K2.
```
to:
```ts
export const maxDuration = 300; // 5 min — covers ~40 customers across SF + K2.
```

Change the header comment (lines 8–11) from:
```ts
// Daily sync entrypoint — pulls the latest from every Phase 2 integration
// (Salesforce + Monday + Kognitos v2 + Linear tickets) into the *_cache
// tables. Wired to Vercel Cron at 02:30 UTC = 08:00 IST every day (see
// vercel.json).
```
to:
```ts
// Daily sync entrypoint — pulls the latest from every Phase 2 integration
// (Salesforce + Kognitos v2 + Linear tickets) into the *_cache
// tables. Wired to Vercel Cron at 02:30 UTC = 08:00 IST every day (see
// vercel.json).
```

Change the `sources` array (line 47) from:
```ts
    sources: ["salesforce", "monday", "kognitos-v2", "linear-tickets"],
```
to:
```ts
    sources: ["salesforce", "kognitos-v2", "linear-tickets"],
```

Remove the `monday: result.monday ?? null,` line from the JSON response (currently line 56):
```ts
      monday: result.monday ?? null,
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (confirms nothing else still references `SyncSource`'s `"monday"` member or `CombinedSyncResult.monday`).

Run: `npm test`
Expected: all existing tests still pass (there are no tests covering the runner/cron route today, so the count doesn't change).

- [ ] **Step 4: Commit**

```bash
git add lib/sync/runner.ts app/api/cron/daily-sync/route.ts
git commit -m "sync: remove Monday as a sync source"
```

---

### Task 2: Delete the Monday integration/sync modules

**Files:**
- Delete: `lib/sync/monday.ts`
- Delete: `lib/integrations/monday.ts`

**Interfaces:**
- Consumes: nothing — Task 1 already removed the only importer (`lib/sync/runner.ts`).
- Produces: nothing else in the codebase should import from these two paths after this task. Verified in Step 2.

- [ ] **Step 1: Delete the files**

```bash
git rm lib/sync/monday.ts lib/integrations/monday.ts
```

- [ ] **Step 2: Verify nothing else imports them**

Run: `grep -rn "lib/sync/monday\"\|lib/integrations/monday\"\|from \"\./monday\"" --include="*.ts" --include="*.tsx" app lib scripts`
Expected: no output (Task 1 removed the runner's import; nothing else referenced either file per the earlier dependency audit).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add -u lib/sync/monday.ts lib/integrations/monday.ts
git commit -m "sync: delete Monday integration and sync modules"
```

---

### Task 3: Remove the Customer 360 Activity tab

**Files:**
- Delete: `app/(app)/customers/[key]/_cards/activity-log-card.tsx`
- Modify: `app/(app)/customers/[key]/_components/customer-tabs.tsx`
- Modify: `app/(app)/customers/[key]/page.tsx`
- Modify: `lib/customers/view-model.ts`
- Modify: `lib/cache/integrations.ts`

**Interfaces:**
- Produces: `CustomerEnrichment` (in `lib/cache/integrations.ts`) no longer has an `activities` field or a `MondayActivityCache` type. `lib/customers/view-model.ts` no longer exports `ActivityLogCardProps` or `buildActivityLogCardProps`. `CustomerTabsProps` no longer has an `activityLogProps` field, and `CustomerTabs` no longer renders an "Activity" tab.
- Note: `freshness.monday_synced_at` on `CustomerEnrichment`, and `MondayProjectCache`/`MondayNpsCache`, are untouched — see Global Constraints.

- [ ] **Step 1: Strip the Activity-specific code out of `lib/cache/integrations.ts`**

Delete the `MondayActivityCache` interface (currently lines 79–94):
```ts
export interface MondayActivityCache {
  monday_item_id: string;
  name: string;
  group_title: string | null;
  state: string | null;
  monday_updated_at: string | null;
  // Lifted from raw_columns for sorting/filtering in the UI
  priority: string | null;
  status: string | null;
  due_date: string | null;
  created_date: string | null;
  resolved_date: string | null;
  ai_summary: string | null;
  source_link: string | null;
  meeting_excerpt: string | null;
}
```

Remove the `activities: MondayActivityCache[];` field from `CustomerEnrichment` (currently line 114).

Delete the `ACTIVITY_COLS` const (currently lines 122–134):
```ts
// Monday Activity Log column IDs for lifting fields out of raw_columns.
// Captured from the live board on 2026-04-30; if the columns are renamed
// in Monday these stay valid (column IDs are stable).
const ACTIVITY_COLS = {
  priority: "color_mm01d100",
  status: "color_mm01fb9d",
  due_date: "date_mm01r1zn",
  created_date: "date_mm01bkxq",
  resolved_date: "date_mm01vncb",
  ai_summary: "text_mm01867a",
  source_link: "link_mm01egt",
  raw_content: "long_text_mm016mph",
};
```

Delete the `RawColumns` interface and `txt()` helper (currently lines 143–149) — both are only used by the activity-mapping code being removed:
```ts
interface RawColumns {
  [columnId: string]: { type: string; text: string | null; value: string | null } | undefined;
}

function txt(cols: RawColumns | null | undefined, id: string): string | null {
  return cols?.[id]?.text?.trim() || null;
}
```

In `loadCustomerEnrichment`, remove `activities` from the `Promise.all` destructure and the `monday_activities` query (currently within lines 154–179):
```ts
  const [acc, opps, cases, processes, activities, nps] = await Promise.all([
    ...
    sb
      .from("monday_activities")
      .select("*")
      .eq("customer_id", customerId)
      .order("monday_updated_at", { ascending: false })
      .limit(100),
    ...
  ]);
```
becomes (drop the `activities` entry from both the destructure and the array):
```ts
  const [acc, opps, cases, processes, nps] = await Promise.all([
    ...
  ]);
```

Delete the `ActivityRow` type and the `activityCache` computation block (currently lines 219–255):
```ts
  type ActivityRow = {
    monday_item_id: string;
    name: string;
    group_title: string | null;
    state: string | null;
    monday_updated_at: string | null;
    raw_columns: RawColumns;
  };
  const activityCache: MondayActivityCache[] = (
    (activities.data as ActivityRow[] | null) ?? []
  ).map((a) => {
    const cols = a.raw_columns ?? {};
    const raw = txt(cols, ACTIVITY_COLS.raw_content);
    // Pull 280 chars of meeting context, stripped of the redundant
    // "Customer: X / Meeting: Y / Owner: Z" header that prefixes Fireflies
    // output.
    let excerpt: string | null = null;
    if (raw) {
      const stripped = raw.replace(/^(?:customer:|meeting:|owner:).*$/gim, "").trim();
      excerpt = stripped.length > 280 ? stripped.slice(0, 280) + "…" : stripped;
    }
    return {
      monday_item_id: a.monday_item_id,
      name: a.name,
      group_title: a.group_title,
      state: a.state,
      monday_updated_at: a.monday_updated_at,
      priority: txt(cols, ACTIVITY_COLS.priority),
      status: txt(cols, ACTIVITY_COLS.status),
      due_date: txt(cols, ACTIVITY_COLS.due_date),
      created_date: txt(cols, ACTIVITY_COLS.created_date),
      resolved_date: txt(cols, ACTIVITY_COLS.resolved_date),
      ai_summary: txt(cols, ACTIVITY_COLS.ai_summary),
      source_link: txt(cols, ACTIVITY_COLS.source_link),
      meeting_excerpt: excerpt,
    };
  });
```

Remove `activities: activityCache,` from the function's return object (in the `return { account: ..., activities: activityCache, ... }` block near the end of `loadCustomerEnrichment`).

- [ ] **Step 2: Delete the card component**

```bash
git rm "app/(app)/customers/[key]/_cards/activity-log-card.tsx"
```

- [ ] **Step 3: Remove the Activity tab from `customer-tabs.tsx`**

Remove the import (line 9):
```ts
import { ActivityLogCard } from "../_cards/activity-log-card";
```

Remove `ActivityLogCardProps` from the type-only import block (line 19), i.e.:
```ts
import type {
  ArrPoint,
  NpsTrendPoint,
  OpportunitiesCardProps,
  ProjectsCardProps,
  ActivityLogCardProps,
  EventsTasksCardProps,
  NpsResponsesCardProps,
} from "@/lib/customers/view-model";
```
becomes:
```ts
import type {
  ArrPoint,
  NpsTrendPoint,
  OpportunitiesCardProps,
  ProjectsCardProps,
  EventsTasksCardProps,
  NpsResponsesCardProps,
} from "@/lib/customers/view-model";
```

Remove `"Activity"` from the `TABS` array (line 35):
```ts
const TABS = [
  "Overview",
  "Projects",
  "NPS",
  "Documents",
  "Tasks",
  "Profile",
  "Rules",
  "Activity",
] as const;
```
becomes:
```ts
const TABS = [
  "Overview",
  "Projects",
  "NPS",
  "Documents",
  "Tasks",
  "Profile",
  "Rules",
] as const;
```

Remove `activityLogProps: ActivityLogCardProps;` from `CustomerTabsProps` (line 47).

Remove `activityLogProps` from the destructured props in the `CustomerTabs` function signature.

Delete the Activity tab's JSX block (currently lines 118–120):
```tsx
        {activeTab === "Activity" && (
          <ActivityLogCard {...activityLogProps} className="glass-card-hover" />
        )}
```

- [ ] **Step 4: Remove the wiring in `page.tsx`**

Remove `buildActivityLogCardProps` from the import block (line 21).

Remove the line building the props (line 95):
```ts
  const activityLogProps = buildActivityLogCardProps(customer, enrichment ?? null);
```

Remove the `activityLogProps={activityLogProps}` prop passed to `<CustomerTabs ... />` (line 130).

- [ ] **Step 5: Remove `buildActivityLogCardProps` from the view-model**

In `lib/customers/view-model.ts`, remove `MondayActivityCache` from the type-only import (line 8):
```ts
import type { CustomerEnrichment, MondayActivityCache } from "@/lib/cache/integrations";
```
becomes:
```ts
import type { CustomerEnrichment } from "@/lib/cache/integrations";
```

Delete the `ActivityLogCardProps` interface and `buildActivityLogCardProps` function (currently lines 510–527, the "Row 6: Audit" section):
```ts
// ─── Row 6: Audit ─────────────────────────────────────────────────────────

export interface ActivityLogCardProps {
  customerName: string;
  activities: MondayActivityCache[];
  openCount: number;
}

export function buildActivityLogCardProps(
  customer: Customer,
  enrichment: CustomerEnrichment | null
): ActivityLogCardProps {
  const activities = enrichment?.activities ?? [];
  const openCount = activities.filter(
    (a) => (a.status ?? "").toLowerCase() !== "closed" && !a.resolved_date
  ).length;
  return { customerName: customer.display_name, activities, openCount };
}
```

- [ ] **Step 6: Verify**

Run: `grep -rn "ActivityLogCard\|activityLogProps\|MondayActivityCache\|buildActivityLogCardProps" --include="*.ts" --include="*.tsx" app lib`
Expected: no output.

Run: `npm run build`
Expected: succeeds — this is the step that will catch any missed reference, since these are all real TypeScript imports/types.

Run: `npm test`
Expected: all tests pass (no test covers this card today, per the earlier audit of `tests/customers/view-model.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add -A -- "app/(app)/customers/[key]" lib/customers/view-model.ts lib/cache/integrations.ts
git commit -m "customers: remove Activity tab (Monday-sourced, no native replacement)"
```

---

### Task 4: Remove Monday from the dev sync console

**Files:**
- Modify: `app/api/dev/sync/status/route.ts`
- Modify: `app/dev/sync/sync-client.tsx`

**Interfaces:**
- Produces: `/api/dev/sync/status` response no longer includes `monday_projects`/`monday_activities`/`monday_nps_responses` in `counts`. The dev sync page no longer renders a "Monday match rates" panel or Monday count tiles.

- [ ] **Step 1: Trim the status route**

In `app/api/dev/sync/status/route.ts`, remove the three Monday queries from the `Promise.all` (and their destructured names):
```ts
  const [runs, sf, opps, cases, projects, activities, nps, k2Procs, k2Runs, k2Ws] = await Promise.all([
    sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(20),
    sb.from("sf_accounts").select("id", { count: "exact", head: true }),
    sb.from("sf_opportunities").select("id", { count: "exact", head: true }),
    sb.from("sf_cases").select("id", { count: "exact", head: true }),
    sb.from("monday_projects").select("id", { count: "exact", head: true }),
    sb.from("monday_activities").select("id", { count: "exact", head: true }),
    sb.from("monday_nps_responses").select("id", { count: "exact", head: true }),
    sb.from("k2_processes").select("id", { count: "exact", head: true }),
    sb.from("k2_runs").select("id", { count: "exact", head: true }),
    sb.from("k2_workspaces").select("id", { count: "exact", head: true }),
  ]);
```
becomes:
```ts
  const [runs, sf, opps, cases, k2Procs, k2Runs, k2Ws] = await Promise.all([
    sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(20),
    sb.from("sf_accounts").select("id", { count: "exact", head: true }),
    sb.from("sf_opportunities").select("id", { count: "exact", head: true }),
    sb.from("sf_cases").select("id", { count: "exact", head: true }),
    sb.from("k2_processes").select("id", { count: "exact", head: true }),
    sb.from("k2_runs").select("id", { count: "exact", head: true }),
    sb.from("k2_workspaces").select("id", { count: "exact", head: true }),
  ]);
```

Remove the three Monday fields from the response's `counts` object:
```ts
      monday_projects: projects.count ?? 0,
      monday_activities: activities.count ?? 0,
      monday_nps_responses: nps.count ?? 0,
```

- [ ] **Step 2: Remove the Monday panel from the dev sync client**

In `app/dev/sync/sync-client.tsx`, delete these now-unused type/helper/const declarations (lines 22–67):
```ts
interface BoardTier {
  label: string;
  key: "projects" | "activities" | "nps";
}

const MONDAY_BOARDS: BoardTier[] = [
  { label: "All Projects (total)", key: "projects" },
  { label: "Activity Log", key: "activities" },
  { label: "NPS Tracking", key: "nps" },
];

interface BoardCounts {
  fetched: number;
  matched: number;
  inserted: number;
}

interface PerBoardCounts extends BoardCounts {
  board_id: string;
  board_name: string;
  fiscal_year: string;
}

function extractMondayBoardCounts(details: Record<string, unknown> | null, key: BoardTier["key"]): BoardCounts | null {
  if (!details || typeof details !== "object") return null;
  const board = (details as Record<string, unknown>)[key];
  if (!board || typeof board !== "object") return null;
  const b = board as Record<string, unknown>;
  return {
    fetched: typeof b.fetched === "number" ? b.fetched : 0,
    matched: typeof b.matched === "number" ? b.matched : 0,
    inserted: typeof b.inserted === "number" ? b.inserted : 0,
  };
}

function extractProjectsByBoard(details: Record<string, unknown> | null): PerBoardCounts[] {
  if (!details || !Array.isArray(details.projects_by_board)) return [];
  return (details.projects_by_board as PerBoardCounts[]).map((b) => ({
    board_id: b.board_id,
    board_name: b.board_name,
    fiscal_year: b.fiscal_year,
    fetched: b.fetched ?? 0,
    matched: b.matched ?? 0,
    inserted: b.inserted ?? 0,
  }));
}
```

Remove the `latestMondayRun` line (line 106):
```ts
  const latestMondayRun = status?.runs.find((r) => r.source === "monday" && r.status === "ok") ?? null;
```

Delete the entire "Monday board match rates" block, i.e. everything from the comment through the closing `) : null}` (currently lines 124–185):
```tsx
      {/* Monday board match rates — surface the per-board fetched/matched/inserted
          counts from the most recent successful Monday sync. */}
      {latestMondayRun ? (
        <div className="rounded-md border border-[color:var(--brand-metal)] bg-white dark:bg-white/6 dark:border-white/15">
          ...
        </div>
      ) : null}
```

Remove the three Monday entries from the `COUNTS` array (currently lines 279–281):
```ts
  { key: "monday_projects", label: "Monday projects" },
  { key: "monday_activities", label: "Monday activities" },
  { key: "monday_nps_responses", label: "Monday NPS" },
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: succeeds (catches any leftover reference to the deleted helpers/types).

Run: `grep -n "monday\|Monday" app/api/dev/sync/status/route.ts app/dev/sync/sync-client.tsx`
Expected: no output.

Manual check: start the dev server (`npm run dev`), visit `/dev/sync`, confirm the page renders without a Monday panel and without console errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/dev/sync/status/route.ts app/dev/sync/sync-client.tsx
git commit -m "dev: remove Monday panel from sync console"
```

---

### Task 5: Delete the "Import Customers from Monday" dev wizard

**Files:**
- Delete: `app/dev/import/page.tsx`
- Delete: `app/dev/import/import-client.tsx`
- Delete: `app/api/dev/import/preview/route.ts`
- Delete: `app/api/dev/import/run/route.ts`
- Delete: `app/api/dev/probe/monday/boards/route.ts`
- Delete: `app/api/dev/probe/monday/board/[id]/route.ts`
- Modify: `app/dev/layout.tsx`
- Modify: `app/_components/app-shell.tsx`
- Modify: `app/_components/command-palette.tsx`

**Interfaces:**
- Produces: no route at `/dev/import` or `/api/dev/import/*` or `/api/dev/probe/monday/*`; no nav entry pointing to them.

- [ ] **Step 1: Delete the wizard pages and API routes**

```bash
git rm "app/dev/import/page.tsx" "app/dev/import/import-client.tsx"
git rm "app/api/dev/import/preview/route.ts" "app/api/dev/import/run/route.ts"
git rm "app/api/dev/probe/monday/boards/route.ts" "app/api/dev/probe/monday/board/[id]/route.ts"
```

If `app/dev/import/` or `app/api/dev/import/` or `app/api/dev/probe/monday/` are now empty directories, they'll simply not show up in git status — no separate cleanup needed.

- [ ] **Step 2: Remove the nav entries**

In `app/dev/layout.tsx`, remove this line from the `TABS` array:
```ts
  { href: "/dev/import", label: "Import customers" },
```

In `app/_components/app-shell.tsx`, remove this line from `SECONDARY_NAV`:
```ts
  { href: "/dev/import", label: "Import customers" },
```

In `app/_components/command-palette.tsx`, remove this line from `STATIC_COMMANDS`:
```ts
  { id: "import", label: "Import Customers", href: "/dev/import", group: "Tools" },
```

- [ ] **Step 3: Verify**

Run: `grep -rn "dev/import\|probe/monday" --include="*.ts" --include="*.tsx" app lib`
Expected: no output.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A -- app/dev/import app/api/dev/import app/api/dev/probe/monday app/dev/layout.tsx app/_components/app-shell.tsx app/_components/command-palette.tsx
git commit -m "dev: delete Monday customer-import wizard (no longer onboardable from Monday)"
```

---

### Task 6: Fix scripts that would break once the Monday tables are dropped

**Files:**
- Modify: `scripts/audit-data-health.ts`
- Modify: `scripts/backfill-profiles.ts`
- Modify: `scripts/db-sanity-check.ts`

**Interfaces:**
- Consumes: `nps_responses` table (native, `lib/supabase/types.ts`'s `NpsResponse`, fields include `customer_id`, `score`).
- Produces: none of these three scripts reference `monday_projects`/`monday_activities`/`monday_nps_responses` afterward.

- [ ] **Step 1: `scripts/audit-data-health.ts` — remove the Monday cache-table reads**

Remove the three Monday queries from `loadAll`'s `Promise.all` and their positions in the destructure/error-check arrays (currently lines 114, 123–125, 130):
```ts
  const [customers, profiles, internalProfiles, rules, sfAcc, sfOpps, sfCases, mProj, mAct, mNps, events, tasks, syncRuns] =
    await Promise.all([
      ...
      s.from("monday_projects").select("customer_id, monday_item_id"),
      s.from("monday_activities").select("customer_id, monday_item_id"),
      s.from("monday_nps_responses").select("customer_id, monday_item_id"),
      ...
    ]);
  for (const r of [customers, profiles, internalProfiles, rules, sfAcc, sfOpps, sfCases, mProj, mAct, mNps, events, tasks, syncRuns]) {
```
becomes (drop `mProj, mAct, mNps` from both arrays and the three `.from()` calls):
```ts
  const [customers, profiles, internalProfiles, rules, sfAcc, sfOpps, sfCases, events, tasks, syncRuns] =
    await Promise.all([
      ...
    ]);
  for (const r of [customers, profiles, internalProfiles, rules, sfAcc, sfOpps, sfCases, events, tasks, syncRuns]) {
```

Remove the three fields from `loadAll`'s return object (currently lines 164–166):
```ts
    mProj: mProj.data as Array<{ customer_id: string; monday_item_id: string }>,
    mAct: mAct.data as Array<{ customer_id: string; monday_item_id: string }>,
    mNps: mNps.data as Array<{ customer_id: string; monday_item_id: string }>,
```

Remove the three map-building blocks (currently lines 211–216):
```ts
  const projByC = new Map<string, number>();
  for (const r of data.mProj) projByC.set(r.customer_id, (projByC.get(r.customer_id) ?? 0) + 1);
  const actByC = new Map<string, number>();
  for (const r of data.mAct) actByC.set(r.customer_id, (actByC.get(r.customer_id) ?? 0) + 1);
  const npsByC = new Map<string, number>();
  for (const r of data.mNps) npsByC.set(r.customer_id, (npsByC.get(r.customer_id) ?? 0) + 1);
```

Remove the three cache-count fields from the `CustomerScore` type (currently lines 247–249):
```ts
    monday_projects: number;
    monday_activities: number;
    monday_nps: number;
```
(Keep `monday_mapped: boolean;` and `monday_workspace: boolean;` — those come from `customers.monday_item_id`/`monday_workspace_id`, not the dropped tables, and are out of scope for this project.)

Remove the issue check that depended on the removed maps (currently lines 277–278):
```ts
    if (cust.monday_item_id && !projByC.get(cust.id) && !actByC.get(cust.id) && !npsByC.get(cust.id))
      issues.push("Monday item mapped but no Monday data cached");
```

Remove the three cache-count fields from the per-customer score object (currently lines 294–296):
```ts
      monday_projects: projByC.get(cust.id) ?? 0,
      monday_activities: actByC.get(cust.id) ?? 0,
      monday_nps: npsByC.get(cust.id) ?? 0,
```

Simplify the `mondayTag` line (currently line 387) from:
```ts
      const mondayTag = `M:${s.monday_mapped ? "✓" : "—"}/p${s.monday_projects}/a${s.monday_activities}/n${s.monday_nps}`;
```
to:
```ts
      const mondayTag = `M:${s.monday_mapped ? "✓" : "—"}`;
```

Update the column legend (currently line 367) from:
```ts
  console.log("Columns: SF=mapped/synced  M=monday item/projects  Slack/Email/Drive/K1/K2  Pro/IPro/Rul  Issues");
```
to:
```ts
  console.log("Columns: SF=mapped/synced  M=monday item mapped  Slack/Email/Drive/K1/K2  Pro/IPro/Rul  Issues");
```

- [ ] **Step 2: `scripts/backfill-profiles.ts` — derive NPS score from native `nps_responses`**

Per `supabase/migrations/0021_processes_native.sql`'s own comment, `internal_profiles.nps_score` is meant to be derived from `nps_responses`, not the Monday cache — this script just hadn't been updated yet.

Remove the `MondayNpsCache` interface (currently lines 139–142):
```ts
interface MondayNpsCache {
  customer_id: string;
  raw_columns: Record<string, { text: string | null }>;
}
```

Change the query in the `Promise.all` (currently line 267) from:
```ts
    s.from("monday_nps_responses").select("customer_id, raw_columns"),
```
to:
```ts
    s.from("nps_responses").select("customer_id, score"),
```

Change the mapping (currently line 277) from:
```ts
  const nps = (npsRes.data as MondayNpsCache[]) ?? [];
```
to:
```ts
  const nps = (npsRes.data as Array<{ customer_id: string; score: number }>) ?? [];
```

Change the `npsByC` map's value type (currently line 296, `Map<string, MondayNpsCache[]>`) to `Map<string, Array<{ customer_id: string; score: number }>>`.

Replace the score-averaging block (currently lines 349–357) from:
```ts
    // NPS: take the most recent score from cache if present.
    let npsScore = 0;
    const scoreCol = "numeric_mm0aqvk3"; // captured in lib/cache/integrations.ts
    if (accNps.length > 0) {
      const scores = accNps
        .map((n) => Number(n.raw_columns?.[scoreCol]?.text ?? ""))
        .filter((n) => Number.isFinite(n));
      if (scores.length > 0) npsScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
```
to:
```ts
    // NPS: average of every native nps_responses row for this customer.
    let npsScore = 0;
    if (accNps.length > 0) {
      npsScore = Math.round(accNps.reduce((sum, n) => sum + n.score, 0) / accNps.length);
    }
```

Update the header comment (currently line 19) from:
```
//   internal_profile.nps_score      ← from cached monday_nps_responses if any
```
to:
```
//   internal_profile.nps_score      ← averaged from native nps_responses
```

- [ ] **Step 3: `scripts/db-sanity-check.ts` — drop the Monday table minimums**

Remove these two lines from `EXPECTED_MIN` (currently lines 32–33):
```ts
  monday_projects: 20,
  monday_nps_responses: 50,
```

- [ ] **Step 4: Verify**

Run: `grep -rn "monday_projects\|monday_activities\|monday_nps_responses\|MondayNpsCache" scripts/audit-data-health.ts scripts/backfill-profiles.ts scripts/db-sanity-check.ts`
Expected: no output.

These three are standalone scripts excluded from `tsconfig.json`'s type-checked set, so `npm run build` won't validate them. Confirm each parses by running:
```bash
npx tsx --eval "await import('./scripts/db-sanity-check.ts')" 2>&1 | head -20
```
Expected: no syntax/import errors (this only loads the module — `db-sanity-check.ts`'s `main()` only runs `if (require.main === module)`, so importing it doesn't hit the network). Do the same import-only check for the other two files; do not run `main()` for `audit-data-health.ts` or `backfill-profiles.ts` against production data as part of this task — `backfill-profiles.ts` in particular writes to `profiles`/`internal_profiles`.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-data-health.ts scripts/backfill-profiles.ts scripts/db-sanity-check.ts
git commit -m "scripts: stop reading Monday cache tables ahead of their removal"
```

---

### Task 7: Delete the remaining dead Monday-only scripts, tests, and import libs

**Files:**
- Delete: `scripts/monday-full-backup.ts`, `scripts/run-monday-sync.ts`, `scripts/import-monday-backup.ts`, `scripts/monday-sync-categories.ts`, `scripts/discover-monday-workspaces.ts`, `scripts/list-all-monday-boards.ts`, `scripts/publish-monday-update.ts`, `scripts/preview-monday-update.ts`, `scripts/verify-monday-update.ts`, `scripts/monday-post-updates.ts`, `scripts/dry-run-monday-projects-match.ts`, `scripts/map-customer-workspaces.ts`, `scripts/inspect-phases.ts`
- Delete: `scripts/.monday-write-plan.json`, `scripts/.monday-publish-log.json`
- Delete: `lib/import/monday-customers.ts`, `tests/import/monday-customers.test.ts`

**Interfaces:**
- Consumes: nothing after Task 5 (the only non-script, non-test importer of `lib/import/monday-customers.ts` was `app/api/dev/import/preview/route.ts`, deleted in Task 5).
- Produces: `lib/import/monday-taxonomy.ts` (kept — see Global Constraints) has no remaining sibling in `lib/import/` after this task besides its own file.

- [ ] **Step 1: Delete the dead scripts and their state files**

```bash
git rm scripts/monday-full-backup.ts scripts/run-monday-sync.ts scripts/import-monday-backup.ts \
       scripts/monday-sync-categories.ts scripts/discover-monday-workspaces.ts scripts/list-all-monday-boards.ts \
       scripts/publish-monday-update.ts scripts/preview-monday-update.ts scripts/verify-monday-update.ts \
       scripts/monday-post-updates.ts scripts/dry-run-monday-projects-match.ts scripts/map-customer-workspaces.ts \
       scripts/inspect-phases.ts
git rm scripts/.monday-write-plan.json scripts/.monday-publish-log.json
```

- [ ] **Step 2: Delete `lib/import/monday-customers.ts` and its test**

```bash
git rm lib/import/monday-customers.ts tests/import/monday-customers.test.ts
```

- [ ] **Step 3: Verify**

Run: `grep -rln "monday-customers\|import-monday-backup\|monday-full-backup\|monday-sync-categories\|discover-monday-workspaces\|list-all-monday-boards\|publish-monday-update\|preview-monday-update\|verify-monday-update\|monday-post-updates\|dry-run-monday-projects-match\|map-customer-workspaces\|inspect-phases" --include="*.ts" --include="*.tsx" app lib scripts tests`
Expected: no output.

Run: `npm test`
Expected: 15 test files pass (one fewer than before — `tests/import/monday-customers.test.ts` is gone; `tests/import/monday-taxonomy.test.ts` still runs).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "scripts: delete dead Monday-only scripts and the customer-import lib"
```

---

### Task 8: Drop the Monday cache tables

**Files:**
- Create: `supabase/migrations/0024_drop_monday_tables.sql`

**Interfaces:**
- Consumes: nothing — by this point (Tasks 1–7 done), no application code queries `monday_projects`, `monday_activities`, or `monday_nps_responses`.
- Produces: the three tables no longer exist. This is the irreversible step in the plan (Monday itself, and the local `monday-backup*/` snapshots, remain as history if ever needed).

- [ ] **Step 1: Confirm no remaining readers before dropping**

Run: `grep -rln "monday_projects\|monday_activities\|monday_nps_responses" --include="*.ts" --include="*.tsx" --include="*.sql" app lib scripts | grep -v "supabase/migrations/"`
Expected: no output. (Existing migration files 0004/0010/0013 that *created* these tables will still mention them — that's expected history, not a live reader.)

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0024_drop_monday_tables.sql`:
```sql
-- ALLOW_DESTRUCTIVE: Monday.com fully decommissioned (docs/MONDAY-DECOMMISSION-LOG.md).
-- Sync disabled (0001-sync-runner.ts no longer has a "monday" source), the last live
-- reader (Customer 360 Activity tab) was removed, and no other code reads these tables
-- (verified via repo-wide grep immediately before this migration was written). Monday
-- itself remains the source of truth if this data is ever needed again; local
-- monday-backup*/ snapshots also exist (gitignored, not in this repo).

drop table if exists monday_projects;
drop table if exists monday_activities;
drop table if exists monday_nps_responses;
```

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP `apply_migration` tool against the production project (`prnakdaxcpzagntgvaqf`, per `docs/STATUS.md`), passing the exact SQL above with a migration name of `drop_monday_tables`.

- [ ] **Step 4: Verify**

Use the Supabase MCP `list_tables` tool (or `mcp__claude_ai_Supabase__list_tables`) and confirm `monday_projects`, `monday_activities`, and `monday_nps_responses` are no longer in the list.

Run: `npm run build && npm test`
Expected: both succeed (this migration doesn't change any TypeScript, so this just reconfirms the tree is still healthy).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_drop_monday_tables.sql
git commit -m "schema: drop monday_projects, monday_activities, monday_nps_responses"
```

---

### Task 9: Remove the Monday env var, credentials doc, and update status docs

**Files:**
- Modify: `.env.example`
- Modify: `docs/CREDENTIALS.md`
- Modify: `docs/STATUS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/MONDAY-DECOMMISSION-LOG.md`

**Interfaces:**
- Produces: no file in the repo references `MONDAY_API_TOKEN` or documents Monday as a live dependency.

- [ ] **Step 1: `.env.example`**

Remove lines 70–72:
```
# Monday.com
MONDAY_API_TOKEN=

```
(the blank line after it too, so the file doesn't gain a double blank line — check the result reads cleanly against the surrounding `# Kognitos v1 (legacy)` block above and `# Linear` block below).

- [ ] **Step 2: `docs/CREDENTIALS.md` — remove the whole Monday setup section**

Remove the TOC entry (line 15):
```
  - [5. Monday.com — API token](#5-mondaycom--api-token)
```

Delete the entire `## 5. Monday.com — API token` section, from its header through the end of its "Gotchas" bullet list (currently lines 416–440), but leave the `---` divider at line 441 in place as the separator before `# Tier 2 — production deploy`. (Section numbers 1–4 and 6–11 are intentionally left as-is — do not renumber; renumbering would require updating every markdown anchor link that references sections 6–11 elsewhere in this file, which is unnecessary churn for a numbering cosmetic.)

Remove the `MONDAY_API_TOKEN` line from the Tier 2 §8b env var list (currently line 555, inside the fenced block that also lists `KOGNITOS_V2_WORKSPACE_ID` above it and `SESSION_SECRET` below it).

Remove the two-line Monday block from the "Final `.env.local` example" section (currently lines 729–730):
```
# Monday.com
MONDAY_API_TOKEN=eyJhbGc…
```

In the production deploy checklist, change (currently line 748):
```
- [ ] Tier 1 integrations done (Slack + Google + Salesforce + Kognitos + Monday)
```
to:
```
- [ ] Tier 1 integrations done (Slack + Google + Salesforce + Kognitos)
```

Remove the `- [ ] Monday board ID` line from the pilot-customer mapping checklist (currently line 754).

- [ ] **Step 3: `docs/STATUS.md`**

Change line 20 from:
```
- `monday_projects` is no longer read anywhere. `monday_activities`/`monday_nps_responses` are still synced daily, but only `monday_activities` still has a live reader (the customer-360 Activity tab — no native replacement was planned; removing that tab is a pending UI decision, see `MONDAY-DECOMMISSION-LOG.md`).
```
to:
```
- Monday is fully decommissioned: the nightly sync no longer includes it, the Activity tab (its last live UI reader) was removed, and `monday_projects`/`monday_activities`/`monday_nps_responses` were dropped. See `MONDAY-DECOMMISSION-LOG.md` for the full history.
```

Update line 9's cron description from:
```
Two Vercel Hobby crons run: `daily-sync` at 02:30 UTC (Salesforce, Monday, Kognitos v2, Linear tickets into the cache tables) and `run-tasks` at 08:00 UTC (dispatches due `tasks`).
```
to:
```
Two Vercel Hobby crons run: `daily-sync` at 02:30 UTC (Salesforce, Kognitos v2, Linear tickets into the cache tables) and `run-tasks` at 08:00 UTC (dispatches due `tasks`).
```

- [ ] **Step 4: `CLAUDE.md`**

Change the data-model paragraph (line 16) — replace:
```
Cache tables written by the daily sync: `sf_*`, `k2_workspaces`/`k2_processes`/`k2_runs`, `monday_activities`/`monday_nps_responses` (still synced, but only `monday_activities` still has a live UI reader — the customer-360 Activity tab; every other Monday read path was rewired onto `processes`/native tables during the 2026-08 decommission). `monday_projects` is no longer read anywhere.
```
with:
```
Cache tables written by the daily sync: `sf_*`, `k2_workspaces`/`k2_processes`/`k2_runs`. Monday is fully decommissioned (2026-08) — the sync, the Activity tab, and the three Monday cache tables are gone; see `MONDAY-DECOMMISSION-LOG.md`.
```

Update the architecture-map line (line 11) — remove `monday` from the `integrations/` parenthetical:
```
- `lib/` — business logic: `agent/` (runner + 20-plus tools), `integrations/` (salesforce, monday, kognitos, linear, google), ...
```
becomes:
```
- `lib/` — business logic: `agent/` (runner + 20-plus tools), `integrations/` (salesforce, kognitos, linear, google), ...
```

Remove the `monday-backup/` mention from the Gotchas section (line 32) — this folder itself is out of scope (still there, still gitignored), but the sentence framing it as an active Monday-migration artifact is now stale:
```
The `monday-backup/` folder holds a local Monday export and is gitignored.
```
Delete this sentence from the Gotchas paragraph.

- [ ] **Step 5: Append a closing entry to `docs/MONDAY-DECOMMISSION-LOG.md`**

Append, matching the file's existing bold-header/bullet style:
```markdown

## 2026-08-12 — Full decommission complete

Closes out the work this log has tracked since its first entry. Per Rishabh: "let's be self
sufficient now and be independent of monday entirely."

- **1.10 done**: Monday removed from `DEFAULT_SOURCES` in `lib/sync/runner.ts` and from the
  `daily-sync` cron's `sources` list. `lib/sync/monday.ts` and `lib/integrations/monday.ts` deleted.
- **`monday_activities` resolved**: the Activity tab (customer-360) was removed outright, not
  migrated — confirmed with Rishabh that it's a Fireflies-transcript-derived ticket workflow with no
  native equivalent, and building one is out of scope for this pass.
- All three cache tables (`monday_projects`, `monday_activities`, `monday_nps_responses`) dropped via
  `supabase/migrations/0024_drop_monday_tables.sql`.
- Dead code removed: the Monday-only sync/integration modules, the "Import Customers from Monday" dev
  wizard, ~13 one-off `scripts/*monday*` scripts and their JSON state files, `lib/import/
  monday-customers.ts`. `lib/import/monday-taxonomy.ts` and `lib/delivery/taxonomy.ts`'s
  `legacyFieldsFromProcess()` were kept — both are naming-legacy shims for native `processes` data,
  not Monday API dependencies.
- `MONDAY_API_TOKEN` removed from `.env.example` and `docs/CREDENTIALS.md`. Manual follow-up (outside
  this repo): revoke the token in Monday's admin panel and remove it from Vercel's project env vars.
- Row-for-row verification (1.9) was never fully completed before this — noted here in case a report
  discrepancy surfaces later and someone needs to know Monday is no longer available to diff against.

**Not touched, intentionally out of scope**: the local gitignored `monday-backup*/` folders (real
customer data snapshots, never committed — Rishabh's to manage); `customers.monday_item_id` /
`monday_workspace_id` columns (legacy mapping IDs on the customers table itself, a separate schema
surface from the three cache tables this pass targeted).
```

- [ ] **Step 6: Verify**

Run: `grep -rln "MONDAY_API_TOKEN" --include="*" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=monday-backup* --exclude-dir=monday-backup-2026-07-30 --exclude-dir=monday-backup-2026-08-03 --exclude-dir=monday-backup-2026-08-06-live`
Expected: no output.

Run: `npm run build && npm test`
Expected: both succeed (docs/env changes don't affect code, but this confirms nothing upstream broke).

- [ ] **Step 7: Commit**

```bash
git add .env.example docs/CREDENTIALS.md docs/STATUS.md CLAUDE.md docs/MONDAY-DECOMMISSION-LOG.md
git commit -m "docs: close out Monday decommission, remove MONDAY_API_TOKEN"
```

---

## Final sweep (do this once, after Task 9)

Run: `grep -rniE "monday" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md" --exclude-dir=node_modules --exclude-dir=.git .`

Expected remaining hits, all legitimate and already accounted for above — confirm nothing else shows up:
- `lib/import/monday-taxonomy.ts`, `tests/import/monday-taxonomy.test.ts` (kept, live)
- `lib/delivery/taxonomy.ts` (`MONDAY_PROJECT_COLS`, `legacyFieldsFromProcess`, kept, live)
- `lib/cache/integrations.ts` / `lib/customers/view-model.ts` (`MondayProjectCache`, `MondayNpsCache`, `monday_synced_at`/`mondaySyncedAt` — kept, live, see Global Constraints)
- `lib/processes/loader.ts` (imports from `monday-taxonomy.ts` — kept, live)
- `supabase/migrations/0004_*.sql`, `0010_*.sql`, `0013_*.sql`, `0024_*.sql` (historical/the drop migration itself)
- `docs/MONDAY-DECOMMISSION-LOG.md`, `docs/DELIVERYOPS-CONSOLIDATION-PLAN.md`, `docs/superpowers/specs/2026-08-12-monday-full-decommission-design.md`, this plan file, `docs/RUNBOOK.md` if it mentions Monday recovery (historical/documentation, not code)
- `customers.monday_item_id`/`monday_workspace_id` column references anywhere in `lib/customers/`, `lib/supabase/types.ts`, etc. (customer-registry columns, explicitly out of scope)

If anything else turns up, it's a gap this plan missed — file it before considering the work done.
