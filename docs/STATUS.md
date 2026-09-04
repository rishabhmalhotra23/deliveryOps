# DeliveryOps — current state

Last updated: 2026-08-10

This is the canonical current-state snapshot. For the forward plan see [DELIVERYOPS-CONSOLIDATION-PLAN.md](./DELIVERYOPS-CONSOLIDATION-PLAN.md) (historical — Monday retirement it describes is now done, see below). For the long-form why see [VISION.md](./VISION.md).

## Where things stand

Production is live at https://delivery-ops-delta.vercel.app on Supabase Cloud (`prnakdaxcpzagntgvaqf`). Auth is Auth0 session middleware plus RLS restricting tables to @kognitos.com users; `internal_profiles` is service-role only. Two Vercel Hobby crons run: `daily-sync` at 02:30 UTC (Salesforce, Kognitos v2, Linear tickets into the cache tables) and `run-tasks` at 08:00 UTC (dispatches due `tasks`).

The app is well past its original Phase 2. Already built and running: the customer 360 page (`app/(app)/customers/[key]` with hero, stats rail, and cards for account snapshot, ARR, NPS, projects, K2 metrics, opportunities, contacts, events/tasks, documents, profile, rules), the agent (`lib/agent`, 20-plus tools), the Slack-gated human-approval queue (`pending_approvals`), the document ingestion pipeline, all five connectors, and the native `processes` table.

## Monday retirement for reporting: done

The 2026-07-22 audit below was the diagnosis; it's since been fixed. `processes` (migration 0021, widened from `migration_processes`) is now the single native record for both delivery lifecycle and V2 migration state, and every report reads it directly:

- **All-Hands** (`/reports/v2-migration`) — company-wide weekly report: delivery portfolio + V2 migration-goal stats (migrated/actively-migrating/engineering-blocked, reconciled by construction), a combined migrated-to-V2-vs-ticket-velocity chart, hard-blocker ticket breakdowns, renewal spotlight. Replaced 1,247 lines of hand-maintained content (`lib/reports/v2-migration-allhands.ts`, deleted) plus the Monday-backed `weekly-loader.ts` V2 tile.
- **Weekly Delivery Review** (`/reports/delivery-review`) — Delivery/CS-only, customer-grouped, per-process Done/Coming Up/Blocked detail. Replaced the old `/reports/weekly` page (deleted).
- `lib/sync/linear-tickets.ts` syncs raw Linear ticket fields daily; a separate classification layer (`in_scope`/`classification`/`domain`, human or Claude-assisted) gates what a report shows. `LINEAR_API_TOKEN` was only wired into Vercel on 2026-08-10 — before that the sync had never actually run in production, so `linear_tickets` was a one-time hand-seeded snapshot. Also fixed same day: the sync's GraphQL query wasn't requesting archived issues, undercounting older completed/canceled tickets.
- Monday is fully decommissioned: the nightly sync no longer includes it, the Activity tab (its last live UI reader) was removed, and `monday_projects`/`monday_activities`/`monday_nps_responses` were dropped. See `MONDAY-DECOMMISSION-LOG.md` for the full history.

Remaining loose end from the original audit: "value" is still a modelled estimate (`TIER_HOURS` × labour rate); real usage sits unused in `k2_runs`. Not addressed yet.

## What the 2026-07-22 audit found (historical)

Roughly 80% of the "one hub" vision is already built. The reason DeliveryOps felt stale at the time was specific, not vague:

- The all-hands weekly report (`lib/reports/weekly-loader.ts`) read the Monday cache (`monday_projects`) and curated arrays. **Fixed — see above.**
- "Value" is a modelled estimate. **Still open.**
- The app only produced the weekly report, so no FDE had a daily reason to open it. Two live reports now exist; daily-surface adoption is still open.

Monday is fully backed up before any migration. The `monday-backup/` folder (gitignored) holds a complete inventory of 492 boards / 7,759 items (`board-inventory.csv`/`.json`) and a full export of the 6 report-critical boards, ~142 rows, which live in the Delivery Planning workspace (13889621). Note: workspace 8906635 (25 boards, unmapped) is almost certainly Norco.

## Frontend Stage A: done (2026-08-10)

