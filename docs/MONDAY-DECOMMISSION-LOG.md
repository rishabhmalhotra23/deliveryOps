# Monday decommission — running log

Cross-session tracker for retiring Monday.com as DeliveryOps' system of record.
This is a multi-day job. **Read this file first in any new session**, append to the
session log at the bottom before finishing, and keep the phase checklist honest.

Related: [DELIVERYOPS-CONSOLIDATION-PLAN.md](./DELIVERYOPS-CONSOLIDATION-PLAN.md)
(the original phased plan), [STATUS.md](./STATUS.md).

---

## Where we actually are

As of 2026-07-30, an audit of the code found that essentially none of the
consolidation plan's Phase 1 had been done, and the four commits since the plan
was written (all 2026-07-27) deepened the Monday dependency rather than reducing
it by adding more hand-transcribed Monday numbers as TypeScript literals.

Specifically:

- `syncMonday` still runs nightly in production (`vercel.json` cron, 02:30 UTC).
- `loadWeeklyBundle()` (`lib/reports/weekly-loader.ts:318`) reads `monday_projects`
  and `monday_nps_responses` and decodes nearly every reported field out of Monday
  `raw_columns` via `MONDAY_PROJECT_COLS`.
- `migration_processes` (migration 0019, seeded with 75 rows by 0020) has a full
  CRUD store and `/api/migrations` routes but **zero read sites in any UI, report,
  loader, or agent tool**. Its `customer_key` column is still NULL on every row
  because the matching pass was never written. There is no importer.
- The V2 migration report reads no live Monday data, but only because
  `lib/reports/v2-allhands-weeks.ts` and `v2-migration-allhands.ts` are pure
  literals hand-transcribed each week, while the UI still labels them "live".

### The scope gap worth remembering

The consolidation plan scopes "retire Monday from the report". That is narrower
than decommissioning Monday. There are five independent `monday_projects` read
paths, not one:

| Read path | Feeds |
|---|---|
| `lib/reports/weekly-loader.ts:324` | the all-hands weekly report |
| `lib/analytics/loader.ts:185` | analytics page |
| `lib/delivery/loader.ts:127` | delivery page |
| `lib/cache/integrations.ts:194` | customer 360 cards |
| `lib/dashboard/stats-drilldown.ts:35,280` | dashboard drilldowns |

Plus `monday_nps_responses` (4 app read paths) and
`app/_components/project-detail-panel.tsx:88`, which makes a live client-side call
to `/api/monday/item-updates` — a route `middleware.ts:14,27` lists as **public and
unauthenticated** while it uses the server's Monday token. That route should be
authenticated or deleted regardless of the migration timeline.

Rewiring only `weekly-loader.ts` produces a Monday-free report while the rest of
the app breaks the day the sync stops.

---

## Phase checklist

Status values: `done` / `in progress` / `blocked` / `not started`.

### Phase 0 — Safekeeping

| # | Step | Status | Notes |
|---|---|---|---|
| 0.1 | Board inventory (492 boards / 7,759 items) | done 2026-07-22 | `monday-backup/board-inventory.{json,csv}` |
| 0.2 | Ad-hoc export of 6 report boards | done 2026-07-22 | **Insufficient.** No column definitions, no updates, no subitems, no `created_at`/`state`/`creator`, and all relation columns exported as null. Status labels cannot be decoded from it. |
| 0.3 | Write a real full-fidelity backup script | done 2026-07-30 | `scripts/monday-full-backup.ts`. Cursor pagination, complexity self-throttling, retry/backoff, field-shape fallbacks, per-board checkpointing, `--resume`. |
| 0.4 | Run Phase A (core boards) | done 2026-08-03 | `monday-backup-2026-08-03/` |
| 0.5 | Run Phase B (remaining boards) | done 2026-08-03 | **492 of 492 boards exported, zero errors.** |
| 0.6 | Verify the archive is complete and decodable | done 2026-08-03 | 7,798 items, 1,597 updates, 106 asset records. 4,875 column definitions, no board missing them. 2,206 relation cells of which 1,521 carry `linked_item_ids`. Both failure modes of the July backup are fixed. |

### Phase 1 — Native process model

