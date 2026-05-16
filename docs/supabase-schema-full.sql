-- ============================================================
-- DeliveryOps — Complete Schema (migrations 0001 → 0015)
-- Paste this entire file into Supabase SQL Editor and click Run
-- ============================================================


-- ──────────────────────────────────────────────────────────
-- 0001_init.sql
-- ──────────────────────────────────────────────────────────

-- DeliveryOps initial schema
--
-- Ports legacy/storage/profile.py (PROFILE_SCHEMA + INTERNAL_PROFILE_SCHEMA),
--       legacy/storage/event_log.py, legacy/storage/rules.py,
--       legacy/scheduler/task_store.py, legacy/storage/conversations.py,
--       legacy/customers.py
-- into typed Postgres tables.
--
-- RLS is enabled on every table; policies stay open in this migration and get
-- locked down in Phase 3 when external (multi-tenant) auth lands.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

create type contract_tier as enum ('starter', 'growth', 'enterprise');
create type deployment_stage as enum ('onboarding', 'pilot', 'scaling', 'mature');
create type churn_risk_level as enum ('low', 'medium', 'high');
create type customer_user_role as enum ('owner', 'csm', 'viewer');
create type task_status as enum ('active', 'paused', 'completed', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger helper
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- customers — one row per customer key, the root reference
-- (port of curator.customers / config customer entry)
-- ─────────────────────────────────────────────────────────────────────────────

create table customers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  slack_channel text,
  email_alias text,
  drive_folder_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger customers_set_updated_at before update on customers
for each row execute function set_updated_at();

create index customers_key_idx on customers (key) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — customer-facing profile (agent CAN read/write)
-- 1:1 with customers. Mirrors PROFILE_SCHEMA from legacy/storage/profile.py.
-- ─────────────────────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,

  -- company
  industry text not null default '',
  employee_count int not null default 0,
  website text not null default '',
  headquarters text not null default '',
  fiscal_year_end text not null default '',

  -- contract
  tier contract_tier,
  start_date date,
  renewal_date date,
  arr numeric(14, 2) not null default 0,
  credit_limit int not null default 0,
  billing_contact text not null default '',

  -- adoption
  deployment_stage deployment_stage not null default 'onboarding',
  automations_live int not null default 0,
  active_users int not null default 0,
  credits_used_mtd int not null default 0,
  last_active_date date,

  -- contacts table (rows: name, role, email, phone, notes)
  contacts jsonb not null default '[]'::jsonb,

  -- goals
  business_objectives jsonb not null default '[]'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  target_roi text not null default '',

  -- escape hatch for new fields the API surfaces (legacy "custom" section)
  custom jsonb not null default '{}'::jsonb,

  last_updated_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (customer_id)
);

create trigger profiles_set_updated_at before update on profiles
for each row execute function set_updated_at();

create index profiles_customer_idx on profiles (customer_id) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- internal_profiles — internal-only profile (agent has ZERO access)
-- 1:1 with customers. Mirrors INTERNAL_PROFILE_SCHEMA.
-- ─────────────────────────────────────────────────────────────────────────────

create table internal_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,

  -- health & engagement
  health_score int not null default 0 check (health_score between 0 and 100),
  nps_score int not null default 0 check (nps_score between -100 and 100),
  csat_score numeric(3, 2) not null default 0 check (csat_score between 0 and 5),
  last_qbr_date date,
  next_qbr_date date,
  churn_risk churn_risk_level not null default 'low',

  -- internal notes
  strategic_notes text not null default '',
  internal_notes text not null default '',
  last_updated_by text,

  custom jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (customer_id)
);

create trigger internal_profiles_set_updated_at before update on internal_profiles
for each row execute function set_updated_at();

create index internal_profiles_customer_idx on internal_profiles (customer_id) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- events — append-only event log per customer
-- (port of curator/storage/event_log.py — JSONL files become rows)
-- ─────────────────────────────────────────────────────────────────────────────

create table events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  event_type text not null,
  summary text not null default '',
  details jsonb not null default '{}'::jsonb,
  tags text[] not null default array[]::text[],
  week_key text not null,
  ts timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger events_set_updated_at before update on events
