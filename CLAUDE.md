# DeliveryOps — repo guide for Claude

Operational system of record for the Kognitos FDE team. Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 on Supabase, deployed on Vercel. Production with real customer data, so be careful.

Start here: [docs/INDEX.md](./docs/INDEX.md) maps every doc. The current plan and state are in [docs/DELIVERYOPS-CONSOLIDATION-PLAN.md](./docs/DELIVERYOPS-CONSOLIDATION-PLAN.md) and [docs/STATUS.md](./docs/STATUS.md). Read those before proposing architecture.

## Architecture map

- `app/(app)/` — routes: `dashboard`, `customers` and `customers/[key]` (the customer 360), `delivery`, `analytics`, `reports`, `operations`.
- `app/api/` — backend routes, including `cron/` (daily-sync, run-tasks, monthly-digest), `slack/`, `gmail/`, `jobs/`, `chat/`.
- `lib/` — business logic: `agent/` (runner + 20-plus tools), `integrations/` (salesforce, monday, kognitos, linear, google), `sync/` (per-source runners), `ingestion/` (doc pipeline), `approvals/` (Slack-gated human approval), `reports/` (weekly-loader), `customers/`, `commercials/`, `supabase/`.
- `supabase/migrations/` — schema (0001 to 0019). Full dump at `docs/supabase-schema-full.sql`.

## Data model in one breath

`customers` (roster + external IDs + `deliveryops_protected_fields`), `profiles` (customer-facing, has `arr`) and `internal_profiles` (service-role only), `events` (per-customer activity log), `conversations`, `tasks` (scheduler), `pending_approvals` (approval queue). Cache tables written by the daily sync: `sf_*`, `monday_projects`/`monday_activities`/`monday_nps_responses`, `k2_workspaces`/`k2_processes`/`k2_runs`. `migration_processes` is the native per-process V2 tracker (migration 0019).

## Current focus

Retire Monday and finish the wiring. The all-hands report still reads the Monday cache (`monday_projects`) plus curated arrays in `lib/reports/v2-migrations.ts`; the native `migration_processes` table exists but is not wired into the report. Retiring Monday for the report is ~6 boards / ~140 rows. "Value" is a modelled estimate; real usage is in `k2_runs`. Do not rebuild what already exists; finish and adopt.

## Deploy workflow (follow exactly)

Edit files and verify with `npm run build`, type-check, and `vitest run`. Do NOT run `git add`/`commit`/`push` from the sandbox (it leaves a stale `.git/index.lock`). Hand the user exact commit + push commands, staging only the files you changed (never `git add -A`). The user pushes to `main` over SSH; Vercel auto-deploys. A husky pre-commit hook runs vitest, so pin locales in code (`toLocaleString("en-US")`). After a push, confirm the Vercel deployment reached READY via the Vercel connector (project "delivery-ops").

## Gotchas

Hobby plan caps Vercel crons at 2; new scheduled work should ride the `tasks` + `run-tasks` dispatcher. Gmail send is blocked on Google Workspace admin. Show a visual mockup of any UI or report change for approval before editing code. Match the existing design system (glass cards, brand tokens in `app/globals.css`). The `monday-backup/` folder holds a local Monday export and is gitignored.
