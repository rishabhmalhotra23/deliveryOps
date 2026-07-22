# DeliveryOps consolidation plan — retire Monday, one customer record, agents on top

Date: 2026-07-22
Owner: Rishabh
Status: proposal for review

## TL;DR

You are not building this system. You already built roughly 80% of it and stopped at the wiring. The customer 360 page, the agent with 20+ tools, the Slack-gated human-approval flow, the native tables, the connectors, and the daily sync all exist in the repo today. The reasons DeliveryOps feels stale are specific and fixable: the all-hands report still reads from the Monday cache instead of the native tables, "value" is a modelled guess rather than grounded in platform data, and nobody has a daily reason to open the app because it only produces the weekly report.

So the plan is finish and adopt, not rebuild. Adding more surface area before finishing the half-wired migration will make the staleness worse, not better.

The good news from the Monday audit: the report depends on only 6 Monday boards (about 140 project rows in the Delivery Planning workspace). Retiring Monday as the report's backbone is a small, contained job, not a 7,759-item migration.

## What already exists (do not rebuild)

Data model (Supabase, migrations 0001 to 0019):
- `customers` — canonical roster with external IDs for Salesforce, Monday, Kognitos v1/v2, plus `slack_channel`, `ae_owner`, `lifecycle_group`, `custom_category`, brand fields. Already has `deliveryops_protected_fields` and `last_manually_edited_at`: the mechanism that stops a sync from clobbering a hand-edited field. This is the write-conflict rule we discussed, already implemented.
- `profiles` (customer-facing, includes `arr`, contract, adoption, contacts, goals) and `internal_profiles` (health, NPS, CSAT, churn risk — the agent has zero access, enforced structurally by RLS).
- `events` — append-only per-customer activity log. This is the substrate for the Slack/email activity feed.
- `conversations` — Slack/email exchanges archived per customer.
- `tasks` — per-customer scheduler (schedule + action as JSONB), dispatched by a cron.
- `pending_approvals` — Slack-mediated human approval queue for email drafts and gated actions, with an append-only revision history. This is the "human approves before it posts to the customer" pattern, already persisted.
- `migration_processes` (0019) — a native, one-row-per-process V2 migration tracker with owner, engineering owner, stage, dates, completion %, active usage, ARR, blockers, notes, Linear ticket links, and a `went_live_at` stamp for Slack idempotency. It is close to the process table you described, but scoped to migrations, imported from a spreadsheet, manual, and not yet wired to the report.
- Cache tables written by the daily sync: `sf_accounts/opportunities/cases`; `monday_projects` (6 boards, with go-live/kickoff dates, TTV, delivered value, effort, plus a DeliveryOps-native `delivery_notes` field), `monday_activities`, `monday_nps_responses`; `k2_workspaces`, `k2_processes`, `k2_runs` (run history with state, start, end, `duration_ms`). `sync_runs` is the audit log.

Connectors: Salesforce, Monday, Kognitos v2, Linear, Slack (inbound signature verification present), Google/Gmail (partial; send is blocked on Google Workspace admin config, not code).

Agent (`lib/agent`): a runner plus tools including `search_customer_docs`, `log_event`, `get/update_customer_profile`, `send_slack_message`, `send_email` (gated), `revise_email_draft`, `escalate_to_human`, `create/list/cancel_task`, `get_slack_history`, `get/update_customer_rules`, and `list_customer_projects/nps/opportunities/cases/activities/events`. Email send is gated through `pending_approvals`.

Ingestion (`lib/ingestion`): document pipeline that takes a file from Slack/email/upload/drive, extracts markdown (Claude vision for PDF/image), classifies it, stores it, and appends an event.

Customer 360 page (`app/(app)/customers/[key]`): hero, sticky stats rail, tabs, and cards for account snapshot, ARR stat and trend, NPS stat/trend/responses, projects, K2 metrics, opportunities, contacts, activity log, events and tasks, documents, profile, rules. The list page already shows ARR, category, FDE, renewal, and an edited-fields count per customer.

Crons (`vercel.json`): `daily-sync` (02:30 UTC, pulls every connector into the cache) and `run-tasks` (08:00 UTC, dispatches due tasks). `monthly-digest` exists but is not scheduled (Hobby plan caps crons at 2, and Gmail send is blocked).

Auth: Auth0 session middleware; server routes use the Supabase admin client; RLS restricts tables to @kognitos.com users; `internal_profiles` is service-role only. A `customer_users` table exists for future per-FDE scoping but is not used yet, so today every kognitos.com user sees every customer.

## Why it is stale (the real blockers)

1. The all-hands report reads from the Monday cache, not the native tables. `lib/reports/weekly-loader.ts` pulls from `monday_projects`, and the V2 tile reads the curated arrays in `lib/reports/v2-migrations.ts` plus `MANUAL_V2_MIGRATIONS`. The native `migration_processes` table was created but never wired in. So Monday is load-bearing for the one thing the app is used for.

2. "Value" is a modelled estimate. The loader multiplies a per-complexity hours assumption by a labour rate (`TIER_HOURS`, `RATE_*`). The code itself labels this as a placeholder "until Kognitos platform run data is connected." Real usage lives in `k2_runs` and is not used for value yet.

