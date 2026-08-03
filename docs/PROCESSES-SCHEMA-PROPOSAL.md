# `processes` — native schema proposal

Status: **proposed, awaiting approval.** No code written against this yet.
Derived from `monday-backup-2026-08-03/` (492 boards, 7,798 items) on 2026-08-03.
Tracker: [MONDAY-DECOMMISSION-LOG.md](./MONDAY-DECOMMISSION-LOG.md) step 1.1.

## Decisions this encodes

| Decision | Choice | Made |
|---|---|---|
| Grain | One row per **process**, soft-linked to `k2_processes` | 2026-08-03 |
| Taxonomy | Build clean orthogonal fields. Do **not** inherit Monday's blended values. | 2026-08-03 |
| TTV | Derived from kickoff to go-live, never stored as a Monday formula | 2026-08-03 |
| Value | Manual per-process entry in DeliveryOps | 2026-08-03 |
| V2 migration | First-class, because the V2 migration sheet driving the all-hands deck is the next deliverable | 2026-08-03 |
| Edit surface | A drawer, one process at a time. No editable grid. | 2026-08-03 (step 1.5) |
| Freshness | `reviewed_at` / `reviewed_by`, so confirming a row is still accurate counts without being an edit | 2026-08-03 (step 1.5) |
| Inbound signal | Slack / Linear / mail never write directly. They propose, via `process_suggestions`. | 2026-08-03 (step 1.5) |

IA and layout decisions live in [MONDAY-DECOMMISSION-LOG.md](./MONDAY-DECOMMISSION-LOG.md) and the
mockup at [mockups/ia-step-1.5.html](./mockups/ia-step-1.5.html).

## What the archive actually says

146 rows across the 6 report boards. Column fill rates:

| Column | Type | Fill | Verdict |
|---|---|---|---|
| Health | status | 100% | keep, but split (see taxonomy) |
| Project Status | status | 100% | keep, becomes `lifecycle` |
| Current Phase | status | 100% | keep, splits three ways |
| Development Platform | status | 100% | keep, becomes `platform` |
| Customer (relation) | board_relation | 96% | **the join key**, 140/146, 40 customers |
| Complexity | dropdown | 91% | keep |
| Kickoff Date | date | 71% | keep |
| Total Effort | numbers | 68% | keep, the only real quantitative column |
| Timeline | timeline | 59% | drop, redundant with kickoff + go-live |
| Go Live Date | date | 55% | keep |
| Migration | status | 53% of 30 rows | superseded by native migration fields |
| Dev / TAM | people | 51% / 42% | keep as owners |
| Partner | dropdown | 16% | keep, mostly null legitimately |
| **Delivered Value** | text | **0% of 116** | **drop — never populated** |
| **TTV (Days)** | formula | **0% of 146** | **drop — Monday does not return formula values via API** |

The two columns the all-hands value narrative rests on contain nothing. That is
the single most important finding of the migration.

## Taxonomy: four orthogonal fields replacing three blended ones

Monday's `Current Phase` mixes milestones, terminal states and waiting states.
`Health` mixes health with lifecycle ("Finished" is 91 of 146). We split them.

```sql
create type process_lifecycle as enum (
  'backlog', 'upcoming', 'discovery', 'in_development',
  'uat', 'live', 'on_hold', 'cancelled', 'churned', 'retired'
);
create type process_phase as enum (       -- null once lifecycle = live
  'pre_kickoff', 'm1_discovery', 'm2_development',
  'm3_testing_uat', 'm4_deployment', 'm5_exception_handling'
);
create type process_health as enum ('on_track', 'at_risk', 'off_track');
create type process_blocked_on as enum (
  'none', 'customer', 'kognitos_engg', 'kognitos_delivery', 'partner'
);
create type process_platform as enum ('v1', 'v2', 'custom');
create type process_work_mode as enum (   -- what live work looks like
  'steady_state', 'exception_handling', 'enhancement', 'support'
);
```

`migration_stage` from 0019 is kept unchanged — it already models V2 correctly.

### Derivation mapping (import-time only, then hand-maintained)

Monday `Project Status` -> `lifecycle`:

| Monday | n | lifecycle |
|---|---|---|
| Live | 71 | `live` |
| Inactive | 45 | `cancelled` / `churned` / `retired`, disambiguated by Current Phase |
| In Progress | 14 | `in_development` |
| Backlog | 10 | `backlog` |
| On Hold | 4 | `on_hold` |
| Upcoming | 2 | `upcoming` |

Monday `Current Phase` -> `phase` + `blocked_on` + `work_mode`:

| Monday | n | phase | blocked_on | work_mode |
|---|---|---|---|---|
| M5 - Exception Handling | 37 | `m5_exception_handling` | none | `exception_handling` |
| Cancelled | 29 | – | none | – (lifecycle `cancelled`) |
| Pre-Kickoff | 12 | `pre_kickoff` | none | – |
| Churned | 12 | – | none | – (lifecycle `churned`) |
| Customer Handling exceptions | 11 | `m5_exception_handling` | `customer` | `exception_handling` |
| M3 - Testing/UAT | 10 | `m3_testing_uat` | none | – |
| Waiting for Customer | 9 | **null, not "unchanged"** — see below | `customer` | – |
| Support | 8 | – | none | `support` |
| Enhancement | 6 | – | none | `enhancement` |
| Live in v2 | 4 | – | none | `steady_state` (+ `migration_stage = live_on_v2`) |
| POV complete, Waiting for next steps | 4 | `m1_discovery` | `customer` | – |
| Migrated to v2 | 1 | – | none | `steady_state` (+ `migration_stage = live_on_v2`) |
| M2 - Development | 1 | `m2_development` | none | – |
| M1 - Discovery | 1 | `m1_discovery` | none | – |
| POV complete | 1 | `m1_discovery` | none | – |

Monday `Health` -> `health`: `On Track` -> `on_track`, `Positive` -> `on_track`,
`Off Track` -> `off_track`. `Finished` (91), `Inactive` (20) and `On Hold` (4)
carry no health signal and become **null** — health is only meaningful for
in-flight work, and pretending 91 finished rows are "healthy" is what makes the
current report's health mix meaningless.

The raw Monday strings are preserved in `source_raw jsonb` for reconciliation.
They are never read by the UI.

> **Correction, 2026-08-03 (step 1.5): "phase unchanged" is not achievable.** Monday's `Current Phase`
> is a single status column, so a row set to "Waiting for Customer" has had its milestone **overwritten**.
> There is no prior phase to keep. Import must write `phase = null`, `blocked_on = customer`, and flag
> the row for a human pass. This matters more than the row count suggests: 7 of the 18 currently-active
> rows are in this state, so a third of the live board needs its milestone re-entered by hand.

### The three views, exact

Rishabh, 2026-08-03: **three layouts, not four.** Everything the team is actively doing sits on one
screen, including V2 migration effort. `Project Status` partitions the 146 rows cleanly:

| View | Monday `Project Status` | n |
|---|---|---|
| **Active work** (default; the weekly review screen) | Backlog 10 + Upcoming 2 + In Progress 14 + On Hold 4 | **30** |
| **Delivered** | Live | **71** |
| **Archive** | Inactive | **45** |
| | | 146 |

Lane mix inside Active work (30): Pipeline 12, Testing/UAT 10, Waiting for Customer 7, Development 1,
and **Discovery 0**. Health across the 18 non-pipeline rows is On Track 13, On Hold 4, Off Track 1, with
"at risk" never used — so health carries almost no signal on active work and card colour is better
derived from staleness plus blocked-state.

Phase mix inside Delivered (71): Exception Handling 37 + Customer Handling exceptions 11 = 48,
Support 8 + Enhancement 6 = 14, Live in v2 4 + Migrated to v2 1 = 5.

**Two data defects found while deriving these, both affecting headline numbers:**

- **4 rows marked `Live` are not live.** Their phase reads Pre-Kickoff (1), POV complete (1) or
  Waiting for Customer (2). The delivered count is overstated by 4 today.
- **4 rows marked `Inactive` are "POV complete, Waiting for next steps".** A POV awaiting a decision is
  live pipeline, not archive. Corrected, Active work is **34** and Archive is **41**.

Import should not silently reclassify these 8. Flag them and let a human decide, consistent with the
"surface both values" rule.

## DDL

