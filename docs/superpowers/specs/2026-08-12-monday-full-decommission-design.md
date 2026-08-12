# Full Monday.com decommission

Date: 2026-08-12
Status: approved by Rishabh, ready for implementation planning

## Why

Monday retirement for *reporting* shipped 2026-08-10 (`docs/STATUS.md`) — the All-Hands and Weekly
Delivery Review reports, the V2 Migration tracker, Delivery, and Customer 360's core data all read
`processes`/`linear_tickets`/native tables directly. But three things still tie DeliveryOps to Monday
day-to-day: the nightly sync still calls `api.monday.com`, three cache tables still exist and get
wipe-replaced daily, and one UI surface (Customer 360's Activity tab) still reads one of them live.

Rishabh: "let's be self sufficient now and be independent of monday entirely" — "all reports, all data
we already have migrated to delivery ops, so why do we need monday for anything" — "Monday will be
retired soon." Goal: zero runtime dependency on Monday's API, and no DeliveryOps code, schema, or
secrets left that only exist to talk to it.

## What we found

Investigation (see conversation history) turned up one real complication: the Activity tab isn't
mirrored DeliveryOps data. It renders **Fireflies meeting transcripts → AI-generated summary → pushed
into a Monday board as a status/priority/due-date ticket** (`ACTIVITY_COLS` in
`lib/cache/integrations.ts`), synced down into `monday_activities`. DeliveryOps's native `events` table
is a generic append-only audit log (Slack/Gmail/agent notes, `HUMAN_NOTE`s from the agent tool) with no
status/priority/due-date/meeting-excerpt fields — not a data-source swap, it would require building a
new Fireflies-native ingestion and ticket-workflow pipeline from scratch. Rishabh's call: **drop the
tab**, not build that pipeline as part of this project.

Also found while scoping code deletion: `lib/import/monday-taxonomy.ts` (`laneFor`, `viewForLifecycle`)
is imported by `lib/processes/loader.ts` — the **native** processes pipeline — despite its path and
name. It's a naming-legacy holdover (same pattern as `legacyFieldsFromProcess()` in
`lib/delivery/taxonomy.ts`), not a Monday API dependency, and must be kept. `lib/import/
monday-customers.ts` (`normalizeName`, board-matching helpers) has no such live consumer — its only
callers are `lib/sync/monday.ts` (deleted by this work), two one-off scripts (deleted), and the dev-only
Monday-backup import-preview route (deleted, since no new customers will ever be onboarded from a
Monday board again) — so it's fully removable.

## Scope

Single coordinated removal (not phased): cut the sync, drop the tab, drop the tables, delete the
integration/script code, update the docs. The dependency map (via `docs/MONDAY-DECOMMISSION-LOG.md`
and repo search) shows nothing else reads these tables, so there's no risk-reduction benefit to
spreading this across multiple deploys — verify with `npm run build` + typecheck + `vitest run` before
pushing, per the repo's existing deploy workflow.

### 1. Cron / sync

- `app/api/cron/daily-sync/route.ts`: drop `"monday"` from the `sources` list passed to `runFullSync`;
  update the file's header comment (currently says "SF + Monday + K2").
- Delete `lib/sync/monday.ts` and `lib/integrations/monday.ts`.
- `lib/sync/runner.ts` (or wherever `runFullSync` dispatches by source name): remove the `"monday"` case.

### 2. Activity tab

- Delete `app/(app)/customers/[key]/_cards/activity-log-card.tsx`.
- Remove its row/slot from the Customer 360 page composition.
- `lib/cache/integrations.ts`'s `loadCustomerEnrichment` also loads Salesforce cache rows and native
  `processes`/`nps_responses` (mapped into `MondayProjectCache`/`MondayNpsCache`-named shapes purely for
  UI-type compatibility, same legacy-naming pattern as `legacyFieldsFromProcess` — not real Monday
  reads, keep as-is). Only remove: the `monday_activities` query, the `ACTIVITY_COLS` const, the
  `activities` field on `CustomerEnrichment`, the `MondayActivityCache` type, and
  `freshness.monday_synced_at`. The file itself and its other exports stay.
- Remove any props/wiring in `lib/customers/view-model.ts` that only exist to feed this card.

### 3. Schema

- New migration `00XX_drop_monday_tables.sql`: `drop table monday_projects`, `drop table
  monday_activities`, `drop table monday_nps_responses`.
- Before writing it, re-grep for any straggling reader beyond what's already catalogued (dev routes,
  `scripts/audit-data-health.ts`, `scripts/inspect-phases.ts`, `scripts/backfill-profiles.ts`,
  `scripts/db-sanity-check.ts`) and update or delete those call sites so the build doesn't break against
  a dropped table.

### 4. Code cleanup

Delete:
- `scripts/monday-full-backup.ts`, `run-monday-sync.ts`, `import-monday-backup.ts`,
  `monday-sync-categories.ts`, `discover-monday-workspaces.ts`, `list-all-monday-boards.ts`,
  `publish-monday-update.ts`, `preview-monday-update.ts`, `verify-monday-update.ts`,
  `monday-post-updates.ts`, `dry-run-monday-projects-match.ts`, `map-customer-workspaces.ts`,
  and any remaining `inspect-*-boards.ts` / `.monday-write-plan.json` / `.monday-publish-log.json`
  state files.
- `lib/import/monday-customers.ts` and `tests/import/monday-customers.test.ts`.
- `app/api/dev/import/preview/route.ts` (Monday-backup import preview; dead once Monday's gone).
- `app/api/dev/probe/monday/{boards,board/[id]}/route.ts`.
- Monday row counts / status panel from `app/api/dev/sync/status/route.ts` and
  `app/dev/sync/sync-client.tsx`.

Keep (not Monday dependencies despite the name/path):
- `lib/import/monday-taxonomy.ts` and `tests/import/monday-taxonomy.test.ts` — live import for
  `lib/processes/loader.ts`. Renaming is optional cosmetic cleanup, out of scope here.
- `lib/delivery/taxonomy.ts`'s `MONDAY_PROJECT_COLS` / `legacyFieldsFromProcess()` — internal
  translation shim for existing UI components reading native `processes` rows, not an API dependency.

### 5. Env / secrets

- Remove `MONDAY_API_TOKEN=` from `.env.example`.
- Remove/redact the real token value from `docs/CREDENTIALS.md`.
- **Manual, outside this PR**: Rishabh revokes the token in Monday's admin panel, and removes
  `MONDAY_API_TOKEN` from Vercel's project env vars.

### 6. Docs

- `docs/MONDAY-DECOMMISSION-LOG.md`: final entry marking full decommission complete (sync off, tables
  dropped, code removed) — supersedes the "1.9/1.10 not started" state from 2026-08-07.
- `docs/STATUS.md` and `CLAUDE.md`: drop the "still synced daily" / "still has a live reader" caveats
  around `monday_activities`; state Monday has zero runtime footprint.

### Out of scope

- The local, gitignored `monday-backup*/` folders (real customer data snapshots, never committed) —
  Rishabh's to delete or keep on his own machine, not part of this code change.
- A native Fireflies/meeting-notes ingestion pipeline to replace what the Activity tab did — explicitly
  deferred; would be its own future brainstorm if wanted.

## Testing

- `npm run build`, typecheck, `vitest run` (existing `tests/import/monday-*.test.ts` deleted/kept per
  above) all green before push.
- Manually hit `/api/cron/daily-sync` (or check the next scheduled run) to confirm it completes without
  attempting a Monday source and without errors from the dropped tables.
- Load a Customer 360 page to confirm the page renders correctly with the Activity tab gone (no broken
  layout from the removed row).
