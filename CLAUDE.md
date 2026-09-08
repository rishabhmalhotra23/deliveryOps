# DeliveryOps — repo guide for Claude

Operational system of record for the Kognitos FDE team. Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 on Supabase, deployed on Vercel. Production with real customer data, so be careful.

Start here: [docs/INDEX.md](./docs/INDEX.md) maps every doc. The current plan and state are in [docs/DELIVERYOPS-CONSOLIDATION-PLAN.md](./docs/DELIVERYOPS-CONSOLIDATION-PLAN.md) and [docs/STATUS.md](./docs/STATUS.md). Read those before proposing architecture.

## What this is for

An **AI-first platform for Delivery and Customer Success**: the customer 360
(everything happening with a customer, good or bad), the metrics (NPS, NRR,
ARR, TTV), the projects delivered per customer plus the pipeline, team
workload, reports for internal **and external** leadership, and Salesforce /
Slack / Google Suite connections that automate as much of a user's work as
possible. Full statement and its consequences: [docs/VISION.md](./docs/VISION.md).

Four things that follow, worth holding when a call is close:

- **"AI-first" is about removing steps, not adding a chat box.**
- **"Good or bad" means bad news must surface** — blockers, escalations,
  detractor NPS and stale records are what earn the 360 its place.
- **"External leadership" raises the bar on every number.** Approximately
  right is fine internally and not fine in a customer's boardroom. This is why
  confirmed ARR beats the import snapshot, why an override records who and
  why, and why the All-Hands report keeps a stricter definition of "migration
  work" than the Delivery tab.
- **"As much as possible" is bounded by trust.** Slack and email never write a
  field — they append to `events` or create something a human accepts.

Metric status: ARR, NPS and TTV are live. **NRR is not built** (needs renewal
outcomes against prior-period ARR; `sf_opportunities` has the raw material).
**Workload is a count, not a load** — no capacity model.

## Everything is editable from the product

The bar, set 2026-09-08: **changing data must never need a code change.** Add
or remove a customer, retire one, change any customer or project state, edit
the roster, correct a Salesforce number, add a migration stage — all from the
UI. If something isn't editable, that's the bug.

- **Customers** — `/customers/[key]`'s record card (right rail): name,
  category (mint new ones), status, AE, partner, Slack, SF account ID,
  industry, tier, HQ, plus remove/restore. Also Delivery → Configure →
  Customers.
- **Processes** — table and drawer, every field. Section follows from
  `lifecycle` + `migration_stage`.
- **Roster** — Delivery → Configure → Roster.
- **Vocabularies** — Delivery → Configure → Vocabularies. Label, short label,
  colour, order, retire, add. Adding runs `ALTER TYPE` via
  `add_vocabulary_value()` and **cannot be undone**; retiring is
  `active = false`.
- **Salesforce-derived values** (confirmed ARR, renewal date) — editable with
  a confirm step that asks whether the source was wrong, then remembers it in
  `field_overrides` (0041) with who/when/why. Never written back to Salesforce.
- **Tunables** — `app_settings` (0043): the value-delivered model
  (hours-by-complexity, $/hr bands, hours per FTE) and the NPS cadence.

Still code-only: the NPS invite/reminder email **bodies** (they carry `{{name}}`
interpolation the send path renders).

## Architecture map

- `app/(app)/` — routes: `dashboard` (Overview + Trends tabs — Trends is the former `/analytics`, folded in 2026-08-10; `/analytics` now redirects), `customers` and `customers/[key]` (the customer 360), `delivery` (Active work / V2 migration / Historical — see below), `reports`, `operations`.
- `app/api/` — backend routes, including `cron/` (daily-sync, run-tasks, monthly-digest), `slack/`, `gmail/`, `jobs/`, `chat/`.
- `lib/` — business logic: `delivery/` (`sections.ts` — derived section routing, `historical.ts`, `reorder.ts`, `hues.ts`, `labels.ts`, `columns.ts`), `roster/`, `agent/` (runner + 20-plus tools), `integrations/` (salesforce, kognitos, linear, google), `sync/` (per-source runners), `ingestion/` (doc pipeline), `approvals/` (Slack-gated human approval), `reports/` (`allhands-loader.ts`, `delivery-review.ts`, `migration-progress.ts`, `weekly-loader.ts`), `customers/`, `commercials/`, `supabase/`.
- `supabase/migrations/` — schema (0001 to 0043). Full dump at `docs/supabase-schema-full.sql` (stale — predates 0020+, regenerate before trusting it).
- `docs/` — `VISION.md` (what this is for), `STATUS.md` (current state), `INDEX.md` (map of every doc), `briefs/` (implementation briefs from design work), `mockups/` (approved designs, dated), `schema/foreign-keys.json` (snapshot the embedded-relation test reads).
- `archive/` — gitignored. Superseded code kept for reference (`superseded/`, with a README explaining what replaced what), design exports, one-off spreadsheets. Nothing here is built.
- `legacy/` — the pre-Next.js Python prototype, tracked deliberately as reference. Zero imports from the app; excluded from tsc. Full dump at `docs/supabase-schema-full.sql` (stale — predates 0020+, regenerate before trusting it).

