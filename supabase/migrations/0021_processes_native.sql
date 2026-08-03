-- ═════════════════════════════════════════════════════════════════════════════
-- 0021 — the native process model. Retires Monday as DeliveryOps' input surface.
--
-- Design decided at step 1.5 of the Monday decommission. See:
--   docs/MONDAY-DECOMMISSION-LOG.md          (decisions + phase checklist)
--   docs/PROCESSES-SCHEMA-PROPOSAL.md        (derivation mapping, row counts)
--   docs/mockups/platform-vision.html        (the approved IA)
--
-- What this does, in one breath: renames `migration_processes` to `processes` and
-- widens it from a V2-migration tracker into the record for all ~146 delivery
-- processes; adds `nps_responses`; adds the nine Customers-board fields that had
-- no native home; and adds the suggestion/provenance machinery that lets Slack,
-- Linear and mail propose changes without ever writing directly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS MIGRATION IS ADDITIVE ONLY. NOTHING IS DROPPED. Read this before asking
-- why `monday_activities` and `customers.lifecycle_group` are still here.
--
-- The step-1.5 plan called for dropping both in this migration. That plan was
-- wrong and would have taken production down, because both still have live read
-- sites in committed code:
--
--   customers.lifecycle_group  — 19 sites, incl. app/_components/brand.tsx:184,
--     app/(app)/dashboard/page.tsx:66, lib/customers.ts:93 (a .eq() filter), and
--     app/api/customers/[key]/manual-update/route.ts:22 (it is in ALLOWED_FIELDS,
--     so the UI can still write it).
--   monday_activities          — 5 sites, incl. lib/sync/monday.ts:512 (the
--     nightly sync would throw) and lib/cache/integrations.ts:206 (the customer
--     360 activity card).
--
-- Dropping a column or table the code still selects is a runtime 500, not a
-- compile error, so `npm run build` would have passed and the failure would have
-- landed on customers. The drops therefore move to 0022, AFTER those read sites
-- are rewired. 0022 is not written yet, deliberately.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Naming note: the proposal's DDL used `name`, `account_label`, `dev_owner` and
-- `total_effort_hours`. This migration keeps the existing 0019 column names
-- (`process_name`, `account`, `fde_owner`) instead. Renaming working columns buys
-- nothing and breaks lib/migrations/store.ts, which is the only live consumer.
-- `fde_owner` is also the better name — FDE is what the team is called.
-- ═════════════════════════════════════════════════════════════════════════════


-- ─── 1. Rename the table ─────────────────────────────────────────────────────
-- Safe: the table name reaches application code through exactly one constant,
-- TABLES.migrationProcesses in lib/supabase/types.ts:239, consumed only by
-- lib/migrations/store.ts (5 call sites). No compatibility view is needed.
-- Indexes, constraints and the updated_at trigger follow the rename automatically.

alter table migration_processes rename to processes;

alter index migration_processes_pkey          rename to processes_pkey;
alter index migration_processes_stage_idx     rename to processes_stage_idx;
alter index migration_processes_customer_idx  rename to processes_customer_idx;
alter index migration_processes_platform_idx  rename to processes_platform_idx;
alter index migration_processes_blocked_idx   rename to processes_blocked_idx;

alter trigger migration_processes_set_updated_at on processes
  rename to processes_set_updated_at;


-- ─── 2. The orthogonal state taxonomy ────────────────────────────────────────
-- Monday blended three concepts across two columns: `Current Phase` mixed
-- milestones with terminal states and waiting states across 15 values, and
-- `Health` was 91-of-146 "Finished", which is a lifecycle value, not a health
-- value. These five types separate what Monday conflated.

create type process_lifecycle as enum (
  'backlog',
  'upcoming',
  'discovery',
  'in_development',
  'uat',
  'live',
  'on_hold',
  'cancelled',
  'churned',
  'retired'
);

-- null once lifecycle = 'live'. Also null on the 7 imported rows whose Monday
-- phase was overwritten by the string "Waiting for Customer" — that column is a
-- single status field, so the underlying milestone is genuinely unrecoverable.
-- Those rows surface in the Stuck lane with a "milestone missing" badge and the
-- owning FDE fills them in during the weekly review.
create type process_phase as enum (
  'pre_kickoff',
  'm1_discovery',
  'm2_development',
  'm3_testing_uat',
  'm4_deployment',
  'm5_exception_handling'
);