3. There is one representation too many of "a process." `monday_projects` (Monday's truth), `k2_processes` (the platform's truth), and `migration_processes` (hand-entered) all describe processes, with no single owner. That fragmentation is the disease; retiring Monday only helps if it collapses to one owned table.

4. No daily reason to log in. The app produces a weekly report and little else that pulls an FDE in day to day, so it is not part of anyone's routine.

5. Operational limits: Gmail send is blocked on Google Workspace admin (send-as aliases), and the Hobby plan allows only 2 crons.

## Target architecture

One native `processes` table as the operational truth, one row per customer-process, with clearly separated write authority:

- Auto-derived columns, refreshed by the daily sync from `k2_processes` and `k2_runs`: process name, platform/version, state, run count, first and last run, duration, and a go-live proxy. Reproducible, never hand-typed.
- Human-owned columns, edited in the customer page and protected from the sync via the existing `deliveryops_protected_fields` mechanism: SME/owner, description, business value inputs, go-live confirmation, health, notes.
- Unstructured signals from Slack and email never write a metric. They append to `events` (activity feed) and, at most, create a suggested change that a human accepts. Accepted changes write with provenance.

Value should stop pretending to be measured. Keep the modelled estimate but label it, and ground usage in `k2_runs` (run counts are real). If you want a value number you can defend at all-hands, add one human input per process (minutes saved per run, entered once); value then equals measured runs times that input, with the assumption visible.

The rule to hold: DeliveryOps displays everything, and owns a field only when nothing else owns it well. ARR and commercial data stay sourced from Salesforce. Runs, dates, and state stay sourced from Kognitos. DeliveryOps owns the operational overlay (ownership, description, value inputs, notes, health) and the process record itself once Monday is retired.

## Phased plan

### Phase 0 — Safekeeping (done today)
Monday is backed up in `monday-backup/`: a full inventory of 492 boards / 7,759 items (`board-inventory.csv`/`.json`) and a full export of the 6 report-critical boards (142 items). This snapshot means nothing is lost when the sync is later turned off.

### Phase 1 — Retire Monday from the report (the core move)
Build the native `processes` table (generalize `migration_processes` beyond migration, or add a sibling table it can grow into). One-time import the 6 portfolio boards (~140 rows) from the backup. Populate the auto-derived columns from `k2_processes`/`k2_runs`. Rewire `weekly-loader.ts` to read the native table instead of `monday_projects`, and retire the curated `v2-migrations.ts` arrays. Verify the all-hands numbers match the current report to the row before cutover. Then stop the Monday sync. This removes Monday as a dependency for everything the app is actually used for.

### Phase 2 — Make it the daily surface (adoption)
The customer 360 page already exists. Add the process table view with inline editing of the human-owned fields, give the 2-3 FDEs Auth0 logins, and generate the all-hands report from the same native data the page uses, so there is one source and the page and the report can never disagree. Per-FDE scoping through `customer_users` is available if you want each FDE to land on their own accounts, but it is not required to share the app.

### Phase 3 — Self-updating and outbound
Wire the inbound per-customer Slack channel and email into `events`/`conversations` (the ingestion rails exist). Add a suggested-updates queue: the agent proposes field changes from the chatter, a human accepts, and the change writes with provenance, reusing `pending_approvals`. Add a weekly per-customer digest as a `tasks` row dispatched by the existing `run-tasks` cron (this avoids the 2-cron Hobby cap), drafted by the agent and gated by `pending_approvals` before it posts to the customer channel. Unblock Gmail send with Google Workspace admin to enable email out.

### Phase 4 — Agents on top
With one clean data spine, build the agents you actually want on the existing framework: a report generator, a "prep me for this customer meeting" agent, a "what changed this week for account X" summarizer. These are cheap once the data underneath them is single-sourced and trusted.

## Monday retirement scope

Retiring Monday for the report is small: 6 boards, ~140 rows, all in the Delivery Planning workspace. That is Phase 1.

Full Monday retirement is a separate, larger question. The account holds 492 boards and 7,759 items across ~30 customer workspaces, most of which DeliveryOps does not sync today and which are likely legacy per-customer project boards. Recommendation: retire the report dependency now (Phase 1), keep the backup as the archive, and audit the per-customer workspaces later only where something turns out to be load-bearing. Do not treat 7,759 items as a migration target on faith.

Two data notes from the audit: the 6 portfolio boards live in workspace 13889621 (Delivery Planning), despite the "Projects Portfolio" label. And workspace 8906635 (25 boards, 492 items), currently unmapped, is almost certainly Norco and should be added to the customer mapping.

## Decisions needed

1. Own vs display for the process record. Recommendation: own it. Monday is already stale and the report needs a native source regardless.
2. Monday retirement scope. Recommendation: report boards now, the rest later after an audit.
3. Value. Accept modelled-estimate-with-label plus one human input per process to ground it in real `k2_runs` usage, or leave value as an explicit estimate for now.
4. Scheduling. Ride the `tasks` + `run-tasks` dispatcher for per-customer digests, or upgrade to Vercel Pro for dedicated crons. The dispatcher path needs no upgrade.

## First build step

Per your own rule (mockup before code), the next step is a mockup of the customer page with the process table and the auto-vs-manual field split, for approval before any code changes.