## Data model in one breath

`customers` (the customer roster — external IDs, `deliveryops_protected_fields`, and `active` (0039): false hides it from every customer picker while keeping its processes and 360 page, deliberately orthogonal to `custom_category`, which is a reporting bucket), `profiles` (customer-facing, has `arr`) and `internal_profiles` (service-role only), `events` (per-customer activity log), `conversations`, `tasks` (scheduler), `pending_approvals` (approval queue). `processes` (migration 0021, renamed/widened from the old `migration_processes`) is the native one-row-per-process record — delivery lifecycle (`lifecycle`/`phase`/`health`/`blocked_on`) and V2 migration (`migration_stage`, `linear_ticket_ids`, dates) live on the same row. `roster_entries`/`roster_aliases` (0032) are the canonical FDE/TAM/Partner roster, with `roles` and `active`; the `*_owner` text columns on `processes` are a denormalized mirror kept in sync both ways (`updateProcess` one way, `rename_roster_entry()` (0038) the other). `linear_tickets` (0017/0018) caches synced Linear issues, gated for report visibility by `in_scope`/`classification`. Cache tables written by the daily sync: `sf_*`, `k2_workspaces`/`k2_processes`/`k2_runs`. Monday is fully decommissioned (2026-08) — the sync, the Activity tab, and the three Monday cache tables are gone; see `MONDAY-DECOMMISSION-LOG.md`.

## Current focus

Monday is retired as the reporting backbone. Two live, data-driven reports exist: **All-Hands** (`/reports/v2-migration`, `lib/reports/allhands-loader.ts`) and **Weekly Delivery Review** (`/reports/delivery-review`, `lib/reports/delivery-review.ts`) — both read `processes`/`linear_tickets` directly, no hand-maintained content. The old `/reports/weekly` page and `lib/reports/v2-migration-allhands.ts` are deleted. `LINEAR_API_TOKEN` is set in Vercel (2026-08-10) and wired into the existing `daily-sync` cron (02:30 UTC).

All-Hands was **trimmed to three sections on 2026-09-08** (Rishabh) — delivery portfolio, fresh V2 builds, V2 migration programme. The renewal spotlight, at-risk-and-migrating, this-week's-blockers, hard-blocker chip rows and ticket-health tiles were deleted from `allhands-client.tsx`; don't reinstate them without being asked. `loadAllHandsReport()` still computes all of those fields, so restoring any of them is a UI-only change (see the comment on the `const { status } = report` destructure). Ticket detail lives on `/reports/v2-migration/tickets`, which is unchanged.