| # | Step | Status | Notes |
|---|---|---|---|
| 1.1 | Design the native schema from the real backup | **proposed 2026-08-03, awaiting approval** | [PROCESSES-SCHEMA-PROPOSAL.md](./PROCESSES-SCHEMA-PROPOSAL.md). Grain = one row per process, soft-linked to `k2_processes`. Clean orthogonal taxonomy replacing Monday's blended fields. `ttv_days` generated. Value = manual minutes-saved input x `k2_runs`. |
| 1.2 | Generalize `migration_processes` into `processes` | **done 2026-08-03, verified on real PG 15** | `supabase/migrations/0021_processes_native.sql`. Renames the table and adds 36 columns + 9 enum types + `process_suggestions` + `nps_responses` + the 9 Customers-board fields. **Additive only — nothing dropped**, see 1.2b. `tsc --noEmit` clean, vitest 111/111, `npm run db:reset` replayed 0001-0021 clean, and an 8-check schema assertion passed exactly: 75 rows survived the rename, `platform` is `process_platform` with v1:69 v2:4 custom:2, `ttv_days` is `is_generated = ALWAYS`, `lifecycle` defaulted to discovery on all 75, both new tables present, all 11 new columns present, `migration_processes` gone. |
| 1.2b | Drops: `monday_activities`, `customers.lifecycle_group`, `internal_profiles.health_score` | not started, **deliberately** | These were planned for 0021 and pulled out. Both still have live read sites (`lifecycle_group` 19, incl. a `.eq()` filter in `lib/customers.ts:93` and `ALLOWED_FIELDS` in the manual-update route; `monday_activities` 5, incl. `lib/sync/monday.ts:512`). Dropping a column the code still selects is a runtime 500, not a build error, so `npm run build` would have passed and the failure would have landed on customers. Becomes 0022, after the rewire. |
| 1.3 | Write the importer from the backup into Supabase | **written 2026-08-03, dry-run verified** | `scripts/import-monday-backup.ts` + `lib/import/monday-taxonomy.ts` + `tests/import/monday-taxonomy.test.ts` (28 tests, replays the real 146 rows). Dry run by default, idempotent on `source_item_id`, flags rather than guesses. Includes the customer matching pass 0020 skipped. Not yet run with `--apply`. |
| 1.4 | Populate auto-derived columns from `k2_processes` / `k2_runs` | not started | Real usage data currently unused. |
| 1.5 | Mockup the UI + decide the IA | **mockup delivered 2026-08-03, awaiting approval** | [docs/mockups/ia-step-1.5.html](./mockups/ia-step-1.5.html). 5 panels: IA options A/B, field homes for 0021, the process edit drawer, the segmented board, customer 360. Editing model, permissions, Activity Log and the suggestion queue all decided. **The A-vs-B IA choice is still open and is Rishabh's.** |
| 1.6 | Rewire `weekly-loader.ts` off `monday_projects` | not started | |
| 1.7 | Rewire the other four read paths | not started | analytics, delivery, cache/integrations, dashboard drilldowns. |
| 1.8 | Authenticate or delete `/api/monday/item-updates` | not started | Currently public + unauthenticated. |
| 1.9 | Verify report numbers match row-for-row before cutover | not started | Hard gate. |
| 1.10 | Disable the Monday sync in `vercel.json` | not started | Only after 1.9 passes. |

### Phase 2+ — Adoption, self-updating, agents

Not started. See the consolidation plan.

---

