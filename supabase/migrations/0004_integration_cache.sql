-- Phase 2 Pass C — integration cache tables.
--
-- Strategy: store the raw external data as JSONB plus a small set of
-- frequently-queried columns lifted out for indexes. The dashboard reads
-- from these tables; sync-{salesforce,monday,kognitos-v2} Inngest functions
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