-- Deliberately has no 'finished'. Health is only meaningful for in-flight work.
-- Note for whoever reads the first report off this: only 1 of the 18 active rows
-- was Off Track and "At Risk" was never used in Monday at all, so this column
-- carries very little signal until the team starts setting it honestly.
create type process_health as enum ('on_track', 'at_risk', 'off_track');

create type process_blocked_on as enum (
  'none',
  'customer',
  'kognitos_engg',
  'kognitos_delivery',
  'partner'
);

-- What "live" actually looks like day to day.
create type process_work_mode as enum (
  'steady_state',
  'exception_handling',
  'enhancement',
  'support'
);

create type process_platform as enum ('v1', 'v2', 'custom');


-- ─── 3. Convert platform text -> enum ────────────────────────────────────────
-- The 0020 seed holds exactly three values: 'V1' (69), 'V2' (4),
-- 'Custom Solution' (2). The guard below fails loudly and prints the offending
-- values rather than silently coercing an unexpected one into 'v1'. If this
-- raises, inspect the listed values and extend the CASE — do not widen the else.

do $$
declare
  bad text;
begin
  select string_agg(distinct platform, ', ')
    into bad
  from processes
  where platform is not null
    and lower(btrim(platform)) not in ('v1', 'v2', 'custom solution', 'custom');

  if bad is not null then
    raise exception
      '0021: unmapped platform value(s): %. Extend the CASE in this migration.', bad;
  end if;
end $$;

alter table processes
  alter column platform type process_platform
  using case lower(btrim(platform))
    when 'v1'              then 'v1'::process_platform
    when 'v2'              then 'v2'::process_platform
    when 'custom solution' then 'custom'::process_platform
    when 'custom'          then 'custom'::process_platform
    else null
  end;

alter table processes alter column platform set default 'v1'::process_platform;
update processes set platform = 'v1'::process_platform where platform is null;
alter table processes alter column platform set not null;


-- ─── 4. Widen processes ──────────────────────────────────────────────────────

alter table processes
  -- state. `process_status` (0019, text) is left in place as the legacy field so
  -- the existing store keeps working; `lifecycle` is the field the new UI reads.
  add column lifecycle    process_lifecycle not null default 'discovery',
  add column phase        process_phase,
  add column health       process_health,
  add column blocked_on   process_blocked_on not null default 'none',
  add column work_mode    process_work_mode,
  add column complexity   text,          -- Low / Medium / High

  -- customer linkage. customer_key (0019) stays the soft link that survives
  -- re-import; customer_id is the hard link, set by the importer's matching pass
  -- which migration 0020 skipped entirely (every row is still NULL today).
  add column customer_id  uuid references customers(id) on delete set null,

  -- Kognitos platform linkage. Soft by design: k2_processes covers roughly one
  -- customer of forty today because the v2 PAT is single-workspace
  -- (lib/sync/kognitos-v2.ts:51), so this is null on nearly every row and every
  -- run-derived value renders blank. Carrying the column costs nothing.
  add column k2_process_id   text,
  add column k2_workspace_id text,

  -- dates. kickoff_date only. ttv_days is added in a SEPARATE statement below:
  -- a generated column's expression may not reference a column added in the same
  -- ALTER TABLE, so folding it in here would fail with "column kickoff_date does
  -- not exist".
  add column kickoff_date date,

  -- ownership. fde_owner and engg_owner already exist from 0019.
  add column tam_owner text,
  add column partner   text,

  -- effort and value. Monday's `Delivered Value` was empty on all 116 rows that
  -- had it; `Total Effort` (79/116) was the only quantitative column with real
  -- content. Value is now: k2_runs in period x value_minutes_saved_per_run.
  -- Where either side is missing, the UI shows NOTHING rather than a modelled
  -- number. That is the intended behaviour, not a gap.
  add column total_effort_hours          numeric,
  add column value_minutes_saved_per_run numeric,
  add column value_basis                 text,
  add column value_confirmed_by          text,
  add column value_confirmed_at          timestamptz,

  -- freshness. Confirming a row is still accurate is NOT an edit; without this a
  -- row that has not changed can never look fresh, and the weekly review has no
  -- way to distinguish "still true" from "nobody has looked".
  add column reviewed_at timestamptz,
  add column reviewed_by text,

  -- per-field provenance. Needed the moment a human edit and an inbound
  -- suggestion can disagree: this is what lets the human win, and what lets the
  -- UI show both values rather than picking silently.
  --   shape: { "<column>": { "by": "rishabh|slack|linear|gmail|import", "at": "<ts>" } }
  add column field_provenance jsonb not null default '{}'::jsonb,

  -- provenance of the row itself. source_item_id makes re-running the Monday
  -- import idempotent; source_raw keeps the original strings for reconciliation
  -- and is never read by the UI.
  add column source_system  text,
  add column source_item_id text,
  add column source_raw     jsonb not null default '{}'::jsonb,

  -- set by the importer on rows it could not classify confidently: the 7 with an
  -- unrecoverable milestone, the 8 misclassified rows (4 marked Live that are not
  -- live, 4 marked Inactive that are POVs awaiting a decision), and the 3 Srinar
  -- rows with no customer. Flag, never silently reclassify.
  add column needs_attention        boolean not null default false,
  add column needs_attention_reason text;