## Decisions made

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-30 | Backup runs locally via `npx tsx`, not from the Claude sandbox | Sandbox has no network egress to `api.monday.com` (HTTP 000). |
| 2026-07-30 | Not pulling the backup through the Monday MCP connector | 7,759 items plus updates would return into the model's context window and blow it up many times over. |
| 2026-07-30 | File attachments: metadata only, no binaries | Small and fast; binaries are least likely to matter for reporting. Accepted cost: Monday `public_url` values are short-lived signed URLs and will expire, so the files themselves are not preserved. A separate opt-in downloader can be written against the asset manifest later. |
| 2026-07-30 | Board `activity_logs`: not captured | High volume, retention-limited by plan, no DeliveryOps use case. Item `updated_at` plus the updates feed cover the needed history. |
| 2026-07-30 | Sequenced core-first, then the long tail | Core boards finish in minutes so schema work can start immediately; the ~478-board sweep runs resumably in the background. |
| 2026-08-03 | Edit model: **drawer, one process at a time**. No editable grid. | Measured velocity, not preference: 125 of 146 rows created Feb 2026, 84 never edited after their creation month, recent months show 11-24 row-edits each. A spreadsheet would serve a workload that does not exist. |
| 2026-08-03 | Board is **segmented by state**; default view is Active work only (18 rows) | Live 71 / Pipeline 12 / Closed 45 are sibling views. Monday showed all 146 by default, which is part of how the median row reached 174 days untouched. |
| 2026-08-03 | The board doubles as the **weekly team review surface** | Rishabh's constraint. Forces read-only cards (legible, projectable) with all density in the drawer. |
| 2026-08-03 | **No drag and drop.** Lane change happens in the drawer. | A lane change usually needs a second field. 7 currently-blocked rows have no reason set precisely because Monday let status change without asking. Compromise if wanted: drag opens the drawer pre-filled and unsaved. |
| 2026-08-03 | Permissions: whole team edits, attribution best-effort | `updated_by` from the Auth0 session. No per-field locks. Does not block cutover. |
| 2026-08-03 | **Activity Log (43 rows) archived, not migrated** | Nothing was ever closed on it: all Open, 0/43 resolved dates, 0/43 owners, all created Feb 2026, single group. 0021 drops `monday_activities` and the 360 Activity tab. |
| 2026-08-03 | Inbound updates from Slack/Linear/mail get a **suggestion queue**, never a direct write | Planned future work, but it changes 0021: needs `process_suggestions` + per-field `field_provenance` + `reviewed_at`/`reviewed_by`. A wrong auto-update is worse than a stale row, because a stale row is visibly stale. |
| 2026-08-03 | IA sequencing: **conservative during migration, consolidate after 1.9 passes** | Recommendation, not yet accepted. Step 1.9 requires row-for-row report agreement across cutover; if the IA changes in the same diff, a moved number cannot be attributed to the data model or the loader. |
| 2026-08-03 | **"Project" and "process" are the same thing. Use `process` everywhere**, in code, schema and UI copy. | Rishabh. Removes a synonym that currently splits the codebase (`monday_projects`, `ProjectDetailPanel`, `loadActiveProjects` all become process-named). |
| 2026-08-03 | **Three views of `processes`, not four.** Active work = Backlog + Upcoming + In Progress + On Hold (**30**). Delivered = Live (**71**). Archive = Inactive (**45**). | Rishabh. One screen for everything the team is actively doing, including V2 migration effort. My earlier "30 in-flight" was the right grouping under the wrong label. |
| 2026-08-03 | `account_type` and `deal_type` are **two separate fields**, and neither overlaps `custom_category` | Rishabh. `account_type` = direct \| partner_managed. `deal_type` = long_term \| pov. Monday's single "Account Type" column conflated both, so the import must split it and will leave gaps. |
| 2026-08-03 | **Conflicts always surface both values**, everywhere, not just in suggestions | Rishabh. Applies to inbound suggestions, sync-vs-manual, and duplicate rows at import. |
| 2026-08-03 | NPS gets its **own page**, deferred. Land the table in 0021 so data has a home; build the surface later, with a survey-send form. | Rishabh. Do not build the NPS UI in this phase. |
| 2026-08-03 | Customer health should be **auto-derived** from signals across systems, rules TBD | Rishabh's stated direction. The four manual axes stay as human-judgment inputs, because champion and exec-sponsor strength are not derivable from any system. |
| 2026-08-03 | V2 migration keeps **its own page**, reading the same `processes` rows as Active work and the all-hands report | Rishabh. Program-level rollup, not a separate dataset. Retires the hand-transcribed literals in `v2-allhands-weeks.ts`. |

## Blockers

| Blocker | Impact | Owner | Raised |
|---|---|---|---|
| **Kognitos v2 PAT is single-workspace** (`lib/sync/kognitos-v2.ts:51`, comment at 4-6). `k2_processes` / `k2_runs` cover ~1 customer, not 40. | `k2_process_id` will be null on nearly every one of the 146 imported rows, so value-derived-from-runs renders blank almost everywhere. Real usage reporting is impossible until fixed. Does **not** block building `processes` or retiring Monday. | unassigned | 2026-08-03 |
| Gmail send blocked on Google Workspace admin (send-as aliases) | Outbound digests | in flight | 2026-07-22 |
| Vercel Hobby caps crons at 2 | New scheduled work must ride the `tasks` dispatcher | accepted | 2026-07-22 |

## Open decisions

- **The IA choice, A or B.** Option A collapses to 5 nav entries (portfolio / customers / insights /
  reports / agent), deleting `/dashboard`, `/delivery` and `/analytics`. Option B keeps all 7 and
  dedupes only the loader layer. Recommendation is B during migration then A. Rishabh's call.
- `Account Type` (Partner 9 / Long Term 25 / POV 7) overlaps `custom_category` at two values,
  "Partner Managed" and "POV". Either it is contract shape and category is lifecycle and both stay, or
  one is redundant. Not resolvable from the archive.
- When an inbound suggestion arrives for a field a human set recently: drop it silently, or surface both
  values? Recommendation is surface both, because the human may be out of date.
- Whether the empty Discovery lane reflects reality or a logging gap. 0 of 18 active rows are in
  discovery; 10 are Testing/UAT, 7 Waiting for Customer, 1 Development. Decides the board's lane set.
- Own vs display the process record. Plan recommends own. Not formally settled.
- Retirement scope: report boards only, or the whole account. The five read paths
  above mean "report only" leaves four broken surfaces.
- Value model: currently modelled from `TIER_HOURS` × labour rate and self-labelled
  a placeholder. Real usage sits in `k2_runs`.
- Whether DeliveryOps' information architecture needs a redesign once the full
  dataset lands. Rishabh's instinct on 2026-07-30 was that it probably does. Defer
  until after 0.6 so the decision is made against real data.

---

## Session log

