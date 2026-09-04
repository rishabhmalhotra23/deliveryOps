# DeliveryOps — repo guide for Claude

Operational system of record for the Kognitos FDE team. Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 on Supabase, deployed on Vercel. Production with real customer data, so be careful.

Start here: [docs/INDEX.md](./docs/INDEX.md) maps every doc. The current plan and state are in [docs/DELIVERYOPS-CONSOLIDATION-PLAN.md](./docs/DELIVERYOPS-CONSOLIDATION-PLAN.md) and [docs/STATUS.md](./docs/STATUS.md). Read those before proposing architecture.

## Architecture map

- `app/(app)/` — routes: `dashboard` (Overview + Trends tabs — Trends is the former `/analytics`, folded in 2026-08-10; `/analytics` now redirects), `customers` and `customers/[key]` (the customer 360), `delivery` (Active work / V2 migration / Historical — see below), `reports`, `operations`.
- `app/api/` — backend routes, including `cron/` (daily-sync, run-tasks, monthly-digest), `slack/`, `gmail/`, `jobs/`, `chat/`.
- `lib/` — business logic: `delivery/` (`sections.ts` — derived section routing, `historical.ts`, `reorder.ts`, `hues.ts`, `labels.ts`, `columns.ts`), `roster/`, `agent/` (runner + 20-plus tools), `integrations/` (salesforce, kognitos, linear, google), `sync/` (per-source runners), `ingestion/` (doc pipeline), `approvals/` (Slack-gated human approval), `reports/` (`allhands-loader.ts`, `delivery-review.ts`, `migration-progress.ts`, `weekly-loader.ts`), `customers/`, `commercials/`, `supabase/`.
- `supabase/migrations/` — schema (0001 to 0039). Full dump at `docs/supabase-schema-full.sql` (stale — predates 0020+, regenerate before trusting it).

## Data model in one breath

`customers` (the customer roster — external IDs, `deliveryops_protected_fields`, and `active` (0039): false hides it from every customer picker while keeping its processes and 360 page, deliberately orthogonal to `custom_category`, which is a reporting bucket), `profiles` (customer-facing, has `arr`) and `internal_profiles` (service-role only), `events` (per-customer activity log), `conversations`, `tasks` (scheduler), `pending_approvals` (approval queue). `processes` (migration 0021, renamed/widened from the old `migration_processes`) is the native one-row-per-process record — delivery lifecycle (`lifecycle`/`phase`/`health`/`blocked_on`) and V2 migration (`migration_stage`, `linear_ticket_ids`, dates) live on the same row. `roster_entries`/`roster_aliases` (0032) are the canonical FDE/TAM/Partner roster, with `roles` and `active`; the `*_owner` text columns on `processes` are a denormalized mirror kept in sync both ways (`updateProcess` one way, `rename_roster_entry()` (0038) the other). `linear_tickets` (0017/0018) caches synced Linear issues, gated for report visibility by `in_scope`/`classification`. Cache tables written by the daily sync: `sf_*`, `k2_workspaces`/`k2_processes`/`k2_runs`. Monday is fully decommissioned (2026-08) — the sync, the Activity tab, and the three Monday cache tables are gone; see `MONDAY-DECOMMISSION-LOG.md`.

## Current focus

Monday is retired as the reporting backbone. Two live, data-driven reports exist: **All-Hands** (`/reports/v2-migration`, `lib/reports/allhands-loader.ts`) and **Weekly Delivery Review** (`/reports/delivery-review`, `lib/reports/delivery-review.ts`) — both read `processes`/`linear_tickets` directly, no hand-maintained content. The old `/reports/weekly` page and `lib/reports/v2-migration-allhands.ts` are deleted. `LINEAR_API_TOKEN` is set in Vercel (2026-08-10) and wired into the existing `daily-sync` cron (02:30 UTC).

Frontend Stage A shipped 2026-08-10 (spec: `docs/superpowers/specs/2026-08-07-app-design-foundation-design.md`): the app is **dark-mode-primary by default** (`app/providers.tsx`'s `defaultTheme="dark"`). `--surface-1`/`--surface-2`/`--foreground-muted`/`--foreground-body`/`--status-good`/`--status-bad` and the 8-hue `--st-*` chip triads live in `app/globals.css`. `/analytics` is merged into `/dashboard` as an Overview/Trends tab pair; **the 11 portfolio charts live there, not on Delivery** — Delivery timeline, Value by domain, ARR by category, Customer portfolio, four NPS charts, TTV distribution and TTV trend. Don't "restore" them elsewhere; Delivery's Historical section covers the process-level per-quarter view instead.

### Delivery workspace (reworked 2026-09-04)

Three sections, and **which one a process is in is derived, never stored** — `sectionFor()` in `lib/delivery/sections.ts` is a pure function of `lifecycle` + `migration_stage`, so changing either field moves the row. This was an explicit requirement: no hardcoded per-project placement anywhere.

- **Active work** — `migration_stage = v2_native`. New V2 development. `createProcess` defaults new rows here.
- **V2 migration** — everything else. The migrate-or-retire list, including `not_required` and `to_be_retired` (0039).
- **Historical** — ended lifecycles, plus (as a *lens*, via `inHistoricalLens`) anything with a go-live date. Grouped by fiscal quarter by `lib/delivery/historical.ts`. Counts deliberately don't sum to the total: a live process appears in both its operational section and here.

`isV2Relevant()` in `lib/processes/loader.ts` is a **different question** — "is there real evidence this went through migration work?" — and exists only for the All-Hands report. Never widen it for section routing; doing so pulls 28 live V1 processes into the migration funnel and overstates the programme. Any new `migration_stage` value must be explicitly excluded there if it isn't migration work (the test is `<> not_required`, so new values are included by default).

Fiscal quarters are Feb–Jan named for the year they end in; use `fiscalQuarterOf()` from `lib/nps/constants.ts`. `loader.ts`'s older `qonq` aggregate keys on *calendar* quarters — don't mix them.

Manual ordering: `board_position` (per board lane) and `table_position` (flat table) are separate columns because board positions repeat across lanes. Shared math in `lib/delivery/reorder.ts`. Both are excluded from `processes.updated_at` by the trigger (0036/0037), as are roster renames (0038) — `updated_at` means "content last changed" and every staleness signal reads it.

Roster and customer management both live in **Delivery → Configure** (Roster and Customers tabs): rename, set roles/category, mark inactive. Marking someone inactive never touches their existing assignments.

## Deploy workflow (follow exactly)

Edit files and verify with `npm run build`, type-check, and `vitest run`. The agent may run `git add`/`commit`/`push` directly (2026-08-04: Rishabh lifted the earlier no-push rule) — stage only the files actually changed, never `git add -A`. Push to `main` over SSH; Vercel auto-deploys. Known risk: running git from the sandbox concurrently with the user's own terminal/IDE can leave a stale `.git/index.lock` that blocks the user's next local git command — if the user reports a stuck `git` command right after a sandbox push, that lock file is the first thing to check (`rm .git/index.lock` once no git process is actually running). A husky pre-commit hook runs vitest, so pin locales in code (`toLocaleString("en-US")`). After a push, confirm the Vercel deployment reached READY via the Vercel connector (project "delivery-ops").

## Gotchas

Hobby plan caps Vercel crons at 2; new scheduled work should ride the `tasks` + `run-tasks` dispatcher. Gmail send is blocked on Google Workspace admin. Show a visual mockup of any UI or report change for approval before editing code. Match the existing design system (glass cards, brand tokens in `app/globals.css`).