for each row execute function set_updated_at();

create index events_customer_ts_idx on events (customer_id, ts desc) where deleted_at is null;
create index events_customer_week_idx on events (customer_id, week_key);
create index events_event_type_idx on events (event_type);
create index events_tags_gin_idx on events using gin (tags);
create index events_details_gin_idx on events using gin (details jsonb_path_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- rules — free-form rules document per customer
-- (port of curator/storage/rules.py — single Markdown blob)
-- ─────────────────────────────────────────────────────────────────────────────

create table rules (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (customer_id)
);

create trigger rules_set_updated_at before update on rules
for each row execute function set_updated_at();

create index rules_customer_idx on rules (customer_id) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- tasks — scheduled / recurring / one-shot tasks
-- (port of curator/scheduler/task_store.py — schedule/action are JSONB)
--   schedule shape: { kind: 'once'|'recurring'|'cron', ... }
--   action   shape: { tool: '<tool_name>', args: {...} }
-- ─────────────────────────────────────────────────────────────────────────────

create table tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null default '',
  description text,
  schedule jsonb not null,
  action jsonb not null,
  status task_status not null default 'active',
  last_run timestamptz,
  next_run timestamptz,
  tags text[] not null default array[]::text[],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger tasks_set_updated_at before update on tasks
for each row execute function set_updated_at();

create index tasks_customer_idx on tasks (customer_id) where deleted_at is null;
create index tasks_due_idx on tasks (status, next_run) where deleted_at is null;
create index tasks_tags_gin_idx on tasks using gin (tags);

-- ─────────────────────────────────────────────────────────────────────────────
-- conversations — Slack/email exchanges archived for search + audit
-- (port of curator/storage/conversations.py)
-- ─────────────────────────────────────────────────────────────────────────────

create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  channel text not null,
  user_id text not null,
  user_name text not null default '',
  user_message text not null,
  bot_response text not null default '',
  ts timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger conversations_set_updated_at before update on conversations
for each row execute function set_updated_at();

create index conversations_customer_ts_idx on conversations (customer_id, ts desc) where deleted_at is null;
create index conversations_user_idx on conversations (user_id);
create index conversations_channel_idx on conversations (channel);

-- ─────────────────────────────────────────────────────────────────────────────
-- customer_users — auth users ↔ customers join (RBAC, Phase 3)
-- ─────────────────────────────────────────────────────────────────────────────

create table customer_users (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role customer_user_role not null default 'csm',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (customer_id, user_id)
);

create trigger customer_users_set_updated_at before update on customer_users
for each row execute function set_updated_at();

create index customer_users_user_idx on customer_users (user_id) where deleted_at is null;
create index customer_users_customer_idx on customer_users (customer_id) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- Policies are intentionally permissive in Phase 0 — every authenticated user
-- can read and write everything. Phase 3 introduces real CSM ↔ customer
-- scoping via customer_users.
-- ─────────────────────────────────────────────────────────────────────────────

alter table customers          enable row level security;
alter table profiles           enable row level security;
alter table internal_profiles  enable row level security;
alter table events             enable row level security;
alter table rules              enable row level security;
alter table tasks              enable row level security;
alter table conversations      enable row level security;
alter table customer_users     enable row level security;

create policy customers_open          on customers          for all to authenticated using (true) with check (true);
create policy profiles_open           on profiles           for all to authenticated using (true) with check (true);
create policy internal_profiles_open  on internal_profiles  for all to authenticated using (true) with check (true);
create policy events_open             on events             for all to authenticated using (true) with check (true);
create policy rules_open              on rules              for all to authenticated using (true) with check (true);
create policy tasks_open              on tasks              for all to authenticated using (true) with check (true);
create policy conversations_open      on conversations      for all to authenticated using (true) with check (true);
create policy customer_users_open     on customer_users     for all to authenticated using (true) with check (true);


-- ──────────────────────────────────────────────────────────
-- 0002_chat.sql
-- ──────────────────────────────────────────────────────────

-- DeliveryOps chat persistence — sessions + messages for the agent chat UI.
-- Inherited from kognitos-app-template (supabase/migrations/00000000000001_chat.sql).
-- These back the existing app/api/chat/* routes and lib/chat/chat-context.tsx.
--
-- In Phase 1, sessions get scoped to a customer (customer_id fk) when the
-- agent loop is fully wired into the dashboard. For now, prefix stays generic.

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text default 'default',
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_call jsonb,
  created_at timestamptz default now()
);

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create policy chat_sessions_open on chat_sessions for all using (true) with check (true);
create policy chat_messages_open on chat_messages for all using (true) with check (true);


-- ──────────────────────────────────────────────────────────
-- 0003_customer_external_ids.sql
-- ──────────────────────────────────────────────────────────

-- Phase 2 — extend customers with the external IDs every integration needs.
--
-- The model: Monday "Customers" board is the canonical roster (driver).
-- Each row is enriched with Salesforce + Kognitos v1/v2 + Slack channel.
-- Per-customer Monday workspace_id is optional — only set when the customer
-- has a dedicated workspace (Pepsi, JBI, Dish, etc.).

alter table customers
  add column if not exists monday_item_id text,
  add column if not exists monday_workspace_id text,
  add column if not exists salesforce_account_id text,
  add column if not exists kognitos_v1_department_id text,
  add column if not exists kognitos_v1_workspace_id text,
  add column if not exists kognitos_v2_workspace_id text,
  add column if not exists partner text,
  add column if not exists ce_owner text,
  -- Raw Monday group label: "High Risk", "Upcoming Renewal", "Growth / Focus",
  -- "Tier 2 - Secondary Priority", "Partner Managed", "POV", "Churned/Dropped".
  -- Kept separate from `profiles.deployment_stage` so we can carry the lifecycle
  -- signal verbatim while still letting the agent reason about onboarding /
  -- pilot / scaling / mature.
  add column if not exists lifecycle_group text;

create unique index if not exists customers_monday_item_idx on customers (monday_item_id) where monday_item_id is not null;
create unique index if not exists customers_sf_account_idx on customers (salesforce_account_id) where salesforce_account_id is not null;
create index if not exists customers_lifecycle_group_idx on customers (lifecycle_group) where deleted_at is null;


-- ──────────────────────────────────────────────────────────
-- 0004_integration_cache.sql
-- ──────────────────────────────────────────────────────────

-- Phase 2 Pass C — integration cache tables.
--
-- Strategy: store the raw external data as JSONB plus a small set of
-- frequently-queried columns lifted out for indexes. The dashboard reads
-- from these tables; the daily-sync cron + per-source sync runners
-- write into them on a cron schedule.
--
-- All cache rows carry the customer FK so we can wipe-and-replace per customer
-- when a sync runs. The composite (customer_id, external_id) constraint
-- enforces idempotency.

-- ─── Salesforce ─────────────────────────────────────────────────────────────

create table if not exists sf_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  sf_id text not null,
  name text not null,
  industry text,
  type text,
  annual_revenue numeric(20, 2),
  number_of_employees int,
  website text,
  phone text,
  billing_city text,
  billing_country text,
  owner_name text,
  sf_created_at timestamptz,
  sf_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (customer_id),
  unique (sf_id)
);
create index if not exists sf_accounts_customer_idx on sf_accounts (customer_id);

create table if not exists sf_opportunities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  sf_id text not null,
  account_sf_id text,
  name text not null,
  stage_name text,
  amount numeric(18, 2),
  close_date date,
  probability numeric(5, 2),
  is_closed boolean not null default false,
  is_won boolean not null default false,
  owner_name text,
  sf_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (sf_id)
);
create index if not exists sf_opps_customer_idx on sf_opportunities (customer_id);
create index if not exists sf_opps_close_idx on sf_opportunities (close_date) where is_closed = false;

create table if not exists sf_cases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  sf_id text not null,
  case_number text,
  account_sf_id text,
  subject text,
  status text,
  priority text,
  origin text,
  is_closed boolean not null default false,
  sf_created_at timestamptz,
  sf_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (sf_id)
);
create index if not exists sf_cases_customer_idx on sf_cases (customer_id);

-- ─── Monday — projects, activities, NPS ─────────────────────────────────────

create table if not exists monday_projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  monday_item_id text not null,
  board_id text not null,
  name text not null,
  group_title text,
  state text,
  monday_updated_at timestamptz,
  raw_columns jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (monday_item_id)
);
create index if not exists monday_projects_customer_idx on monday_projects (customer_id);
create index if not exists monday_projects_group_idx on monday_projects (group_title);

create table if not exists monday_activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  monday_item_id text not null,
  board_id text not null,
  name text not null,
  group_title text,
  state text,
  monday_updated_at timestamptz,
  raw_columns jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (monday_item_id)
);
create index if not exists monday_activities_customer_idx on monday_activities (customer_id);

create table if not exists monday_nps_responses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  monday_item_id text not null,
  board_id text not null,
  name text not null,
  group_title text,
  monday_updated_at timestamptz,
  raw_columns jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (monday_item_id)
);
create index if not exists monday_nps_customer_idx on monday_nps_responses (customer_id);

-- ─── Sync runs (audit log) ──────────────────────────────────────────────────

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                        -- "salesforce", "monday", "kognitos-v2"
  scope text not null default 'all',           -- "all" or a customer_key
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',      -- "running" | "ok" | "error"
  rows_synced int not null default 0,
  error text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists sync_runs_source_started_idx on sync_runs (source, started_at desc);


-- ──────────────────────────────────────────────────────────
-- 0005_ae_categories_truth.sql
-- ──────────────────────────────────────────────────────────

-- Phase 2 Pass E — own the data
--
-- Three intertwined changes:
-- 1. Rename ce_owner → ae_owner (Account Executive). The previous "CE" label
--    didn't match how Kognitos's post-sales team actually thinks about
--    ownership.
-- 2. Add custom_category — DeliveryOps's own lifecycle taxonomy, separate
--    from Monday's lifecycle_group. Monday remains a signal source; our
--    category is the operational truth.
-- 3. Add deliveryops_protected_fields — JSONB array of field names that
--    have been manually edited inside DeliveryOps. The sync runner skips
--    these so a stale Monday row can't clobber our hand-corrected data.

alter table customers rename column ce_owner to ae_owner;

alter table customers
  add column if not exists custom_category text,
  add column if not exists deliveryops_protected_fields jsonb not null default '[]'::jsonb,
  add column if not exists last_manually_edited_at timestamptz;

create index if not exists customers_custom_category_idx
  on customers (custom_category) where deleted_at is null;

-- Backfill custom_category from lifecycle_group using DeliveryOps's taxonomy.
-- Monday's labels are noisy and inconsistent — we collapse them into seven
-- buckets that map to actual CSM workflow.
update customers
set custom_category = case lifecycle_group
  when 'High Risk'                      then 'At Risk'
  when 'Upcoming Renewal'               then 'Upcoming Renewals'
  when 'Growth / Focus'                 then 'Strategic Growth'
  when 'Tier 2 - Secondary Priority'    then 'Active'
  when 'Partner Managed'                then 'Partner Managed'
  when 'POV'                             then 'POV'
  when 'Churned/Dropped'                then 'Churned'
  else 'Active'
end
where custom_category is null;


-- ──────────────────────────────────────────────────────────
-- 0006_nps_state_column.sql
-- ──────────────────────────────────────────────────────────

-- Phase 2 Pass I — NPS responses cache column parity
--
-- monday_nps_responses was missing the `state` column that monday_projects
-- and monday_activities have. The Monday sync code writes state on every
-- row, which 0-failed silently against the cache schema cache until we
-- exercised the NPS path with a populated dataset.

alter table monday_nps_responses
  add column if not exists state text;

create index if not exists monday_nps_state_idx on monday_nps_responses (state);


-- ──────────────────────────────────────────────────────────
-- 0007_brand_identity.sql
-- ──────────────────────────────────────────────────────────

-- Add per-customer brand identity columns.
-- brand_color: hex string e.g. "#E2231A" — drives the hero accent gradient.
-- logo_url: manual override; Clearbit auto-fetch is used when null.
-- Both are nullable and protected-field eligible.

alter table customers
  add column if not exists brand_color text,
  add column if not exists logo_url    text;

comment on column customers.brand_color is
  'Customer brand hex color (e.g. #E2231A). Drives the hero accent. Nullable — falls back to brand-yellow.';
comment on column customers.logo_url is
  'Manual logo URL override. When null, UI auto-fetches from logo.clearbit.com using the Salesforce account website domain.';


-- ──────────────────────────────────────────────────────────
-- 0008_kognitos_v2_cache.sql
-- ──────────────────────────────────────────────────────────

-- Phase 2 Pass N — Kognitos v2 sync cache.
--
-- Mirrors the sf_* / monday_* cache pattern. Source-of-truth for the
-- Kognitos workspace this PAT can read; per-customer link is established
-- via customers.kognitos_v2_workspace_id when the K2 workspace ID matches.
--
-- The v2 PAT is single-workspace scoped, so today we expect a single row in
-- k2_workspaces and many in k2_processes / k2_runs. Schema is forward-
-- compatible with multi-workspace tokens (each row carries k2_workspace_id).

-- ─── Workspaces ─────────────────────────────────────────────────────────────

create table if not exists k2_workspaces (
  id uuid primary key default gen_random_uuid(),
  k2_workspace_id text not null unique,
  display_name text,
  description text,
  state text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

comment on table k2_workspaces is
  'Cached Kognitos v2 workspace metadata. One row per workspace the PAT can read.';

-- ─── Processes (automations) ───────────────────────────────────────────────

create table if not exists k2_processes (
  id uuid primary key default gen_random_uuid(),
  k2_process_id text not null unique,
  k2_workspace_id text not null,
  customer_id uuid references customers(id) on delete set null,
  display_name text,
  name text,
  state text,
  k2_created_at timestamptz,
  k2_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists k2_processes_workspace_idx on k2_processes (k2_workspace_id);
create index if not exists k2_processes_customer_idx on k2_processes (customer_id);
create index if not exists k2_processes_updated_idx on k2_processes (k2_updated_at desc);

comment on table k2_processes is
  'Cached Kognitos v2 automations/processes. customer_id resolved via customers.kognitos_v2_workspace_id.';

-- ─── Runs (executions of processes) ─────────────────────────────────────────

create table if not exists k2_runs (
  id uuid primary key default gen_random_uuid(),
  k2_run_id text not null unique,
  k2_process_id text,
  k2_workspace_id text not null,
  customer_id uuid references customers(id) on delete set null,
  state text,                  -- "completed" | "failed" | "running" | "awaiting_guidance" | "stopped"
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms int,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists k2_runs_workspace_idx on k2_runs (k2_workspace_id);
create index if not exists k2_runs_process_idx on k2_runs (k2_process_id);
create index if not exists k2_runs_customer_idx on k2_runs (customer_id);
create index if not exists k2_runs_started_idx on k2_runs (started_at desc);
create index if not exists k2_runs_state_idx on k2_runs (state);

comment on table k2_runs is
  'Cached Kognitos v2 run history. state is the resolved Kognitos run state. Indexed on started_at for recency queries.';


-- ──────────────────────────────────────────────────────────
-- 0009_pending_approvals.sql
-- ──────────────────────────────────────────────────────────

-- Pending approvals — Slack-mediated human approval for email drafts +
-- gated agent actions. Port of legacy/approvals/email_approval.py and
-- legacy/approvals/action_approval.py, but persisted in Postgres so the
-- flow survives serverless cold starts.
--
-- Each row represents one approval card posted in Slack. The card carries
-- the approval_id as its button value; the interactive handler looks the
-- row up here, runs the underlying tool on approve, and updates state.

create type approval_kind as enum ('email_draft', 'gated_action');
create type approval_state as enum ('pending', 'approved', 'rejected', 'revised', 'expired');

create table pending_approvals (
  id                          text primary key,
  customer_id                 uuid not null references customers(id) on delete cascade,
  kind                        approval_kind not null,
  state                       approval_state not null default 'pending',

  -- The tool the agent originally invoked. For gated_action this is the
  -- target tool (e.g. update_customer_profile). For email_draft it's
  -- always "send_email" so the same execute path runs on approve.
  tool_name                   text not null,
  tool_input                  jsonb not null default '{}'::jsonb,

  -- Email-draft denormalised preview fields (faster Slack render).
  email_to                    text[],
  email_subject               text,
  email_body                  text,
  -- When this is a reply, threading metadata from the original inbound
  -- Gmail message so the outbound preserves the conversation.
  email_in_reply_to           text,
  email_references            text,
  email_gmail_thread_id       text,

  -- Slack card placement — where to update / where threads route back from.
  slack_channel               text,
  slack_message_ts            text,
  slack_thread_ts             text,

  -- Audit.
  created_by                  text default 'agent',
  created_at                  timestamptz not null default now(),
  decided_by                  text,
  decided_at                  timestamptz,
  decision_note               text,

  -- Revisions: append-only history. Each entry is
  --   { at, by, kind ('user_edit' | 'agent_revise'), patch }.
  revisions                   jsonb not null default '[]'::jsonb,
  updated_at                  timestamptz not null default now()
);

create trigger pending_approvals_set_updated_at before update on pending_approvals
for each row execute function set_updated_at();

create index pending_approvals_state_idx on pending_approvals (state, created_at desc);
create index pending_approvals_slack_thread_idx
  on pending_approvals (slack_thread_ts) where slack_thread_ts is not null;
create index pending_approvals_customer_idx
  on pending_approvals (customer_id, state, created_at desc);

alter table pending_approvals enable row level security;
-- Phase-1: keep open. Locks down with the rest of the RLS in Phase 3.
create policy pending_approvals_all on pending_approvals for all using (true);

comment on table pending_approvals is
  'Slack-mediated approval queue for email drafts and gated agent actions. One row per approval card.';


-- ──────────────────────────────────────────────────────────
-- 0010_monday_projects_historical.sql
-- ──────────────────────────────────────────────────────────

-- Extend monday_projects with historical data support + richer columns.
--
-- We now sync 6 boards instead of 1:
--   18395281570  Projects (active, in-flight)
--   18398797267  FY-2026 Deliverables
--   18398797224  FY-2025 Deliverables
--   18398797248  FY-2024 Deliverables
--   18398797257  FY-2023 Deliverables
--   18398797301  Inactive / Cancelled projects
--
-- New columns extracted from raw_columns on each sync:
--   total_effort_days  — "Total Effort" numbers column (numeric_mm0664sx)
--   delivered_value    — "Delivered Value" text column (text_mm09rsbe)
--   ttv_days_text      — "TTV (Days)" formula column (formula_mm01p18k)
--   timeline_start     — left edge of the Timeline timeline column
--   timeline_end       — right edge of the Timeline timeline column
--   latest_update      — most-recent Monday item update body (fetched separately)
--   fiscal_year        — "FY-2025" / "FY-2026" / "active" / "inactive"
--   board_name         — board display name for provenance

alter table monday_projects
  add column if not exists total_effort_days   integer,
  add column if not exists delivered_value     text,
  add column if not exists ttv_days_text       text,
  add column if not exists timeline_start      date,
  add column if not exists timeline_end        date,
  add column if not exists latest_update       text,
  add column if not exists fiscal_year         text,
  add column if not exists board_name          text;

comment on column monday_projects.fiscal_year is
  'Source board fiscal year: "FY-2026", "FY-2025", "FY-2024", "FY-2023", "active", "inactive".';
comment on column monday_projects.board_name is
  'Human-readable source board name for provenance.';
comment on column monday_projects.total_effort_days is
  'Total effort in person-days (numeric_mm0664sx).';
comment on column monday_projects.delivered_value is
  'Free-text summary of value delivered (text_mm09rsbe).';
comment on column monday_projects.ttv_days_text is
  'Time-to-value formula result in days (formula_mm01p18k).';
comment on column monday_projects.timeline_start is
  'Left edge of the Monday Timeline column.';
comment on column monday_projects.timeline_end is
  'Right edge of the Monday Timeline column.';
comment on column monday_projects.latest_update is
  'Most-recent Monday item update/comment body, stripped of HTML.';


-- ──────────────────────────────────────────────────────────
-- 0011_customer_workspace_id.sql
-- ──────────────────────────────────────────────────────────

-- Store Monday workspace IDs per customer so we can discover their
-- Account Overview boards dynamically during sync.
alter table customers
  add column if not exists monday_workspace_id text;

comment on column customers.monday_workspace_id is
  'Monday workspace ID for the customer-specific workspace (e.g. "8906635" for Norco). Enables automatic discovery of per-customer Account Overview boards and project tracking boards.';

-- Index for workspace-based lookups.
create index if not exists customers_monday_workspace_idx
  on customers (monday_workspace_id)
  where monday_workspace_id is not null;


-- ──────────────────────────────────────────────────────────
-- 0012_project_dates.sql
-- ──────────────────────────────────────────────────────────

-- Store go_live_date + kickoff_date as proper columns on monday_projects
-- so we can ORDER/filter them without hitting raw_columns in every query.
-- The sync now extracts them directly from column_values during each sync run.

alter table monday_projects
  add column if not exists go_live_date  date,
  add column if not exists kickoff_date  date;

create index if not exists monday_projects_go_live_idx  on monday_projects (go_live_date desc) where go_live_date is not null;
create index if not exists monday_projects_kickoff_idx  on monday_projects (kickoff_date) where kickoff_date is not null;

comment on column monday_projects.go_live_date is 'Extracted from raw_columns date_mm01dz3b (Go Live Date). Stored for efficient ORDER BY.';
comment on column monday_projects.kickoff_date is 'Extracted from raw_columns date_mm011n1f (Kickoff Date). Stored for efficient ORDER BY.';


-- ──────────────────────────────────────────────────────────
-- 0013_monday_projects_deliveryops_native.sql
-- ──────────────────────────────────────────────────────────

-- Add delivery_notes to monday_projects so users can annotate projects
-- directly in DeliveryOps without those notes being overwritten by syncs.
-- The sync never writes this column; it is purely DeliveryOps-native.
--
-- Also adds last_synced_at as an alias for synced_at (kept for audit) and
-- a removed_from_monday flag so projects deleted from Monday boards are
-- preserved in DeliveryOps history and just marked inactive rather than
-- deleted.

alter table monday_projects
  add column if not exists delivery_notes     text,
  add column if not exists removed_from_monday boolean not null default false;

comment on column monday_projects.delivery_notes is
  'Free-text notes added directly in DeliveryOps. Never written by sync; survives all re-syncs.';
comment on column monday_projects.removed_from_monday is
  'Set to true when a project is no longer found on any Monday board during sync. Preserves the record for history.';


-- ──────────────────────────────────────────────────────────
-- 0014_chat_tool_traces.sql
-- ──────────────────────────────────────────────────────────

-- Store agent tool traces alongside chat messages so you can audit
-- exactly what tools the agent called, with what inputs and outputs.
-- This is separate from the assistant text message so it doesn't
-- clutter the conversation UI but remains queryable for debugging.

alter table chat_messages
  add column if not exists tool_calls jsonb;

comment on column chat_messages.tool_calls is
  'Array of { name, input, result, duration_ms } objects for tool-use turns. Null for text-only turns.';


-- ──────────────────────────────────────────────────────────
-- 0015_auth_rls_kognitos_domain.sql
-- ──────────────────────────────────────────────────────────

-- Tighten Row-Level Security so that authenticated requests are only allowed
-- when the JWT belongs to a @kognitos.com user. Service-role calls (cron jobs
-- workers, cron jobs, the agent runner, the sync pipelines) continue to
-- bypass RLS as before — the service_role JWT is exempt by design.
--
-- Two separate gates:
--
--   1. Most customer-data tables (customers, profiles, events, rules, tasks,
--      conversations, customer_users, chat_*, pending_approvals, sf_*,
--      monday_*, k2_*, sync_runs):
--      → kognitos.com authenticated users get full read/write.
--
--   2. internal_profiles: NO authenticated-user policy. RLS denies every
--      non-service-role read. This makes the "agent has zero access to the
--      internal profile" rule from docs/VISION.md a structural fence rather
--      than a procedural one — even a misbehaving server component using the
--      anon client can't see internal notes.
--
-- Phase 3 (multi-tenant) will tighten further by joining through
-- customer_users for per-CSM scoping. For now we are single-tenant — every
-- kognitos.com user sees every customer.

-- ── Helper: SQL function the policies call ────────────────────────────────
-- Returns true when the request carries a Supabase Auth JWT whose `email`
-- claim ends in @kognitos.com. Used by every policy below so the rule lives
-- in one place and can be widened (multi-tenant) later without rewriting
-- every policy.

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(auth.jwt() ->> 'email', '')) like '%@kognitos.com',
    false
  );
$$;

comment on function public.is_internal_user() is
  'True when the calling JWT has an @kognitos.com email. Replace with a join through customer_users in Phase 3 multi-tenant work.';

-- ── Drop the old permissive policies ──────────────────────────────────────
-- These were "for all to authenticated using (true) with check (true)" — any
-- random Supabase user (including non-kognitos.com signups) could read
-- everything. Replace one by one.

drop policy if exists customers_open          on customers;
drop policy if exists profiles_open           on profiles;
drop policy if exists internal_profiles_open  on internal_profiles;
drop policy if exists events_open             on events;
drop policy if exists rules_open              on rules;
drop policy if exists tasks_open              on tasks;
drop policy if exists conversations_open      on conversations;
drop policy if exists customer_users_open     on customer_users;
drop policy if exists chat_sessions_open      on chat_sessions;
drop policy if exists chat_messages_open      on chat_messages;
drop policy if exists pending_approvals_all   on pending_approvals;

-- ── Customer-data tables: kognitos.com only ────────────────────────────────

create policy customers_kognitos
  on customers for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy profiles_kognitos
  on profiles for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy events_kognitos
  on events for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy rules_kognitos
  on rules for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy tasks_kognitos
  on tasks for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy conversations_kognitos
  on conversations for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy customer_users_kognitos
  on customer_users for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy chat_sessions_kognitos
  on chat_sessions for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy chat_messages_kognitos
  on chat_messages for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy pending_approvals_kognitos
  on pending_approvals for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- ── internal_profiles: deny all authenticated reads ───────────────────────
-- No policy is created here. RLS is enabled, so PostgREST denies every
-- authenticated/anon request. Only service-role (which bypasses RLS) can
-- read or write. This enforces the VISION.md rule structurally — even if a
-- developer accidentally introduces a `select * from internal_profiles` in a
-- server component using the anon client, the row is invisible.

-- ── Cache tables: enable RLS and apply the same gate ──────────────────────
-- These tables were created without RLS — meaning anon could in principle
-- read them via the public anon API. Lock them down to kognitos.com.

alter table sf_accounts            enable row level security;
alter table sf_opportunities       enable row level security;
alter table sf_cases               enable row level security;
alter table monday_projects        enable row level security;
alter table monday_activities      enable row level security;
alter table monday_nps_responses   enable row level security;
alter table sync_runs              enable row level security;
alter table k2_workspaces          enable row level security;
alter table k2_processes           enable row level security;
alter table k2_runs                enable row level security;

create policy sf_accounts_kognitos          on sf_accounts          for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy sf_opportunities_kognitos     on sf_opportunities     for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy sf_cases_kognitos             on sf_cases             for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy monday_projects_kognitos      on monday_projects      for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy monday_activities_kognitos    on monday_activities    for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy monday_nps_responses_kognitos on monday_nps_responses for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy sync_runs_kognitos            on sync_runs            for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy k2_workspaces_kognitos        on k2_workspaces        for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy k2_processes_kognitos         on k2_processes         for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy k2_runs_kognitos              on k2_runs              for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());