Append a dated entry per session. Keep it short: what ran, what it produced, what
the next session should pick up.

### 2026-07-30 — audit + backup tooling

- Audited every remaining Monday dependency in code and every doc mentioning the
  decommission. Findings recorded above. Headline: Phase 1 not started;
  `migration_processes` orphaned; five read paths, not one.
- Wrote `scripts/monday-full-backup.ts` (new, ~600 lines). Verified `--help` and
  `--dry-run` under tsx; dry-run makes zero API calls and writes a resumable
  manifest.
- Added `monday-backup-*/` to `.gitignore` and confirmed via `git check-ignore`
  that dated backup folders cannot be committed.
- Created this log.
- **Next session:** read `monday-backup-<date>/SUMMARY.md`, reconcile its totals
  against the 7,759-item inventory, then start 1.1 (schema design from real column
  definitions) and 1.5 (UI mockup) before touching any application code.

### 2026-08-03 — full archive captured and verified

Phase 0 is complete. `monday-backup-2026-08-03/` holds the whole account.

| Measure | Result |
|---|---|
| Boards exported | 492 of 492 visible, 0 errors |
| Items | 7,798 (inventory sum reported 7,757; +0.5%, cached `items_count` lag) |
| Updates | 1,597 across 607 items |
| Asset records (metadata) | 106 |
| Column definitions | 4,875, no board missing them |
| Relation cells | 2,206, of which 1,521 carry `linked_item_ids` |

Both defects that made the July snapshot unusable are fixed: labels are decodable
and cross-board links survived.

Findings that bear on design, not just completeness:

- **Monday holds very little written history.** Only 607 of 7,798 items (7.8%) have
  any update at all. An activity feed sourced from Monday updates would be empty on
  most customers. Do not design the customer 360 around it.
- **685 relation cells have no linked ids.** Assumed to be genuinely empty cells
  rather than a query defect; confirm during 1.1 before relying on relation
  coverage for customer matching.
- **106 attachments account-wide** retroactively justifies the metadata-only call.

- **Next session:** step 1.1. Derive the native schema from
  `monday-backup-2026-08-03/boards/*.json` column definitions across the ~140
  portfolio rows, decide the `processes` shape, then step 1.5, a UI mockup for
  approval. No application code until the mockup is signed off.

### 2026-08-03 (cont.) — schema designed from the archive

Profiled the 6 report boards (146 rows). Findings that changed the design:

- **`Delivered Value` is empty on all 116 rows that have it, and the `TTV (Days)`
  formula returns nothing through the API on all 146.** The all-hands value and
  time-to-value figures have never had underlying data. `Total Effort` (79/116) is
  the only quantitative column with real content.
- The customer join is solved, not risky: 140 of 146 rows carry a working
  `board_relation` to the Customers board across 40 customers. The 6 exceptions
  are 3 FY-2026 rows with a dropdown instead (Halemeyer, Airborne, Plunkett) and 3
  `Srinar` rows with nothing. The only name disagreement in the entire set is
  `iHeartRadio` vs `iHeart Radio`, 7 rows.
- Monday's taxonomy is blended: `Current Phase` mixes milestones, terminal states
  and waiting states across 15 values; `Health` is 91/146 "Finished", a lifecycle
  value, not a health value.
- Workspace `8906635`, "Unknown" in STATUS.md, resolves as **Norco**.
- The Projects Portfolio workspace (8917830) holds a second, older portfolio
  structure (Comprehensive Portfolio - Retired at 145 items, per-quarter Complete
  Projects boards) that the report does not read. Not in migration scope; noted so
  nobody rediscovers it and assumes it is authoritative.

Decisions taken: grain = one row per process soft-linked to `k2_processes`; build
a clean orthogonal taxonomy rather than inherit Monday's; TTV generated from
kickoff to go-live; value = manual per-process minutes-saved input multiplied by
real `k2_runs`, showing nothing where the input is absent.

Wrote [PROCESSES-SCHEMA-PROPOSAL.md](./PROCESSES-SCHEMA-PROPOSAL.md): full DDL,
the Monday-to-native derivation mapping with row counts, the 146-row import plan,
and the path to fold the existing 75 `migration_processes` rows in by extending
that table rather than replacing it.

**Plan reordered at the end of this session.** Step 1.5 (UI/IA design) now comes
*before* 1.2 (migration) and 1.3 (importer). Reason: the blocker on retiring
Monday is not data, it is that Monday is the team's **input surface** and
DeliveryOps has no way to edit a process. `lib/agent/prompts.ts` tells the agent
"FDE assignments are not writable, update Monday", and every write path in the
repo points outward at Monday. A read-only mirror goes stale the first time
someone edits a board. So the information architecture decides what the schema
needs to hold, not the reverse.