```sql
create table processes (
  id                       uuid primary key default gen_random_uuid(),

  -- identity
  name                     text not null,
  customer_id              uuid references customers(id) on delete set null,
  customer_key             text,                    -- soft link, survives re-import
  account_label            text,                    -- raw label as it arrived

  -- platform linkage (nullable: not every process exists in k2 yet)
  k2_process_id            text,                    -- soft link -> k2_processes.k2_process_id
  k2_workspace_id          text,
  v2_workspace_url         text,

  -- orthogonal state
  lifecycle                process_lifecycle not null default 'discovery',
  phase                    process_phase,
  health                   process_health,
  blocked_on               process_blocked_on not null default 'none',
  work_mode                process_work_mode,
  platform                 process_platform not null default 'v1',
  complexity               text,                    -- Low / Medium / High
  priority                 text,

  -- V2 migration (carried forward from migration_processes, unchanged semantics)
  migration_stage          migration_stage not null default 'not_required',
  is_blocked               boolean not null default false,
  date_parity_complete     date,
  date_customer_handover   date,
  date_customer_validation date,
  completion_pct           numeric(4,3),
  went_live_at             timestamptz,             -- Slack notifier idempotency
  feature_delta            text,

  -- dates. ttv_days is GENERATED, never hand-entered, never from Monday.
  kickoff_date             date,
  go_live_date             date,
  ttv_days                 integer generated always as (
                             case when kickoff_date is not null and go_live_date is not null
                               then (go_live_date - kickoff_date) end
                           ) stored,

  -- ownership
  tam_owner                text,
  dev_owner                text,
  engg_owner               text,
  partner                  text,

  -- effort and value. value_* are HUMAN INPUT, usage is DERIVED from k2_runs.
  total_effort_hours       numeric,
  value_minutes_saved_per_run numeric,              -- the one human input
  value_basis              text,                    -- how they arrived at it
  value_confirmed_by       text,
  value_confirmed_at       timestamptz,

  -- detail
  blockers                 text,
  notes                    text,
  customer_contact         text,
  linear_ticket_ids        text[] not null default '{}',

  -- provenance
  source_system            text,                    -- 'monday' | 'manual' | 'v2_sheet'
  source_board             text,
  source_item_id           text,                    -- Monday item id, for idempotent re-import
  source_raw               jsonb not null default '{}'::jsonb,

  -- audit
  updated_by               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- freshness (step 1.5). Confirming a row is still accurate is NOT an edit;
  -- without this an unchanged row can never look fresh.
  reviewed_at              timestamptz,
  reviewed_by              text,

  -- per-field provenance (step 1.5). Needed the moment a human edit and an
  -- inbound Slack/Linear suggestion can disagree; this is what lets the human win.
  -- shape: { "<column>": { "by": "rishabh|slack|linear|import", "at": "<ts>" } }
  field_provenance         jsonb not null default '{}'::jsonb
);

create unique index processes_source_item_idx on processes (source_item_id)
  where source_item_id is not null;
create index processes_customer_idx  on processes (customer_key);
create index processes_lifecycle_idx on processes (lifecycle);
create index processes_platform_idx  on processes (platform);
create index processes_stage_idx     on processes (migration_stage);
create index processes_k2_idx        on processes (k2_process_id);
create index processes_blocked_idx   on processes (is_blocked) where is_blocked;

create index processes_review_idx on processes (reviewed_at nulls first);

alter table processes enable row level security;   -- service-role only, matches 0016
```

### Companion table: `process_suggestions` (step 1.5)

Rishabh's plan is to feed process updates from Slack, Linear and email. Those sources must not write
into `processes` directly — a wrong auto-update is worse than a stale row, because a stale row is at
least visibly stale. They propose; a human accepts.

```sql
create type suggestion_status as enum ('open', 'accepted', 'rejected', 'superseded');

create table process_suggestions (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references processes(id) on delete cascade,
  field           text not null,                 -- column name on processes
  current_value   text,                          -- as rendered at proposal time
  suggested_value text,
  source          text not null,                 -- 'slack' | 'linear' | 'gmail' | 'k2' | 'agent'
  source_ref      text,                          -- permalink / issue id / message ts
  rationale       text,                          -- why the source thinks this
  confidence      numeric(3,2),
  status          suggestion_status not null default 'open',
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index process_suggestions_open_idx
  on process_suggestions (process_id) where status = 'open';

alter table process_suggestions enable row level security;
```

