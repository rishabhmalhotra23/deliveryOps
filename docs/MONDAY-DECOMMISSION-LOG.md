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
| 1.2 | Generalize `migration_processes` into `processes` | **done, applied to production 2026-08-06** | `supabase/migrations/0021_processes_native.sql`, plus `0019`/`0020` (also applied to prod the same day — production had never run those either) and `0022` (fixed a real `ON CONFLICT` bug: the `source_item_id` index was partial, Postgres won't infer from that). **Additive only — nothing dropped**, see 1.2b. |
| 1.2b | Drops: `monday_activities`, `customers.lifecycle_group`, `internal_profiles.health_score` | not started, **deliberately** | Unchanged from 2026-08-03: both still have live read sites, dropping now would 500 on customers. Note: **0022 and 0023 were used for other fixes, not these drops** — renumber to 0024+ when this is picked up. |
| 1.3 | Write the importer from the backup into Supabase | **done, applied to production 2026-08-06** | `scripts/import-monday-backup.ts` run with `--apply`. 146 rows imported, deduped (5 cross-board + 63 seed-merge), final count 153. See the 2026-08-06 handoff below for the full diagnosis trail (22-vs-15 flagged count, Srinar now a real customer, 3 near-miss rows left for a human). |
| 1.4 | Populate auto-derived columns from `k2_processes` / `k2_runs` | not started | Real usage data currently unused. |
| 1.5 | Mockup the UI + decide the IA | **done** | [docs/mockups/ia-step-1.5.html](./mockups/ia-step-1.5.html) approved. Drawer + Active-work board built and shipped 2026-08-04/06 — see handoff below. |
| 1.6 | Rewire `weekly-loader.ts` off `monday_projects` | not started | |
| 1.7 | Rewire the other four read paths | **1 of 5 done** | `/delivery` fully rewired onto `processes` 2026-08-06 (own tabs, own loader). analytics, dashboard, cache/integrations (customer 360) still on `monday_projects`. |
| 1.8 | Authenticate or delete `/api/monday/item-updates` | **done 2026-08-06** | Deleted — was public and unauthenticated. |
| 1.9 | Verify report numbers match row-for-row before cutover | not started | Hard gate. Matters more now that `/delivery` and the weekly report can disagree (1.7 is partial). |
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

---

## Handoff — 2026-08-06, moving to the V2 reconciliation phase

Steps 1.2–1.5 and 1.8 are now done, in production, on real data. This section supersedes the
2026-08-03 handoff above for "what's next" purposes; that section is kept for history.

### What shipped since 2026-08-03

- **0019 + 0020 + 0021 applied to production**, in one transaction. Production had never run 0019/0020
  at all (not just "not yet renamed" — `migration_processes` was a flat 404), so the real gap was three
  migrations deep, not one. Also found and left alone: `0014_chat_tool_traces.sql` and
  `0017_linear_tickets.sql`/`0018` are *also* missing from production — unrelated to this work, flagged,
  not touched.
- **0019/0020 committed to git** (`cafdb90`) — they existed only on disk before, never in git history,
  even though the already-committed 0021 depends on the table 0019 creates.
- **0022 written and applied**: `0021`'s `source_item_id` index was a *partial* unique index
  (`where source_item_id is not null`). Postgres won't use a partial index for `ON CONFLICT` inference
  unless the query restates the same `WHERE`, which `supabase-js`'s `.upsert()` can't do — every import
  upsert failed with "no unique or exclusion constraint matching the ON CONFLICT specification" until this
  was replaced with a plain unique constraint (NULLs still repeat freely under standard SQL semantics, so
  nothing about hand-created future rows changes).
- **Importer run with `--apply` against production.** 146 rows, exact approved split (active 30 /
  delivered 71 / archive 45, customer source 94/45/7). Flagged count came in at 22, not the documented 15
  — diagnosed, not "fixed" by loosening matching: the 15 only ever counted taxonomy-derived flags (7
  unrecoverable-milestone + 8 misclassified); it never counted the customer-matching flags the script has
  always raised (4 documented last-resort name-inference recoveries + 3 Srinar rows, which resolved
  successfully this time because **Srinar is now a real roster customer**, added since the original
  analysis). 15 + 4 + 3 = 22, exactly. No `NAME_FIXUPS` change needed.
- **Deduped the imported set.** Two distinct duplicate classes, both diagnosed before merging:
  - 5 cross-board duplicates *within* the 146 Monday rows (same process listed on two FY boards — the
    exact failure mode `lib/delivery/loader.ts`'s `dedupeByCustomerAndName()` already exists to solve on
    the old Monday-cache path). Resolved by richness score (go-live-date presence, then populated-field
    count), loser deleted.
  - 63 rows also existed in the old 75-row 0020 seed (never matched against Monday because 0020 left
    `customer_key` null "for a later matching pass" — this was that pass, one day later than planned).
    Merged per `PROCESSES-SCHEMA-PROPOSAL.md`'s rule — Monday wins delivery fields, the seed wins
    V2-migration fields (`migration_stage`, `went_live_at`, parity/handover/validation dates,
    `linear_ticket_ids`, `arr`, `company_size`, …) — then the seed row deleted. Every merge's full
    pre-merge seed content is preserved in the surviving row's `source_raw._merged_from_seed`, so nothing
    was destroyed without a trace. 12 seed rows had no Monday match at all and were left standing —
    see "needs classification" below. **3 of those 12 look like near-miss name variants of a real Monday
    row** (`TTX - AP Invoicing` vs Monday's `TTX - AP Invoice Status`; `Bradley & Beams - Tax
    Reconciliation Yardi` vs `Tax Reconciliation`; `Conectiv POV` vs `Conectiv POV - SDS Billing`) — not
    auto-merged, names don't match exactly and guessing wrong silently merges two different processes.
    Still sitting there for a human call.
  - Final count: **153 processes** (141 Monday-sourced + 12 seed-only).
- **The process edit drawer + Active-work board, built and shipped** (`0d80139`), then substantially
  hardened after real usage:
  - `app/(app)/delivery/` is now **fully rebuilt on `processes`**, not `monday_projects` (`167aa3b`). Five
    tabs, one loader (`lib/processes/loader.ts`'s `loadProcessesOverview()`): Active Work (the four-lane
    board), Delivered, Archive (with a cancelled/churned/retired breakdown), All (sortable table — this is
    also the "consolidated view" Rishabh asked for), Q-on-Q (delivered/in-flight/at-risk by quarter, avg
    TTV from the generated `ttv_days` column, per-customer delivered counts). The old on-time-delivery-rate
    chart was dropped — it compared `go_live_date` against Monday's `timeline_end`, which 0021 didn't carry
    forward and nothing replaces.
  - **Known, accepted tradeoff**: the weekly report, analytics, dashboard, and customer 360 still read
    `monday_projects` — untouched. `/delivery`'s numbers can now disagree with theirs until those are
    rewired too (steps 1.6/1.7, still not started).
  - Rows with no `source_system` (the 12 seed-only rows above) get a visible **"needs classification"**
    badge everywhere they render, rather than looking like ordinary `discovery`-lifecycle work.
  - **Real bug, found and fixed**: the auth middleware redirected *any* unauthenticated `/api/` request to
    the HTML login page. A client `fetch().then(r => r.json())` against an HTML redirect throws an opaque
    "Unexpected token '<'" — this is what broke every field edit when Rishabh's session expired. Fixed
    middleware to return real `401`/`403` JSON for `/api/` paths (`6e1e431`); the root cause was session
    expiry, but the redirect-on-unauth behavior was a real gap affecting every API route, not just this one.
  - **FDE / TAM / Partner / Customer are now dropdowns** (`b5ec558`) — confirmed there is no canonical
    roster anywhere in this app (checked every layer: DB schema, API validation, the customer page's
    equivalent fields). Built from the distinct values already in the data instead of hardcoding one, with
    a "+ add new" fallback so a new hire or partner is never blocked. Customer is now reassignable too (a
    real select, not free text) — this is the tool to use for fixing the 3 near-miss rows above, and the 12
    needs-classification rows, once a human has decided the right customer for each.
  - Saving now calls `router.refresh()`, so a lifecycle change actually moves the card to its new lane
    live instead of only updating inside the still-open drawer.
- **`/api/monday/item-updates` deleted** (`cb144b0`) — was public and unauthenticated while holding the
  server's Monday token. Its only call site already degraded gracefully.
- **The no-push rule lifted.** Rishabh confirmed SSH push works from this sandbox; CLAUDE.md now allows
  `git commit`/`push` directly. The stale-`.git/index.lock` risk (concurrent sandbox + local terminal git)
  is documented there as the first thing to check if the user's own `git` gets stuck after a sandbox push.

### The next phase: Monday refresh + V2 Excel reconciliation

Rishabh's direction, stated directly: **Monday's Delivery Planning workspace
([board 18395281570](https://kognitos-company.monday.com/boards/18395281570)) is the source of truth for
V1/general delivery status. The V2 Migration List Excel is the source of truth for V2 migration progress.**
Overlap between the two is expected and correct, not a bug to reconcile away — Monday tracks a process
while it's live/in-flight, the Excel independently tracks that same process's V2 migration effort. Do not
try to collapse them into one row-for-row identity beyond the existing `(account, process_name)` match key.

Two concrete findings from this session, not yet acted on:

1. **This sandbox now has live network egress to Monday's API** (confirmed via a live GraphQL call to
   board 18395281570 — this did *not* work in earlier sessions, per the 2026-07-30 decision log entry
   above; that constraint no longer holds). A fresh pull no longer requires the user's own machine.
2. **`V2 Migration List (1).xlsx`** (repo root, dropped 2026-08-06, confirmed by Rishabh as the current
   authoritative version — supersedes `v2-migration-data/v2-migration-tracker-2026-08-03.xlsx`) has the
   **same 75 rows** as the Aug 3 version (no adds/removes) but **31 rows changed**: mostly an FDE
   reassignment (`Paige Gill` and `Arushi`'s book of work redistributed to `Rishabh Malhotra`, `Karthik N`,
   `Ayush`), plus real `Migration Status` transitions. One transition introduces a **genuinely new status**
   with no home in the current schema: `"Migration complete, waiting for commercial discussion or won't be
   used for now"` (8 Wipro FSS rows). Rishabh's call: **add a new `migration_stage` enum value** for this
   (not a forced fit into `live_on_v2` or `not_required` — both would lose real information), via a small
   additive migration (0023).

### Next session — start here

Paste this prompt:

> Continuing the Monday decommission for deliveryOps. Read `docs/MONDAY-DECOMMISSION-LOG.md` first — go
> straight to the "Handoff — 2026-08-06" section near the bottom for exact state and the plan below.
> `processes` is live in production with 153 rows; the drawer and Active-work board are shipped and
> working. This phase is the Monday refresh + V2 Excel reconciliation Rishabh asked for.
>
> Source-of-truth split, Rishabh's explicit call: Monday's Delivery Planning workspace (board
> `18395281570`) is authoritative for V1/general delivery status. `V2 Migration List (1).xlsx` (repo root)
> is authoritative for V2 migration progress. Overlap between the two is expected, not a bug — do not try
> to fully collapse them, match on `(account, process_name)` as the existing importer already does.
>
> Work in this order, stop to show output at each step:
>
> 1. Write migration 0023: add a new `migration_stage` enum value for `"Migration complete, waiting for
>    commercial discussion or won't be used for now"` (8 Wipro FSS rows in the Excel). Apply locally, then
>    production, same transaction-wrapped pattern as 0019-0022.
> 2. Live-pull Monday board `18395281570` (and the other 5 report boards, same set
>    `scripts/import-monday-backup.ts` already reads) directly via the API — this sandbox has network
>    access to Monday now, confirmed 2026-08-06, no longer needs the user's own machine. Diff against the
>    `monday-backup-2026-08-03` archive first so you know exactly what changed before writing anything.
> 3. Diff `V2 Migration List (1).xlsx`'s Working Sheet against what's already merged into `processes`
>    (75 rows, same shape as the old 0020 seed). 31 rows already known to differ — mostly FDE reassignment,
>    some Migration Status transitions. Merge using the existing "Monday wins delivery fields, Excel wins
>    V2-migration fields" rule, applied to the *refreshed* Monday data from step 2.
> 4. Build the dedicated **V2 Migration page/tab** (Rishabh confirmed this scope) — reads the same
>    `processes` rows, filtered to real V2 activity (`platform = 'v2'` or `migration_stage != 'not_required'`
>    or any V2-specific field populated), showing migration-specific columns: stage, parity/handover/
>    validation dates, completion %, blockers, Linear tickets. Follow the existing `ProcessTable`/loader
>    pattern in `lib/processes/loader.ts` and `app/(app)/delivery/delivery-client.tsx` — don't invent a new
>    pattern for this.
>
> Also still open, not yet decided:
> - The 3 near-miss rows (`TTX - AP Invoicing`/`AP Invoice Status`, two Bradley & Beams tax entries, two
>   Conectiv POV entries) — use the new customer-reassignment dropdown once Rishabh confirms each is/isn't
>   a real duplicate.
> - The 12 "needs classification" rows (seed-only, no Monday match) — same tool, once triaged.
> - The stray `Acme` customer in production (seed data that `docs/CREDENTIALS.md` says should never be
>   there).
> - Whether to build the shared "field registry" (one source of truth for field labels/types across the
>   drawer, table, and card, instead of each defining its own) — flagged as a real but separate
>   architecture cleanup, not yet scoped.
>
> House rules: I push, you don't need to ask — the no-push rule was lifted 2026-08-04, see CLAUDE.md.
> Stage only files you actually changed, never `git add -A`. Verify with `npm run build`, `tsc --noEmit`,
> `vitest run` before pushing. Locales pinned (`toLocaleString("en-US")`). This is production with real
> customer data — diagnose drift before "fixing" it by loosening anything, same rule as always.

---

## 2026-08-06 (cont.) — Monday refresh + V2 Excel reconciliation, all four steps done

Ran the four-step plan from the handoff above end to end, stopping to show output at each step per the
plan's own instruction. All writes went to production via the Supabase MCP connector, which needed
reconnecting mid-session — it was initially scoped to a different Supabase account/org
(`rishabhmalhotra23's Project`) and only exposed the real `Delivery Ops` project (`prnakdaxcpzagntgvaqf`)
after Rishabh refreshed the connector's tool list from claude.ai connector settings. No local Postgres
connection string exists anywhere in the repo, so all production DDL/DML this session went through
`apply_migration`/`execute_sql`, not `safe-migrate.ts` (local-only, talks to the Docker container).

**Step 1 — migration 0023.** Added `migrated_pending_commercial` to the `migration_stage` enum (the new
Wipro FSS status from the refreshed Excel). Applied locally via `safe-migrate.ts`, then to production via
`apply_migration`. Also updated `lib/supabase/types.ts` (`MIGRATION_STAGES`/`MIGRATION_STAGE_LABELS`) — the
process drawer's stage dropdown picks it up automatically since it builds options from that constant.

**Step 2 — Monday refresh.** Live-pulled the same 6 report boards via `scripts/monday-full-backup.ts
--boards <ids>` into `monday-backup-2026-08-06-live/` (147 items vs. 146 archived) and diffed item-by-item
against `monday-backup-2026-08-03`. The diff was small — 1 new item, 2 changed status cells — but one of
the three needed a real judgment call, not a mechanical upsert:

- `JBI - Design Meeting Preparation` had actually migrated V1→V2, but Rishabh recorded it by creating a
  *new* Monday item on the FY-2026 board (`Development Platform: V2`, `Current Phase: Live in v2`) rather
  than editing the Feb-created FY-2025 item in place. Blindly re-running the existing dedup rule
  ("richness wins") would have kept the old, richer-but-stale V1 row and silently discarded the real
  migration signal right before building the V2 report on this data. Flagged to Rishabh, confirmed: kept
  the original row (real kickoff/go-live/effort history intact) but updated `platform`/`migration_stage`/
  `work_mode` from the newer item, and discarded the duplicate rather than importing it as a second row.
- `TTX - Lease Invoicing` moved to `Current Phase: Live in v2` — this resolved a pre-existing
  `needs_attention` data-defect flag (it was marked Live with a contradictory phase); cleared the flag.
- `JBI - Project Initiation Request 2` moved to `Waiting for Customer`, Monday's lossy state (overwrites
  the milestone). Flagged `needs_attention` per the established rule rather than guessing a phase.

All three transitions were verified against the actual `deriveState`/`derivePlatform` functions in
`lib/import/monday-taxonomy.ts` before writing anything (no taxonomy code changes needed — the mappings
already existed and were correct). Applied via three `execute_sql` updates, not by re-running the importer
wholesale, because the importer's plain `upsert(onConflict: source_item_id)` would have reintroduced the 5
cross-board duplicates the 2026-08-06 import already resolved by deleting the loser row — those duplicate
Monday items still exist upstream and would read back in as "new" on any raw re-import.

**Step 3 — V2 Excel reconciliation.** Parsed `V2 Migration List (1).xlsx` (`Working Sheet`, 75 rows) with
`openpyxl` and matched all 75 to production `processes` rows by normalized `(account, process_name)` —
100% match, no near-misses this time. Computed a full field-level diff against production (pulled via a
throwaway script using `.env.cloud` creds, since the MCP `execute_sql` text channel truncates results over
~60K characters). Findings before writing anything:

- All 8 distinct `Migration Status` values mapped cleanly to `migration_stage` (validated by checking the
  *distribution* of current prod values per status text — the dominant value per bucket confirmed the
  mapping; minority values were real drift to reconcile, not a mapping bug).
- `fde_owner` differed on 57 of 75 rows. Asked Rishabh before overwriting: mostly Monday's full names vs.
  Excel's shorthand (`Karthik Nagabhushana` vs `Karthik N`), but also the real FDE-reassignment the Excel
  refresh was supposed to capture (Paige Gill/Arushi's book of work → Rishabh/Karthik N/Ayush). Confirmed:
  Excel wins fde_owner too, despite it being Monday-sourced in the original 2026-08-06 merge — the
  reassignment is exactly what this pass exists to capture.
- Added a guard mid-analysis: a blank Excel cell never overwrites an existing non-blank value on
  owner/financial fields. Caught one real case (`engg_owner: 'Sid' → None` on a Mitie row) that would have
  silently erased data the Excel export just didn't happen to carry this time.
- `go_live_date` was deliberately left alone (two columns in the sheet share the header `Go-Live Date`;
  the first is empty on 66/75 rows and the second matches 0020's original seed values — used the second,
  but didn't touch this field at all since it's ambiguous whether Monday or Excel owns it post-merge and
  the plan's field list didn't name it).

Applied 67 row updates: 12 rows now `migrated_pending_commercial` (8 Wipro FSS + iHeartRadio + Pepsi + Scan
Health + JBI SBUX Quote Generator), 2 rows genuinely transitioned to `live_on_v2`
(`went_live_at` backfilled from validation/handover dates so the Slack notifier won't retro-fire on next
edit), 57 `fde_owner` refreshes, plus scattered `linear_ticket_ids`/date/notes updates.

**Step 4 — V2 Migration page.** Built `app/(app)/v2-migration/` (`page.tsx` + `v2-migration-client.tsx`),
following the existing `/delivery` pattern exactly rather than inventing a new one:

- `lib/processes/loader.ts`: extracted the shared `processes` + customer + suggestion-count fetch into
  `fetchAllProcessRows()` (was inlined in `loadProcessesOverview`) so `loadV2MigrationOverview()` doesn't
  re-derive it. Filter for "V2 relevant": `migration_stage != 'not_required' OR platform != 'v1' OR
  linear_ticket_ids.length OR any of the three V2 dates set` — so the page isn't just every process with a
  different label.
- Stage-count strip (reusing `StatBlock`, clickable to filter) + a single sortable table (Process,
  Customer, Stage, FDE, Parity/Handover/Validation dates, Completion %, ARR, Linear tickets as clickable
  chips linking to `linear.app`, Blockers) + the existing `ProcessDrawer` for editing, exactly per the plan
  ("don't invent a new pattern").
- Real gap found and fixed while wiring the drawer: it exposed `migration_stage` but none of the other V2
  fields (parity/handover/validation dates, completion %, Linear tickets, ARR, company size) — meaning
  there was no way to *edit* this data natively even after this session's reconciliation. Added a "V2
  migration" field group to `process-drawer.tsx` (including a new `TicketsRow` component for the
  comma-separated `linear_ticket_ids` array) and extended `EDITABLE_FIELDS` in `lib/processes/store.ts` so
  the new rows actually save. Without this, DeliveryOps would still not be a real substitute for the Excel
  on the one axis that matters most for retiring it — being able to update migration progress natively.
- Added `/v2-migration` to `PRIMARY_NAV` in `app-shell.tsx`, no other nav changes (nav consolidation is
  still deferred until after the 1.9 gate, per the standing decision).

Verified: `tsc --noEmit` clean, `vitest run` 139/139, `npm run build` succeeds and lists `/v2-migration`.
Called `loadV2MigrationOverview()` directly via a throwaway script against local Supabase to confirm no
runtime error (54 of 75 local seed rows read as V2-relevant) — full browser verification wasn't done since
the page sits behind Auth0 middleware and local Supabase only seeds 1 customer, same limitation noted in
every prior session for this reason.

**What's still open, unchanged from the handoff above:** the 3 near-miss rows, the 12 needs-classification
rows, the stray `Acme` customer, and the field-registry cleanup. None of those were touched this session.
Also newly true: `go_live_date`'s ownership (Monday vs. Excel, post-merge) is still unresolved — flagged
above, not decided.

**Next session:** 1.6/1.7 (rewire `weekly-loader.ts` and the other three `monday_projects` read paths) is
the next real step toward the 1.9 cutover gate — `/delivery` and `/v2-migration` now read live `processes`
data while the weekly report, analytics, dashboard, and customer 360 still read the Monday cache, so their
numbers can disagree. `docs/supabase-schema-full.sql` is still stale at 0019 and should be regenerated once
someone has a moment (cosmetic — doesn't block anything).

### 2026-08-06 (cont.) — ARR fix + duplicate cleanup on `/delivery`

Two follow-ups from Rishabh reviewing the new pages.

**ARR was stale for the same reason `migration_stage` was: `processes.arr` is a one-time Excel snapshot,
never re-synced.** JBI showed $384,335 (really $162K after a renewal) and Norco showed $639,000 (really
$311K). The app already has a live-ARR system for exactly this
(`lib/commercials/confirmed-arr.ts` — most recent past Closed-Won SF opp, plus a manual GTM-override table
for cases SF gets wrong) used by the customer 360, dashboard, and analytics; the V2 Migration page just
wasn't wired to it. Checked the raw `sf_opportunities` cache before touching anything: JBI's $162K renewal
was already correctly synced, so the live derivation needed no override — the page was simply reading the
wrong field. Norco needed an override, but the code already had one, at a now-stale $284K (someone hit this
same staleness before); updated to $311K. Wired `loadV2MigrationOverview()` to compute `confirmed_arr` the
same way the rest of the app does, verified against production (JBI → $162K, Norco → $311K exactly).

**Duplicate cleanup.** Rishabh flagged "a lot of duplicates" on `/delivery` — the same failure mode as the
JBI Design Meeting Prep case from earlier today (one real process represented by two rows: a stale V1
Monday item plus a separately-created V2 item, instead of one row updated in place), just more of them.
Pulled all 153 production rows and checked every same-customer pair, but **fuzzy name-similarity alone was
a bad signal** — e.g. "same go-live date, same customer" looked diagnostic at first (three real duplicate
pairs shared it) but turned out to be common for genuinely distinct processes too (Kognitos frequently
launched several unrelated automations for one customer on the same rollout day). Ended up requiring an
actual per-pair read of the fields, not just the names. Five confirmed and merged (survivor kept, loser's
non-conflicting fields folded in, then deleted — same technique as the JBI case):

  - Bradley & Beams: **`Tax Reconciliation Yardi`** (orphaned seed row) → **`Tax Reconciliation`** (exact
    go-live-date match, "Yardi" just names which property-management system the same reconciliation runs
    against).
  - Bradley & Beams: **`Tax Recon Vantaca and Random Flow`** (orphaned seed row) → **`Tax Recon v2`** (same
    pattern, a second and genuinely different tax-recon workflow for the Vantaca system — confirmed real by
    checking the *other* pair didn't collide with this one).
  - TTX: **`AP Invoicing`** (orphaned seed row) → **`AP Invoice Status`** — this one mattered beyond
    cosmetics: the seed row carried real `customer_validation` progress (parity/handover/validation dates)
    that the Monday-sourced survivor had never captured at all.
  - Plunkett: **`Customer Claims RA`** (plural, Monday duplicate) → **`Customer Claim RA`** (singular,
    richer history) — a one-letter pluralization split into two rows.
  - Bradley & Beams: **`Engagement Letter Flow - v2 Migration`** → **`Engagement Letters`** — the duplicate's
    own title named itself as this process's v2 migration. `went_live_at` set to the 2026-03-19 cutover date
    rather than overwriting `go_live_date` (kept at the real 2025-10-31 v1 launch), same pattern as the JBI
    case.

**Ruled out, not merged, after reading the actual data (not just names):** the `JBI - Project Initiation
Request` / `... v2` / `... 2` three-way looked like the obvious next candidate but has three distinct
kickoff/go-live timelines spanning 2024→2026 — three real automations built over time for a recurring need,
not duplicates. Also left alone: the several `<Process> Enhancements` rows across Wipro FSS/Halemeyer,
which are real distinct follow-on backlog items, not copies of their base process.

**Also fixed while in there:** 9 orphaned seed rows (`Conectiv POV`, `Pepsi - Fuzzy Matching`,
`Scan Health - Report`, and 6 `Wipro FSS` extraction rows) had `customer_key = NULL` even though their
account text trivially matches an existing roster customer other rows already resolve to — this wasn't a
real ambiguity, just a matching pass that only ran for Monday-merged seed rows during the original import.
Set `customer_key`/`customer_id` on all 9; left their content untouched.

**Open, asked Rishabh rather than guessed:**
- `Conectiv POV` (the orphaned seed row) carries real weight — 25 Linear tickets, $65K ARR, a real blocker —
  clearly the substantive Conectiv V2 effort. Unclear whether it's the same process as `Conectiv POV - SDS
  Billing` or `Conectiv - SONY Billing` (both Monday-sourced, no name overlap with "POV") or a third, broader
  thing. Not merged.
- `Airborne - Invoice Process` (v2, cancelled, zero evidence — one of the earlier-identified fallback-noise
  rows) vs. `Airborne - Invoice Processing` (v1, live, real revenue). Could be an abandoned V2 attempt at the
  same process (matches Rishabh's own note that some V1 work isn't migrating yet) or an unrelated cancelled
  item. Not merged.

Total after cleanup: 153 → 148 rows. No code changes needed — `/delivery` and `/v2-migration` read `processes`
live, so the lower, deduped count shows up automatically.