Also noted: [PROCESSES-SCHEMA-PROPOSAL.md](./PROCESSES-SCHEMA-PROPOSAL.md) covers
only the 146 project rows. Three production Monday dependencies still have **no
native home**: NPS Tracking (87 items -> `monday_nps_responses`, read by report,
analytics, customer 360, dashboard), Activity Log (43 items -> `monday_activities`,
read by the customer 360 activity card), and the Customers board (41 items — the
roster exists natively but the field diff has not been done). Resolve all three in
one pass so 0021 is a single migration, not three.

### 2026-08-03 (cont.) — step 1.5, information architecture

Delivered [docs/mockups/ia-step-1.5.html](./mockups/ia-step-1.5.html), five panels, awaiting approval.
All decisions taken are in the table above. What changed the design:

**Edit velocity is tiny, and that settles the edit surface.** 125 of the 146 report rows were created in
Feb 2026, 84 have never been edited after their creation month, and the last four months show only 11-24
row-edits each. The board was populated once and then largely left. So a drawer is sufficient and an
editable grid would be built for a workload that does not exist.

**A correction to the 2026-08-03 relation finding.** The archive's `board_relation` cells carry an empty
`text` field but a populated `linked_items` array. NPS is 87/87 linked to the Customers board and
Activity Log is 43/43 on `Customer`. There is no name-matching pass to write for either. The 685
"empty" relation cells are genuinely empty: Activity Log's second relation (`Project`) is empty on all
43 rows while `Customer` is full.

**The Customers board is a 9-field diff, not 24.** Fifteen of its 24 columns already have a native home
or are derivable. The 9 that need columns are the four-axis health scorecard (Renewal / Pipeline /
Champion / Exec Sponsor, each 41/41 filled, "Evaluating" → null), `account_type`, `company_revenue`,
`company_focus`, `company_priorities`, and `v2_demo_completed_at` as a date rather than a yes/no. Four
columns get dropped rather than migrated: Monday's blended `Customer Health`, its stale `NPS Score`
copy, the board group (already mirrored in `lifecycle_group`, which 0005 backfilled into
`custom_category` — 0021 should drop `lifecycle_group` outright), and `internal_profiles.health_score`,
superseded by the scorecard.

**A number I got wrong mid-session, corrected.** I first reported 30 in-flight rows by counting Backlog
and Upcoming as active. That double-counts the Pipeline view. The true split is Live 71, Active 18
(In Progress 14 + On Hold 4), Pipeline 12 (Backlog 10 + Upcoming 2), Closed 45 (Inactive), summing to
146. Of the 18 active, 10 are 31-90d stale and 3 are past 90 days.

**Two findings that fell out of the correction.** The Discovery lane is empty — the 18 active rows are
Testing/UAT 10, Waiting for Customer 7, Development 1 — so either there is no early-stage work or it
never gets logged. And health carries almost no signal on active work: On Track 13, On Hold 4, Off Track
1, with "at risk" unused. Colouring cards by health would render 13 green cards and one red; staleness
plus blocked-state differentiates better.

**New import consequence.** For the 7 rows whose Monday phase is literally "Waiting for Customer", the
underlying milestone is unrecoverable — the phase column was overwritten with the waiting state. The
mapping in PROCESSES-SCHEMA-PROPOSAL.md says "phase unchanged", but there is no prior phase to keep.
Import must leave `phase` null on those 7 and they need a human pass. That is 7 of 18 active rows.

### 2026-08-03 (cont.) — clarifications from Rishabh, platform walkthrough delivered

Second mockup: [docs/mockups/platform-vision.html](./mockups/platform-vision.html) — five views covering
the whole platform (one-liner, platform map, how a process moves, the Monday-morning and Friday-review
journeys, decisions and sequence). Companion to the detailed IA mockup. Decisions from this exchange are
in the table above; the nav settles at **six entries**: Work · Customers · V2 Migration · Reports ·
Insights · Agent, with Work holding the three-view switcher.

Two data defects surfaced while deriving the exact view counts, both affecting headline numbers:

- **4 rows marked `Live` are not live** — phase reads Pre-Kickoff (1), POV complete (1), Waiting for
  Customer (2). The delivered count is overstated by 4 today.
- **4 rows marked `Inactive` are "POV complete, Waiting for next steps"** — a POV awaiting a decision is
  live pipeline, not archive.

Corrected, the split is Active **34**, Delivered **67**, Archive **41**. Import must flag rather than
silently reclassify these 8, consistent with the surface-both-values rule.

Also new: splitting Monday's single "Account Type" column into `account_type` and `deal_type` means
**every one of the 41 customer rows will be missing one of the two fields** after import, because no
Monday row carries both axes. Cheap to fix by hand, but it needs planning rather than discovery.

Still open and needed from Rishabh: the lane count on Active work (six lanes over 30 rows leaves
Discovery empty; recommend collapsing to four — Pipeline · Building · Validating · Stuck), whether the
nav rename happens before or after the 1.9 gate (recommend after), and who re-enters the 7 rows whose
milestone Monday overwrote.