Accepting a suggestion writes the field, stamps `field_provenance`, and sets `reviewed_at`. Open
suggestions surface as a count badge on the board card and a strip above the lanes.

**Open question, needs Rishabh:** when a suggestion arrives for a field a human set recently, drop it
silently or surface both values? Recommendation is surface both — the human may be out of date.

### Auto vs human

| Auto-derived, never editable | Human-owned |
|---|---|
| `ttv_days` (generated column) | `lifecycle`, `phase`, `health`, `blocked_on`, `work_mode` |
| run counts, last-run, failure rate (joined live from `k2_runs`) | `value_minutes_saved_per_run` and its basis |
| `k2_process_id` once matched | dates, owners, complexity, blockers, notes |
| `went_live_at` (trigger) | `migration_stage` |

Value = `k2_runs` count in period x `value_minutes_saved_per_run`. Processes with
no k2 link or no minutes input show **no value**, explicitly, rather than a
modelled number. That is the intended behaviour.

> **Blocker on the run-count half of this.** `lib/sync/kognitos-v2.ts:51` reads a
> single `KOGNITOS_V2_WORKSPACE_ID`, and the comment at lines 4-6 states the PAT
> is single-workspace. `k2_processes` and `k2_runs` therefore cover roughly one
> customer, not the 40 in the portfolio, so `k2_process_id` will be null on nearly
> every imported row and value-from-runs will render blank almost everywhere.
>
> This does not change the schema — the link costs nothing to carry — but it means
> the first cut ships with **manual value input only**. A multi-workspace PAT or
> per-customer Kognitos credentials is a prerequisite for real value reporting and
> is not currently tracked as a blocker anywhere. Raise it in parallel; it likely
> has a lead time.

## Import plan (146 rows)

1. Load the 6 report boards from `monday-backup-2026-08-03/boards/`.
2. Resolve customer via `board_relation` linked item name -> `customers.key`.
   140 of 146 resolve. Normalise `iHeartRadio` / `iHeart Radio` (7 rows, the only
   disagreement in the set).
3. Fall back to the `Customer` dropdown for the 3 FY-2026 rows with no relation
   (Halemeyer, Airborne, Plunkett).
4. Leave the 3 `Srinar` rows with `customer_key` null and flag them for review —
   Srinar is not in the customers roster.
5. Apply the derivation mapping above; write raw Monday values to `source_raw`.
6. Set `source_item_id` so re-running the import is idempotent.

## Migrating the existing 75 `migration_processes` rows

`migration_processes` is a strict subset in shape. Plan: keep the table, add the
new columns to it and rename to `processes`, rather than create a second table
and copy. That preserves the Slack notifier's `went_live_at` idempotency and the
existing `/api/migrations` routes keep working during the transition.

Expect overlap between the 75 seeded rows and the 146 Monday rows. De-duplicate
on `(customer_key, lower(process_name))` and prefer the Monday row for delivery
fields, the seeded row for V2 migration fields.

## Deliberately dropped

Monday `Timeline` (redundant), `Delivered Value` (empty), `TTV (Days)` formula
(empty via API, now generated), and Monday's blended `Current Phase` string as a
user-facing value.

## The rest of migration 0021 — NPS and the Customers board

Settled at step 1.5 so 0021 is one migration rather than three. Activity Log is **archived, not
migrated**: nothing was ever closed on it (43/43 Open, 0/43 resolved dates, 0/43 owners), so 0021 drops
`monday_activities` and the customer 360 Activity tab.

Correction to the 2026-08-03 relation finding that this depends on: `board_relation` cells carry an empty
`text` field but a populated `linked_items` array. NPS is **87/87** linked to the Customers board and
Activity Log was **43/43**. There is no name-matching pass to write.

### `nps_responses` — 87 rows

