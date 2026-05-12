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