**Next session:** get the three open items above, then write migration 0021 as a single migration covering
`processes` (extending `migration_processes`), `nps_responses`, the 9 Customers-board columns, the
`process_suggestions` table with `field_provenance`, and the `monday_activities` drop. Then 1.3, the
importer. Still no application code until the mockup is signed off.

### 2026-08-03 (cont.) — migration 0021 written

`supabase/migrations/0021_processes_native.sql` plus the matching additions to
`lib/supabase/types.ts`. Rishabh approved the IA and chose Journey A (edit one process at a time in
context) as the update flow, four lanes on the Active board, and the nav rename deferred until after the
1.9 gate.

What 0021 does: renames `migration_processes` to `processes` and adds 36 columns, 9 enum types,
`process_suggestions`, `nps_responses`, and the 9 Customers-board fields (the four-axis health scorecard,
`account_type`, `deal_type`, `company_revenue`, `company_focus`, `company_priorities`,
`v2_demo_completed_at`).

Three things worth knowing about how it was built:

- **It is additive only, against the step-1.5 plan.** See row 1.2b above. Catching this required checking
  read sites rather than trusting the plan; a dropped column the code still selects is a runtime 500 that
  `npm run build` does not catch.
- **The rename is cheap and the cutover window is harmless.** The table name reaches application code
  through exactly one constant, `TABLES.migrationProcesses`, consumed only by `lib/migrations/store.ts`.
  Nothing in the UI fetches `/api/migrations` — the routes have no call sites — so there is no user-facing
  breakage if the SQL and the deploy land minutes apart.
- **A real bug was caught in validation.** `ttv_days` was originally added in the same `ALTER TABLE` as
  `kickoff_date`, which Postgres rejects because a generated column's expression cannot reference a column
  added in the same statement. It is now a separate statement. Found by parsing all 51 statements through
  sqlglot's Postgres dialect after `apt-get install postgresql` failed for lack of root — so this was
  **not** validated by applying it to a real Postgres, and that gap is worth closing before it runs on
  production.
- Also guarded: the `platform` text-to-enum conversion raises with the offending values listed rather than
  coercing an unexpected value into `v1`.

Verification run: `tsc --noEmit` clean, `vitest run` 111/111 pass. `next build` was started but did not
finish inside the sandbox (10+ minutes, no output) — run it locally before committing.

### 2026-08-03 (cont.) — 0021 applied and verified, importer written

0021 was pushed (Vercel `dpl_3pRDmqfAXCgHU4qjmyHpHNGmnPrJ`, READY) and validated on real Postgres 15 via
`npm run db:reset`, which replayed 0001-0021 clean. An 8-check schema assertion then passed exactly: 75
rows survived the rename, `platform` is `process_platform` with v1:69 v2:4 custom:2, `ttv_days` is
`is_generated = ALWAYS`, `lifecycle` defaulted to discovery on all 75, both new tables present, all 11
new columns present, `migration_processes` gone.

Step 1.3 written: `lib/import/monday-taxonomy.ts` (pure derivation), `scripts/import-monday-backup.ts`
(I/O, dry run by default), `tests/import/monday-taxonomy.test.ts` (28 tests). The test suite replays the
actual 146 archive rows and asserts the approved view split, so a change to either the archive or the
mapping fails loudly instead of drifting. Full suite 139 passing, `tsc --noEmit` clean.

**Two corrections the work forced, both to claims in these docs:**

1. **The customer relation covers 94 of 146 rows, not 140.** `PROCESSES-SCHEMA-PROPOSAL.md` said 140 via
   `board_relation`. Measured: relation 94, `Customer` dropdown 45, neither 7. The resolution order
   matters and is not arbitrary — for the 7 `Wipro BPS - iHeartRadio - X` rows the dropdown says
   iHeart Radio (correct; Wipro BPS is the partner) while the item-name prefix says Wipro BPS (wrong), so
   the name prefix is a last resort and every row resolved that way is reported. Doc corrected.
2. **A fourth platform value exists: `Currently in V1; Testing in V2`** (1 row, Scan Health Enhancements
   Phase 2). Not a dirty value — a real mid-migration state. It maps to `platform = v1` (where it runs)
   plus `migration_stage = parity_testing`. Calling it v2 would overstate the V2 estate in the all-hands
   report by one row. 0021's SQL guard would have rejected it; the guard never fired locally because the
   0020 seed holds only 75 rows and three values. Caught by the archive-replay test, not by review.

Also handled: `migration_stage` is now set explicitly on every imported row, because 0019 defaults it to
`in_development` and all 146 rows would otherwise look mid-V2-migration.