-- ttv_days, separately. Depends on kickoff_date (added just above) and
-- go_live_date (from 0019). GENERATED and STORED, so it can never be hand-edited
-- and never drifts. Monday's "TTV (Days)" was a formula column that returned
-- nothing through the API on all 146 rows, which is why the all-hands
-- time-to-value figure has never had data behind it.
alter table processes
  add column ttv_days integer generated always as (
    case
      when kickoff_date is not null and go_live_date is not null
      then (go_live_date - kickoff_date)
    end
  ) stored;

create unique index processes_source_item_idx
  on processes (source_item_id) where source_item_id is not null;
create index processes_lifecycle_idx   on processes (lifecycle);
create index processes_customer_id_idx on processes (customer_id);
create index processes_k2_idx          on processes (k2_process_id);
create index processes_review_idx      on processes (reviewed_at nulls first);
create index processes_attention_idx   on processes (needs_attention) where needs_attention;

comment on table processes is
  'The record for every delivery process (one row per process per customer). Renamed and widened from migration_processes in 0021. Source of truth for the Work board, the customer 360 process list, the V2 migration page and the weekly/all-hands reports. Replaces monday_projects.';
comment on column processes.ttv_days is
  'Generated. Never hand-entered and never sourced from Monday, whose TTV formula column returned nothing via the API on all 146 rows.';
comment on column processes.health is
  'Only meaningful while in-flight. Null for live, cancelled and churned rows — pretending 91 finished rows are "healthy" is what made the old report health mix meaningless.';
comment on column processes.phase is
  'Null for live rows, and null for the 7 imported rows whose Monday milestone was overwritten by the "Waiting for Customer" status. Those carry needs_attention = true.';


-- ─── 5. process_suggestions ──────────────────────────────────────────────────
-- Slack, Linear, Gmail and Kognitos propose; a human accepts. Nothing external
-- writes into `processes` directly. A wrong auto-update is worse than a stale
-- row, because a stale row is at least visibly stale.
--
-- Rishabh, 2026-08-03: conflicts ALWAYS surface both values. A suggestion is
-- therefore never dropped just because a human recently set the field — the
-- human may be the one who is out of date.

create type suggestion_status as enum ('open', 'accepted', 'rejected', 'superseded');

