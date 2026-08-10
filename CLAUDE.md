# DeliveryOps — repo guide for Claude

Operational system of record for the Kognitos FDE team. Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 on Supabase, deployed on Vercel. Production with real customer data, so be careful.

Start here: [docs/INDEX.md](./docs/INDEX.md) maps every doc. The current plan and state are in [docs/DELIVERYOPS-CONSOLIDATION-PLAN.md](./docs/DELIVERYOPS-CONSOLIDATION-PLAN.md) and [docs/STATUS.md](./docs/STATUS.md). Read those before proposing architecture.

## Architecture map

- `app/(app)/` — routes: `dashboard` (Overview + Trends tabs — Trends is the former `/analytics`, folded in 2026-08-10; `/analytics` now redirects), `customers` and `customers/[key]` (the customer 360), `delivery`, `reports`, `operations`.
- `app/api/` — backend routes, including `cron/` (daily-sync, run-tasks, monthly-digest), `slack/`, `gmail/`, `jobs/`, `chat/`.
- `lib/` — business logic: `agent/` (runner + 20-plus tools), `integrations/` (salesforce, monday, kognitos, linear, google), `sync/` (per-source runners), `ingestion/` (doc pipeline), `approvals/` (Slack-gated human approval), `reports/` (`allhands-loader.ts`, `delivery-review.ts`, `migration-progress.ts`, `weekly-loader.ts`), `customers/`, `commercials/`, `supabase/`.
- `supabase/migrations/` — schema (0001 to 0023). Full dump at `docs/supabase-schema-full.sql` (stale — predates 0020+, regenerate before trusting it).

## Data model in one breath

`customers` (roster + external IDs + `deliveryops_protected_fields`), `profiles` (customer-facing, has `arr`) and `internal_profiles` (service-role only), `events` (per-customer activity log), `conversations`, `tasks` (scheduler), `pending_approvals` (approval queue). `processes` (migration 0021, renamed/widened from the old `migration_processes`) is the native one-row-per-process record — delivery lifecycle (`lifecycle`/`phase`/`health`/`blocked_on`) and V2 migration (`migration_stage`, `linear_ticket_ids`, dates) live on the same row. `linear_tickets` (0017/0018) caches synced Linear issues, gated for report visibility by `in_scope`/`classification`. Cache tables written by the daily sync: `sf_*`, `k2_workspaces`/`k2_processes`/`k2_runs`, `monday_activities`/`monday_nps_responses` (still synced, but only `monday_activities` still has a live UI reader — the customer-360 Activity tab; every other Monday read path was rewired onto `processes`/native tables during the 2026-08 decommission). `monday_projects` is no longer read anywhere.

## Current focus

Monday is retired as the reporting backbone. Two live, data-driven reports exist: **All-Hands** (`/reports/v2-migration`, `lib/reports/allhands-loader.ts`) and **Weekly Delivery Review** (`/reports/delivery-review`, `lib/reports/delivery-review.ts`) — both read `processes`/`linear_tickets` directly, no hand-maintained content. The old `/reports/weekly` page and `lib/reports/v2-migration-allhands.ts` are deleted. `LINEAR_API_TOKEN` is now set in Vercel (2026-08-10) and wired into the existing `daily-sync` cron (02:30 UTC) — the Linear ticket sync had never actually run in production before that.

Next up (per Rishabh, 2026-08-10): finish verifying Weekly Delivery Review against production, then move to other reports and frontend work. Note for the frontend pass: the app is intentionally light-mode by default (`--background` = `--brand-canvas`, see `app/providers.tsx`'s `defaultTheme="light"`) — only the sidebar nav and the report pages (`.report-theme`, dark by fixed design) are dark today. The approved Stage A "Bold Brand-Forward" dark-primary direction (`docs/mockups/`) has not been applied to the rest of the app yet.

## Deploy workflow (follow exactly)

Edit files and verify with `npm run build`, type-check, and `vitest run`. The agent may run `git add`/`commit`/`push` directly (2026-08-04: Rishabh lifted the earlier no-push rule) — stage only the files actually changed, never `git add -A`. Push to `main` over SSH; Vercel auto-deploys. Known risk: running git from the sandbox concurrently with the user's own terminal/IDE can leave a stale `.git/index.lock` that blocks the user's next local git command — if the user reports a stuck `git` command right after a sandbox push, that lock file is the first thing to check (`rm .git/index.lock` once no git process is actually running). A husky pre-commit hook runs vitest, so pin locales in code (`toLocaleString("en-US")`). After a push, confirm the Vercel deployment reached READY via the Vercel connector (project "delivery-ops").

## Gotchas

Hobby plan caps Vercel crons at 2; new scheduled work should ride the `tasks` + `run-tasks` dispatcher. Gmail send is blocked on Google Workspace admin. Show a visual mockup of any UI or report change for approval before editing code. Match the existing design system (glass cards, brand tokens in `app/globals.css`). The `monday-backup/` folder holds a local Monday export and is gitignored.
