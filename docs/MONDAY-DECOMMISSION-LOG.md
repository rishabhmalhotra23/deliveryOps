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
| 1.2 | Generalize `migration_processes` into `processes` (or a sibling) | not started | Must cover all ~140 portfolio rows, not just the 75 V2 ones. |
| 1.3 | Write the importer from the backup into Supabase | not started | Nothing like this exists today. Must include the customer-key matching pass that 0020 skipped. |
| 1.4 | Populate auto-derived columns from `k2_processes` / `k2_runs` | not started | Real usage data currently unused. |
| 1.5 | Mockup the UI for approval | not started | Required before any UI code (per CLAUDE.md). Covers customer 360, report, analytics. |
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

## Blockers

| Blocker | Impact | Owner | Raised |
|---|---|---|---|
| **Kognitos v2 PAT is single-workspace** (`lib/sync/kognitos-v2.ts:51`, comment at 4-6). `k2_processes` / `k2_runs` cover ~1 customer, not 40. | `k2_process_id` will be null on nearly every one of the 146 imported rows, so value-derived-from-runs renders blank almost everywhere. Real usage reporting is impossible until fixed. Does **not** block building `processes` or retiring Monday. | unassigned | 2026-08-03 |
| Gmail send blocked on Google Workspace admin (send-as aliases) | Outbound digests | in flight | 2026-07-22 |
| Vercel Hobby caps crons at 2 | New scheduled work must ride the `tasks` dispatcher | accepted | 2026-07-22 |

## Open decisions

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

### Next session — start here

Paste this prompt:

> Continuing the Monday decommission for deliveryOps. Read
> `docs/MONDAY-DECOMMISSION-LOG.md` first for the full state, then
> `docs/PROCESSES-SCHEMA-PROPOSAL.md` for the schema so far. The verified full
> archive is in `monday-backup-2026-08-03/` (492 boards, 7,798 items) — analyse it
> directly, it's in the mounted folder.
>
> This session is step 1.5: decide the overall information architecture and layout
> of DeliveryOps before finalising the schema. The driving constraint is that
> Monday is the team's input surface, so DeliveryOps needs an edit surface for
> ~140 processes or Monday cannot actually be retired.
>
> What I want out of this session:
> 1. A proposed IA for the whole app — what pages exist, what each one is for, and
>    which data point lives where. Cover the existing routes (dashboard, customers,
>    customers/[key], delivery, analytics, reports, operations) and say which
>    should merge, split, or go.
> 2. Where NPS (87 rows), Activity Log (43 rows) and the Customers board fields
>    live in that IA — these have no native home yet and must be settled so
>    migration 0021 is one migration, not three.
> 3. Where and how a process gets **edited**, since that is the actual blocker.
> 4. Visual mockups of the key screens for my approval before any code, matching
>    the existing design system (glass cards, brand tokens in `app/globals.css`).
>
> Ask me clarifying questions before designing. Don't write application code this
> session. Update the log and the schema proposal with whatever we decide.