The approved "Bold Brand-Forward" dark-primary direction (spec: `docs/superpowers/specs/2026-08-07-app-design-foundation-design.md`) is now live. `app/providers.tsx` defaults to dark (`defaultTheme="dark"`; light stays selectable via the existing toggle). `app/globals.css`'s `.dark` block carries the new tokens (`--surface-1`/`--surface-2`/`--foreground-muted`/`--foreground-body`/`--status-good`/`--status-bad`). The three proof pages are restyled onto this flat-surface system:

- **Dashboard** — gained an Overview/Trends tab pair (`?tab=overview|trends`, URL-based so a plain Overview visit doesn't pay for Trends' ~13-query loader). `/analytics` folded in and now redirects; nav is down to 7 entries (Analytics removed).
- **Delivery** — table + kanban board restyled; along the way, found and fixed two real bugs (Health pill and status flags had zero dark-mode text color, illegible once dark became default).
- **Customer 360** — restyled including overriding Kognitos Lattice's own `Card` background on the Lattice-based right-rail cards, per Rishabh's call that the whole platform should read as one visual system rather than leaving Lattice on its own (otherwise-correct) dark palette.

Deferred out of the spec's original scope: the Operations+Chat "Agent" nav merge — the two pages run on different backends/persistence/design systems, too much to fold in safely alongside the rest. `/operations` and `/chat` remain separate nav entries.

Still Stage B (not done): Customers list, V2 Migration, Reports catalog visual refresh, the Agent merge, Customer 360's deeper secondary tabs (Documents/Tasks/Profile/Rules/NPS responses/Activity), a full Recharts dark-palette system (charts only got a chrome-level color retune so far), and the Suspense/skeleton-loading + dashboard-empty-state gaps from `docs/ux-improvement-plan.md`.

## PR 00 — queue volume audit (2026-09-04)

Run to gate PR 04 of the Platform IA plan, which asks whether "Today" is a
destination or a card. Script: `scripts/audit-queue-volume.ts` (read-only).
Numbers below read from the production project via the Supabase connector —
`.env.local` points at the local Supabase, which is pre-0030 and cannot answer
this; the script now says so with the command to fix it rather than dying on a
raw Postgres error.

| Source | Now | Note |
|---|---|---|
| `pending_approvals` | **0 rows, all time** | The approval queue has never been used. Today's primary source contributes nothing. |
| `events` | 99 rows, newest **106 days old** | Stale, not empty. Nothing writes to `events`. "Changed overnight" has no input. |
| `tasks` | **0 rows** | The scheduler has never been used. |
| `process_suggestions` open | **0** | |
| Processes blocked (`blocked_on` set) | **30** | A standing backlog, not a daily arrival. |
| Active processes untouched >30d | **0** | 106 processes were legitimately touched 2026-09-03. |
| Renewals inside 90 days | **6**, $364,600 | The only source with genuine, recurring signal. |

**Queue if built today: ~36 items — but daily inflow is approximately zero.**
30 of the 36 are the standing blocked-process backlog; 6 are renewals that
turn over on a quarterly rhythm.

### What this means for PR 04

The plan's own test was "40 items a day needs ranking and snooze; one item
means Today is a card on Customers." Neither branch fits cleanly, because the
question the audit actually answered is different: **three of Today's four
sources are empty or dead.** Approvals, tasks and events have never carried
traffic or stopped carrying it 106 days ago.

So ranking rules and a snooze model would be built for volume that does not
exist, and "Needs you" would be a list of 30 blocked processes plus 6
renewals — which is a filter on Delivery and a card on Customers, not a
destination. Recommendation: **defer PR 04**, and revisit once the Agent merge
(PR 03) puts approvals into real use, since that is the source that would
give Today a daily rhythm.

Worth fixing regardless of Today: nothing has written to `events` in 106 days.
Every "activity timeline" in the IA plan reads that table.

### Signal-health check

`updated_at` on `processes` is the input to the staleness number above, so a
bulk write that reset it would make that row read 0 regardless of reality.
Verified after today's roster renames and merges: **14 of 149** processes carry
today's timestamp, and 0038/0040's guard preserved it on all 84 rows the
renames and merges touched. The staleness signal is intact.

## Next up (per Rishabh, 2026-08-10)

1. Finish verifying Weekly Delivery Review against production (in progress — see the SDD ledger under `.superpowers/sdd/` if resuming that plan).
2. Continue with other reports.

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
