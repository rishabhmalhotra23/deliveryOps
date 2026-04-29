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