**Customer matching cannot be validated against local Supabase.** `supabase/seed.sql` creates exactly
**1** customer, so after `npm run db:reset` the local roster is empty and all 146 rows read as unmatched.
The taxonomy and view counts are still valid locally (they come from the archive files); the customer
numbers are not. The script now detects a roster below 10 customers, says so, and **refuses `--apply`**
rather than importing 146 rows with null customers that would then have to be undone.

Three bugs found by running it, all mine, all worth recording because two are traps for the next script:

1. **`lib/supabase/ws-polyfill.ts` was not imported.** Its own doc comment says "import this as a
   side-effect at the top of tsx scripts" — supabase-js >= 2.105 needs a global WebSocket and only
   Node 22+ has one. On Node 18 it fails at roster load with a `RealtimeClient` transport message that
   points nowhere near the cause. **11 other scripts in `scripts/` have the same omission**
   (`apply-cloud-data-fixes`, `audit-sf-mappings`, `backfill-partner-ae`, `check-migration-safety`,
   `debug-century`, `inspect-arr`, `map-customer-workspaces`, `remap-century`, `remap-customer`,
   `resync-century`, `run-monday-sync`, `safe-migrate`). Not fixed here — flagged rather than silently
   changing 11 files that have not been tested.
2. **The dotenv prologue uses `override: true`**, so an inline `FOO=bar npx tsx ...` gets clobbered by
   `.env.local`. Targeting another database needs the new `--secrets-file <path>` flag, which loads last
   and wins. This affects every script sharing the prologue.
3. **`--env-file` collides with Node 20+'s own native flag** and gets swallowed before the script sees
   it. Hence `--secrets-file`.

**Next: dry-run against production, which writes nothing.**

```
npx vercel env pull .env.production.local --environment=production
npx tsx scripts/import-monday-backup.ts --secrets-file .env.production.local --verbose
```

Expect 146 rows, active 30 / delivered 71 / archive 45, customer source 94/45/7, and **15 flagged**.
`.env.production.local` is already gitignored by `.env.*.local`. If it reads 15, re-run with `--apply`.

**Then:** the drawer and the Active board, then 1.6-1.7 (rewire all five `monday_projects` read paths).

**Old next-step note, superseded:** step 1.3, the importer from `monday-backup-2026-08-03` into `processes` +
`nps_responses` + the customer fields, including the customer-key matching pass 0020 skipped, the
`needs_attention` flagging for the 7 unrecoverable-milestone rows and the 8 misclassified ones, and the
account/deal-type split gaps. Then the drawer and the Active board.

---

## Handoff — 2026-08-03, moving to Cursor / Claude Code

Work moved to Cursor so the agent can run the scripts itself. The Cowork sandbox has no network route
to Supabase (local or production) and no Docker, which meant every database step had to be handed back
and forth. Nothing else about the plan changed.

### State of the tree

| Path | State |
|---|---|
| `supabase/migrations/0021_processes_native.sql` | **committed and pushed** (`66dd719`), applied to LOCAL Supabase and verified. **Not yet applied to production.** |
| `lib/supabase/types.ts` | committed and pushed. `TABLES.migrationProcesses` now points at `"processes"`. |
| `docs/mockups/*.html` | committed and pushed. The IA is approved. |
| `lib/import/monday-taxonomy.ts` | **uncommitted.** Pure derivation, 28 tests. |
| `scripts/import-monday-backup.ts` | **uncommitted.** Dry-run default, never run with `--apply`. |
| `tests/import/monday-taxonomy.test.ts` | **uncommitted.** |
| `docs/MONDAY-DECOMMISSION-LOG.md`, `PROCESSES-SCHEMA-PROPOSAL.md`, `INDEX.md` | **modified since the push.** |

Verification status: `tsc --noEmit` clean, `vitest run` 139/139, `npm run db:reset` replays 0001-0021
clean on Postgres 15. `next build` has **not** been run since the importer was added.

### The one live risk

`/api/migrations` is broken in production right now. The deployed code points at a table named
`processes`, and production Supabase still has `migration_processes` because 0021 has not been applied
there. No user-facing impact — nothing in the UI fetches those routes, verified before the rename was
recommended — but it is genuinely broken until 0021 runs on production. **Apply 0021 to production
first**, wrapped in `BEGIN; ... COMMIT;` since Postgres DDL is transactional and the file both renames a
table and adds 36 columns.

### Immediate next steps, in order

1. Apply 0021 to production Supabase.
2. Dry-run the importer against production (read-only, writes nothing without `--apply`):
   `npx vercel env pull .env.production.local --environment=production` then
   `npx tsx scripts/import-monday-backup.ts --secrets-file .env.production.local --verbose`.
   Expect 146 rows, active 30 / delivered 71 / archive 45, customer source 94/45/7, **15 flagged**.
   A higher flagged count is most likely roster display names differing from Monday's labels, which is a
   `NAME_FIXUPS` entry per case, not a structural problem.