create table process_suggestions (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references processes(id) on delete cascade,

  field           text not null,          -- the column on processes this targets
  current_value   text,                   -- as it stood when the suggestion was made
  suggested_value text,

  source          text not null,          -- 'slack' | 'linear' | 'gmail' | 'k2' | 'agent'
  source_ref      text,                   -- permalink, issue id, message ts
  rationale       text,                   -- why the source believes this
  confidence      numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  status          suggestion_status not null default 'open',
  resolved_by     text,
  resolved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger process_suggestions_set_updated_at before update on process_suggestions
for each row execute function set_updated_at();

create index process_suggestions_open_idx
  on process_suggestions (process_id) where status = 'open';
create index process_suggestions_status_idx on process_suggestions (status, created_at desc);

comment on table process_suggestions is
  'Inbound proposed changes to a process from Slack, Linear, Gmail, Kognitos or the agent. Accepting a row writes the field on processes, stamps field_provenance and sets reviewed_at. Open rows surface as a badge on the Work board card and a strip above the lanes.';


-- ─── 6. nps_responses ────────────────────────────────────────────────────────
-- 87 rows from the Monday NPS Tracking board, spanning Q2'24 to Q4'25. The
-- customer join is solid: all 87 carry a working board_relation to the Customers
-- board. The surface for this is deferred (its own page plus a survey-send form),
-- but the table lands now so the data has a home and 0021 stays one migration.

create table nps_responses (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers(id) on delete cascade,

  respondent_name      text not null,      -- Monday item name, 87/87
  respondent_type      text,               -- SME / Executive Sponsor / ... 77/87
  quarter              text not null,      -- 87/87, e.g. "Q4'25"
  response_date        date not null,      -- 87/87
  score                smallint not null check (score between 0 and 10),
  product_satisfaction text,               -- 83/87
  feedback             text,               -- 30/87

  -- NPS category (Promoter / Passive / Detractor) is DERIVED from score in the
  -- app, never stored. Monday stored it and it can therefore disagree with score.
  source_item_id       text unique,        -- idempotent re-import
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger nps_responses_set_updated_at before update on nps_responses
for each row execute function set_updated_at();

create index nps_responses_customer_idx on nps_responses (customer_id);
create index nps_responses_quarter_idx  on nps_responses (quarter);
create index nps_responses_date_idx     on nps_responses (response_date desc);

comment on table nps_responses is
  'Individual NPS survey responses (87 imported from the Monday NPS Tracking board). internal_profiles.nps_score becomes derived from this table and should stop being hand-set. NPS category is computed from score, not stored.';


-- ─── 7. The Customers-board fields with no native home ───────────────────────
-- Monday's Customers board had 24 columns. Fifteen already existed natively or
-- are derivable from `processes` (completed count, in-progress count, last
-- delivery date, the AI summary). These are the nine that did not.

-- Monday's single "Account Type" column conflated two orthogonal axes:
-- Partner (9), Long Term (25), POV (7). Rishabh, 2026-08-03: account type is
-- Direct or Partner-managed; deal type is Long-term or POV. They are separate.
--
-- Import consequence, planned rather than discovered: because no Monday row
-- carries both axes, every one of the 41 rows lands missing one of these two
-- fields. The Partner dropdown (11/41 filled) only partly disambiguates. That is
-- a one-time human pass over 41 rows.
create type account_type as enum ('direct', 'partner_managed');
create type deal_type    as enum ('long_term', 'pov');

alter table customers
  add column account_type account_type,
  add column deal_type    deal_type;

create index customers_account_type_idx on customers (account_type) where deleted_at is null;

-- The four-axis health scorecard. 41/41 filled in Monday, which makes it the
-- best-maintained thing on that board. Values were Strong (3) / Moderate (2) /
-- Critical (1) / Evaluating; "Evaluating" (15-17 rows per axis, mostly churned,
-- dropped and POV accounts) imports as NULL, meaning not assessed.
--
-- These four replace internal_profiles.health_score, an int 0-100 that nobody can
-- defend. health_score is NOT dropped here — see the header. Rishabh's direction
-- is that overall customer health becomes auto-derived from signals across
-- systems with rules set later; these four stay as human-judgment inputs, because
-- champion strength and exec-sponsor engagement are not derivable from any system.
alter table internal_profiles
  add column renewal_health      smallint check (renewal_health      between 1 and 3),
  add column pipeline_health     smallint check (pipeline_health     between 1 and 3),
  add column champion_health     smallint check (champion_health     between 1 and 3),
  add column exec_sponsor_health smallint check (exec_sponsor_health between 1 and 3),
  -- a date, not Monday's Yes/No dropdown (4 Yes, 24 No, 13 blank)
  add column v2_demo_completed_at date;

comment on column internal_profiles.renewal_health is
  '1 = critical, 2 = moderate, 3 = strong, null = not assessed. One of four human-judgment axes replacing health_score. Monday''s "Evaluating" imports as null.';

-- Company context: all three were 41/41 filled in Monday with real content and
-- had nowhere to go. These sit on `profiles` (customer-facing, agent-writable)
-- rather than internal_profiles because none of it is confidential.
alter table profiles
  add column company_revenue    text not null default '',   -- e.g. "~$3.8B", "$50.00M"
  add column company_focus      text not null default '',   -- e.g. "Industrial metal & steel fabrication"
  add column company_priorities text not null default '';   -- e.g. "Project profitability tracking"


-- ─── 8. RLS ──────────────────────────────────────────────────────────────────
-- No policies, matching the Auth0 model established in 0016: the browser never
-- talks to Supabase directly. Every read and write goes through the app's server
-- routes using supabaseAdmin (service role), gated by Auth0 session middleware.
-- `processes` already has RLS enabled, inherited through the rename from 0019.

alter table process_suggestions enable row level security;
alter table nps_responses       enable row level security;
