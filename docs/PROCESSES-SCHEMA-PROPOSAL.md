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
| Waiting for Customer | 9 | unchanged | `customer` | – |
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
  updated_at               timestamptz not null default now()
);

create unique index processes_source_item_idx on processes (source_item_id)
  where source_item_id is not null;
create index processes_customer_idx  on processes (customer_key);
create index processes_lifecycle_idx on processes (lifecycle);
create index processes_platform_idx  on processes (platform);
create index processes_stage_idx     on processes (migration_stage);
create index processes_k2_idx        on processes (k2_process_id);
create index processes_blocked_idx   on processes (is_blocked) where is_blocked;

alter table processes enable row level security;   -- service-role only, matches 0016
```

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

## Open, not yet decided

- Does a `project` grouping ever get added above `processes`? Deferred; the
  option is preserved because `processes` has no parent FK to unwind.
- De-dup rule when a seeded V2 row and a Monday row disagree on `go_live_date`.
- Whether `retired` processes stay visible in the customer 360 by default.
