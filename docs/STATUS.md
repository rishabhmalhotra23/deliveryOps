# DeliveryOps — current state

Last updated: 2026-07-22

This is the canonical current-state snapshot. For the forward plan see [DELIVERYOPS-CONSOLIDATION-PLAN.md](./DELIVERYOPS-CONSOLIDATION-PLAN.md). For the long-form why see [VISION.md](./VISION.md).

## Where things stand

Production is live at https://delivery-ops-delta.vercel.app on Supabase Cloud (`prnakdaxcpzagntgvaqf`). Auth is Auth0 session middleware plus RLS restricting tables to @kognitos.com users; `internal_profiles` is service-role only. Two Vercel Hobby crons run: `daily-sync` at 02:30 UTC (pulls Salesforce, Monday, Kognitos v2, and Linear into the cache tables) and `run-tasks` at 08:00 UTC (dispatches due `tasks`).

The app is well past its original Phase 2. Already built and running: the customer 360 page (`app/(app)/customers/[key]` with hero, stats rail, and cards for account snapshot, ARR, NPS, projects, K2 metrics, opportunities, contacts, activity log, events/tasks, documents, profile, rules), the agent (`lib/agent`, 20-plus tools), the Slack-gated human-approval queue (`pending_approvals`), the document ingestion pipeline, all five connectors, and the native tables.

## What the 2026-07-22 audit found

Roughly 80% of the "one hub" vision is already built. The reason DeliveryOps feels stale is specific, not vague:

- The all-hands weekly report (`lib/reports/weekly-loader.ts`) still reads the Monday cache (`monday_projects`) and the curated arrays in `lib/reports/v2-migrations.ts` plus `MANUAL_V2_MIGRATIONS`. The native `migration_processes` table (migration 0019) was created but never wired into the report. That single unfinished wire is why Monday is still load-bearing.
- "Value" is a modelled estimate (`TIER_HOURS` times a labour rate), which the code itself flags as a placeholder. Real usage sits unused in `k2_runs`.
- The app only produces the weekly report, so no FDE has a daily reason to open it.

Monday is fully backed up before any migration. The `monday-backup/` folder (gitignored) holds a complete inventory of 492 boards / 7,759 items (`board-inventory.csv`/`.json`) and a full export of the 6 report-critical boards, ~142 rows, which live in the Delivery Planning workspace (13889621). Note: workspace 8906635 (25 boards, unmapped) is almost certainly Norco.

## The plan (summary)

Finish and adopt, do not rebuild. Phase 0 backup is done. Phase 1 builds one native `processes` table, imports the ~140 report rows, auto-fills runs/dates/state from `k2_runs`, rewires the report off Monday, and turns the sync off. Phase 2 makes the customer page the daily surface and gives FDEs logins. Phase 3 adds self-updating (Slack/email into events, a suggestion queue via `pending_approvals`, a weekly customer digest as a `tasks` row) and outbound email. Phase 4 builds agents on the single data spine. Full detail and the open decisions are in the consolidation plan.

## Still blocked or pending (external)

- Google Workspace admin: Gmail send-as aliases are needed to unblock outbound email and the monthly digest. IT/admin ask in flight.
- Vercel Pro: would add a third cron slot and per-minute `run-tasks`. Hobby (2 crons) is fine for now; per-customer digests can ride the `run-tasks` dispatcher instead of new crons.

## Verify locally

```bash
nvm use 20
npm run db:start              # Supabase via Colima/Docker
npx tsx scripts/safe-migrate.ts
npm run dev                   # http://localhost:4001
```