3. `--apply`. Idempotent on `source_item_id`, so re-running converges.
4. Build the process drawer and the Active board (four lanes: Pipeline · Building · Validating · Stuck).
   Mockups are approved — see `docs/mockups/platform-vision.html`.
5. Then 1.6-1.7: rewire all five `monday_projects` read paths, not just the report.
6. `1.8` is unconditional and independent: delete or authenticate `/api/monday/item-updates`, which is
   listed as public in `middleware.ts:14,27` while using the server's Monday token.

### Known debt this session created or uncovered

- **11 scripts miss the `ws-polyfill` import** and will fail on Node 18 with a misleading
  `RealtimeClient` error: `apply-cloud-data-fixes`, `audit-sf-mappings`, `backfill-partner-ae`,
  `check-migration-safety`, `debug-century`, `inspect-arr`, `map-customer-workspaces`, `remap-century`,
  `remap-customer`, `resync-century`, `run-monday-sync`, `safe-migrate`. Left alone deliberately — they
  are untested and some may predate supabase-js 2.105.
- The shared dotenv prologue uses `override: true`, so inline env vars are clobbered by `.env.local`.
  `import-monday-backup.ts` works around it with `--secrets-file`; other scripts do not.
- `docs/supabase-schema-full.sql` is stale at 0019.
- 0022 still needs writing: drop `monday_activities`, `customers.lifecycle_group` and
  `internal_profiles.health_score` — only after their read sites are rewired.
- `.env.local` points at local Supabase (`127.0.0.1:54321`), so any script run without
  `--secrets-file` targets local.

### Still open, needs Rishabh

- Who re-enters the 7 rows whose milestone Monday overwrote. Working assumption: the importer flags them,
  they land in the Stuck lane with a "milestone missing" badge, and the owning FDE fills them in during
  the weekly review. No separate cleanup task.
- Whether the empty Discovery lane is reality or a logging gap (0 of 30 active rows are in M1).
- The 41-row account_type / deal_type pass. Monday conflated the two axes, so every customer lands
  missing one of them.

---

### Next session — start here

Paste this prompt:

> Continuing the Monday decommission for deliveryOps. Read
> `docs/MONDAY-DECOMMISSION-LOG.md` first — go straight to the "Handoff — 2026-08-03" section near the
> bottom, which has the exact state of the tree, the one live production risk, and the ordered next
> steps. Then skim `docs/PROCESSES-SCHEMA-PROPOSAL.md` for the schema and open
> `docs/mockups/platform-vision.html` for the approved IA. Do not redesign the IA — it is signed off.
>
> Unlike the previous sessions you can run things yourself here, so do. There is Docker + local Supabase
> (`npm run db:reset`), and network access to production Supabase and Vercel.
>
> Work in this order, and stop to show me output at each numbered step before moving on:
>
> 1. Apply `supabase/migrations/0021_processes_native.sql` to PRODUCTION Supabase, wrapped in
>    `BEGIN; ... COMMIT;`. It is already applied and verified on local. This is urgent: production code
>    already points at the renamed `processes` table, so `/api/migrations` is broken until this runs.
> 2. Dry-run the importer against production. It writes nothing without `--apply`:
>    `npx vercel env pull .env.production.local --environment=production` then
>    `npx tsx scripts/import-monday-backup.ts --secrets-file .env.production.local --verbose`.
>    Expect 146 rows, active 30 / delivered 71 / archive 45, customer source 94/45/7, 15 flagged.
>    Do not "fix" a higher flagged count by loosening the matching — diagnose each case first. Most
>    likely cause is roster display names differing from Monday labels, which is a `NAME_FIXUPS` entry.
> 3. Re-run with `--apply`, then verify the written rows against the archive independently rather than
>    trusting the script's own summary.
> 4. Build the process edit drawer and the Active-work board (four lanes: Pipeline · Building ·
>    Validating · Stuck). Cards read-only, all editing in the drawer, per-field save with no Save button,
>    lifecycle change moves the card and asks for what the new lane requires. Match the existing design
>    system — glass cards, brand tokens in `app/globals.css`. The mockups are approved; follow them.
>
> Independent of all the above and worth doing early: `/api/monday/item-updates` is listed as public in
> `middleware.ts:14,27` while using the server's Monday token. Delete it or authenticate it.
>
> House rules that still apply: I push, you don't — hand me the commit and push commands, staging only
> the files you changed, never `git add -A`. Verify with `npm run build`, `tsc --noEmit` and
> `vitest run` before handing anything over. Show me a visual mockup before any UI change that is not
> already in the approved mockups. Locales pinned (`toLocaleString("en-US")`) or the husky pre-commit
> vitest fails on my en-IN Mac. This is production with real customer data.
>
> There is uncommitted work in the tree (the importer, the taxonomy lib, its tests, and doc updates).
> Start by reviewing it rather than rewriting it.
