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