```sql
create table nps_responses (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers(id) on delete cascade,
  respondent_name      text not null,            -- Monday item name, 87/87
  respondent_type      text,                     -- 77/87
  quarter              text not null,            -- 87/87, Q2'24 .. Q4'25
  response_date        date not null,            -- 87/87
  score                smallint not null check (score between 0 and 10),
  product_satisfaction text,                     -- 83/87
  feedback             text,                     -- 30/87
  source_item_id       text unique,              -- idempotent re-import
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index nps_responses_customer_idx on nps_responses (customer_id);
create index nps_responses_quarter_idx  on nps_responses (quarter);
alter table nps_responses enable row level security;
```

`NPS Category` (Promoter / Passive / Detractor) is **derived from `score`**, not stored.
`internal_profiles.nps_score` becomes derived from this table and stops being hand-set. Entry is manual —
there is no survey integration — so the customer 360 NPS tab needs an "Add response" form.

### Customers board — the 9 new columns

```sql
-- the four-axis scorecard. 41/41 filled in Monday. "Evaluating" (15-17 rows
-- each, mostly churned/dropped/POV accounts) imports as NULL = not assessed.
alter table internal_profiles
  add column renewal_health       smallint check (renewal_health       between 1 and 3),
  add column pipeline_health      smallint check (pipeline_health      between 1 and 3),
  add column champion_health      smallint check (champion_health      between 1 and 3),
  add column exec_sponsor_health  smallint check (exec_sponsor_health  between 1 and 3),
  add column v2_demo_completed_at date;          -- a date, not the yes/no dropdown

-- Monday's single "Account Type" column conflated two orthogonal axes.
-- Rishabh, 2026-08-03: account type is Direct or Partner managed; deal type is
-- Long term or POV. They are separate fields and neither overlaps custom_category.
create type account_type as enum ('direct', 'partner_managed');
create type deal_type    as enum ('long_term', 'pov');

alter table customers
  add column account_type account_type,
  add column deal_type    deal_type;

alter table profiles
  add column company_revenue    text not null default '',   -- 41/41, e.g. "~$3.8B"
  add column company_focus      text not null default '',   -- 41/41
  add column company_priorities text not null default '';   -- 41/41
```

Dropped rather than migrated, with reasons:

**Import consequence of the account/deal split.** Monday's one column holds Partner 9, Long Term 25,
POV 7. Those are values from two different axes, so no row carries both. Import can only set:
`Partner` → `account_type = partner_managed` (deal type unknown), `Long Term` → `deal_type = long_term`
(account type unknown), `POV` → `deal_type = pov` (account type unknown). **Every one of the 41 rows will
be missing one of the two fields**, and the `Partner` dropdown (11/41 filled) only partly disambiguates.
This needs a one-time human pass over 41 rows, which is cheap, but it must be planned rather than
discovered.

| Field | Why |
|---|---|
| Monday `Customer Health` | Blended, same defect as process `Health` — Churned and Dropped are lifecycle, not health. Rishabh's direction is that customer health becomes **auto-derived** from signals across systems with rules set later; the four manual axes remain as inputs, because champion and exec-sponsor strength are not derivable from any system. |
| Monday `NPS Score` (17/41) | Stale copy. Derive from `nps_responses`. |
| Monday board group | Already mirrored in `customers.lifecycle_group`, which 0005 backfilled into `custom_category`. **0021 should drop `lifecycle_group`** — it is Monday's field and becomes dead on cutover. |
| `internal_profiles.health_score int` 0-100 | Not from Monday, but superseded. A 0-100 number nobody can defend. |

Already native, do not re-add: ARR (`profiles.arr`), Industry, Employees, Renewal Date, AE
(`customers.ae_owner`), Partner, TAM/FDE. Derived from `processes`, never stored: completed project
count, in-progress count, last delivery date, and the AI "Summarize updates" text.

## Open, not yet decided

- Does a `project` grouping ever get added above `processes`? Deferred; the
  option is preserved because `processes` has no parent FK to unwind.
- De-dup rule when a seeded V2 row and a Monday row disagree on `go_live_date`.
- Whether `retired` processes stay visible in the customer 360 by default.
- `account_type` (Partner / Long Term / POV) overlaps `custom_category` at two values,
  "Partner Managed" and "POV". Either it is contract shape and category is lifecycle and both stay, or
  one is redundant. Not resolvable from the archive.
- Suggestion conflict rule: when an inbound suggestion targets a field a human set recently, drop it
  silently or surface both values? Recommendation is surface both.