Frontend Stage A shipped 2026-08-10 (spec: `docs/superpowers/specs/2026-08-07-app-design-foundation-design.md`): the app is **dark-mode-primary by default** (`app/providers.tsx`'s `defaultTheme="dark"`). `--surface-1`/`--surface-2`/`--foreground-muted`/`--foreground-body`/`--status-good`/`--status-bad` and the 8-hue `--st-*` chip triads live in `app/globals.css`. `/analytics` is merged into `/dashboard` as an Overview/Trends tab pair; **the 11 portfolio charts live there, not on Delivery** — Delivery timeline, Value by domain, ARR by category, Customer portfolio, four NPS charts, TTV distribution and TTV trend. Don't "restore" them elsewhere; Delivery's Historical section covers the process-level per-quarter view instead.

### Delivery workspace (reworked 2026-09-04)

Three sections, and **which one a process is in is derived, never stored** — `sectionFor()` in `lib/delivery/sections.ts` is a pure function of `lifecycle` + `migration_stage`, so changing either field moves the row. This was an explicit requirement: no hardcoded per-project placement anywhere.

- **Active work** — `migration_stage = v2_native` **and not yet live**. Work in flight: backlog, discovery, in development, UAT, on hold. `createProcess` defaults new rows here. `live` leaves for Historical (2026-09-08) — Active work means in flight, and shipping is an exit from it.
- **V2 migration** — everything else. The migrate-or-retire list, including `not_required` and `to_be_retired` (0039). **Deliberately keeps its live rows**, unlike Active work: a process running live on V1 is still on the migrate-or-retire list, and applying the Active-work rule here would move 58 of 65 rows out and collapse the section to 5. Two sections, two questions, two rules.
- **Historical** — ended lifecycles, work routed here by `sectionFor` (live + `v2_native`), plus (as a *lens*) anything already shipped. Grouped by fiscal quarter by `lib/delivery/historical.ts`. Counts deliberately don't sum to the total.
  **Use `inHistoricalSection()`, never `inHistoricalLens()` alone** — the lens is false for a row with no go-live date, so a process marked live without one would satisfy neither test and appear in *no* section. The union is what keeps it reachable, in the "No go-live date" bucket where it can be fixed. `verify:db` asserts visibility, not just that `sectionFor` returned a valid string.

**A board must never silently drop a row.** `bucketRows()` in `app/_components/process-board.tsx` used to push only when it found a lane: `laneFor()` returns `null` for `live`, and `not_required` was filtered out of the V2 lane list while `sectionFor` kept all 29 of those rows in the section's count. That is why one section showed three different totals. Anything unplaceable now lands in an explicit trailing lane, and `tests/delivery/board-lanes.test.ts` pins lane totals to the input count.

**Tab counts are post-filter.** They were computed before search and filters while the table rendered after, and `?person=` deep links seed a filter on mount — so a tab could read 11 above a table showing 3 with nobody having touched a control.

**`phase` is gone** (0044, 2026-09-08). It was derived 1:1 from `lifecycle` on every write, blank on 111 of 149 rows, and stale where set — 4 `retired` processes still read "M1 - Discovery". Post-live nuance lives on `work_mode`. The Trends chart is "Projects by delivery stage" now, `lib/delivery/taxonomy.ts`'s legacy bridge exposes `lifecycle_label`, and `EXTENDABLE_VOCABULARIES` is six enums, not seven. Don't reintroduce it.

**`went_live_at` is stamped by `stampGoLive()`** in `lib/processes/store.ts`, once and idempotently, when `lifecycle` flips to `live` or `migration_stage` reaches `live_on_v2` — and appends a `MILESTONE` event, the first process-side writer `events` has had. No write path stamped it before 0044 (the 11 rows that had a value came from the Monday import); the Slack notifier this unblocks is still archived at `archive/superseded/lib-migrations/notify.ts` and deliberately not wired.

`isV2Relevant()` in `lib/processes/loader.ts` is a **different question** — "is there real evidence this went through migration work?" — and exists only for the All-Hands report. Never widen it for section routing; doing so pulls 28 live V1 processes into the migration funnel and overstates the programme. Any new `migration_stage` value must be explicitly excluded there if it isn't migration work (the test is `<> not_required`, so new values are included by default).

Fiscal quarters are Feb–Jan named for the year they end in; use `fiscalQuarterOf()` from `lib/nps/constants.ts`. `loader.ts`'s older `qonq` aggregate keys on *calendar* quarters — don't mix them.

Manual ordering: `board_position` (per board lane) and `table_position` (flat table) are separate columns because board positions repeat across lanes. Shared math in `lib/delivery/reorder.ts`. Both are excluded from `processes.updated_at` by the trigger (0036/0037), as are roster renames (0038) — `updated_at` means "content last changed" and every staleness signal reads it.

Roster and customer management both live in **Delivery → Configure** (Roster and Customers tabs). Roster: rename, roles, **email**, **notes**, **aliases** (view/add/remove — `roster_aliases` had no UI at all before 2026-09-08) and **merge** (`merge_roster_entry()` (0040) and its API route were fully built with no caller, so de-duplication had no front door). Customers: name, category — **which can now mint a new value**, since `custom_category` is free text in Postgres and the closed `<select>` was the only thing making a new category need a code change — plus active/inactive. Marking someone inactive never touches their existing assignments.

## Deploy workflow (follow exactly)

Edit files and verify with `npm run build`, type-check, and `vitest run`. The agent may run `git add`/`commit`/`push` directly (2026-08-04: Rishabh lifted the earlier no-push rule) — stage only the files actually changed, never `git add -A`. Push to `main` over SSH; Vercel auto-deploys. A husky pre-commit hook runs vitest, so pin locales in code (`toLocaleString("en-US")`). After a push, confirm the Vercel deployment reached READY via the Vercel connector (project "delivery-ops").

**`npm run verify:db` is mandatory before pushing anything that touches a query or a migration.** A pre-push hook runs it; it blocks on failure and skips loudly if no database is reachable. Do not treat type-check + tests + build as evidence that a query works — see below.

### Why: the 2026-09-08 outage

`loadOverrideMap` shipped `.select("value, customers!inner(key)")`. PostgREST resolves an embedded relation through a foreign key, and `field_overrides.entity_id` deliberately has none — it is polymorphic. The query could never work. It took `/delivery`, `/customers/[key]` and `/reports/v2-migration` down, and it passed **type-check, 405 unit tests and a clean production build** on the way out, because **not one of those executes a query**. Every store test stubs above the Supabase client.

Three guardrails now cover that gap:

- `tests/schema/embedded-relations.test.ts` — parses every `.from(...).select(...)` pair out of the source and asserts each embedded relation has a real FK in `docs/schema/foreign-keys.json`. No database needed, so it runs in the pre-commit hook. Verified to fail on the exact outage query.
- `scripts/verify-db.ts` (`npm run verify:db`) — **executes** every loader the pages call, then checks the data invariants no constraint can enforce (owner text mirrors matching their FK, every process routing to a section, every enum value in use having a label, no orphaned overrides). Verified to fail on the outage query, naming all 8 affected loaders.
- `.husky/pre-push` — runs the above.

`docs/schema/foreign-keys.json` is a checked-in snapshot; regenerate with `npm run verify:db -- --dump-fks` when a migration adds a FK. A stale snapshot can only cause a false failure, never a false pass.

### Migrations

Apply them locally too, not only to production. Migrations applied to production via the Supabase connector left the local database four versions behind on 2026-09-08, which is what made `verify:db` and `scripts/audit-queue-volume.ts` fail against a schema that no longer matched. `npx tsx scripts/safe-migrate.ts` applies pending files locally and is how you confirm a hand-pasted production change matches the checked-in SQL.

Known risk: running git from the sandbox concurrently with the user's own terminal/IDE can leave a stale `.git/index.lock` that blocks the user's next local git command — if the user reports a stuck `git` command right after a sandbox push, that lock file is the first thing to check (`rm .git/index.lock` once no git process is actually running).

## Conventions worth knowing before writing a query

- **Loaders take their inputs, they don't fetch them.** `getConfirmedArrForCustomer`
  takes the override map; `buildArrStatProps` takes it too; `vocabLabel` takes
  the vocab map. Pure functions stay testable, and per-request data threaded as
  a prop can't leak between requests the way module state can. Both of
  2026-09-08's database bugs came from breaking this in spirit.
- **`processes` keeps both halves of every owner** (0032): `fde_owner_id` and
  `fde_owner`. Any write that moves one must move the other, or the roster and
  the Delivery table disagree. `rename_roster_entry()` (0038) and
  `merge_roster_entry()` (0040) do it in one transaction with `updated_at`
  preserved; `verify:db` asserts they agree.
- **`field_overrides.entity_id` is polymorphic** — customer, process or
  profile. It has no foreign key on purpose, so it **cannot** be used in a
  PostgREST embedded relation. Join in memory. This is what caused the outage.
- **`updated_at` on `processes` means "content last changed".** Manual
  ordering, mark-reviewed, roster renames and merges all preserve it
  (0036/0037/0038/0040). Every staleness signal reads it.

## Gotchas

Hobby plan caps Vercel crons at 2; new scheduled work should ride the `tasks` + `run-tasks` dispatcher. Gmail send is blocked on Google Workspace admin. Show a visual mockup of any UI or report change for approval before editing code. Match the existing design system (glass cards, brand tokens in `app/globals.css`).
