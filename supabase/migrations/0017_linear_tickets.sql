-- Linear ticket tracker for the V2 migration report — replaces the manual
-- "pull counts from Linear and paste into lib/reports" workflow with a
-- synced table plus a lightweight, human-curated judgment layer on top.
--
-- Two concerns kept deliberately separate:
--   1. Raw Linear fields (title, status, priority, dates) — kept fresh by
--      lib/sync/linear-tickets.ts, wired into the existing daily cron
--      (see app/api/cron/daily-sync/route.ts) plus a manual refresh button.
--      The sync UPSERTs these columns only and never touches classification.
--   2. classification / confidence / rationale / domain / in_scope — a
--      judgment layer filled in by a periodic Claude-assisted review, not
--      computed automatically. New tickets land with these null ("not yet
--      classified") until that pass touches them. manual_override lets a
--      human edit stick even if a future pass would have said otherwise.
--
-- in_scope exists because the sync casts a wide net (any ticket carrying
-- one of a fixed set of labels, or belonging to one of a fixed set of
-- teams) and that net catches a lot of general engineering-roadmap work
-- with no customer/migration signal. Rather than filtering that out at
-- query time — which would require the same judgment the classification
-- pass already does — everything lands in the table and the judgment pass
-- flips in_scope to false for the noise. The UI defaults to in_scope = true.

create type ticket_classification as enum (
  'hard_blocker',
  'workaround_exists',
  'transient_retry',
  'just_a_bug'
);

create type ticket_confidence as enum ('certain', 'likely', 'guessing');

create type ticket_domain as enum (
  'idp_document_processing',
  'browser_automation',
  'integrations_connectors',
  'drafts_quill_ux',
  'live_automations_runtime',
  'platform_infra',
  'other'
);

create type ask_priority_tier as enum ('now', 'soon', 'later');
create type ask_status as enum ('open', 'in_progress', 'done');

-- ── linear_tickets ────────────────────────────────────────────────────────────

create table linear_tickets (
  id                    text primary key, -- Linear identifier, e.g. "KOG-11842"
  title                 text not null,
  url                   text not null,
  team                  text,
  project               text,
  source                text not null, -- which label/team query surfaced it, e.g. "v2 Migration Blockers"
  priority              text,          -- Linear priority label: Urgent/High/Medium/Low/No priority
  linear_status         text not null, -- Linear workflow state name, e.g. "In Review"
  status_type           text not null, -- Linear state type: triage/backlog/unstarted/started/completed/canceled
  linear_created_at     timestamptz not null,
  closed_at             timestamptz,   -- stamped by the sync job the first time it observes this ticket closed
  in_scope              boolean not null default true,

  classification        ticket_classification,
  confidence             ticket_confidence,
  rationale              text,
  domain                 ticket_domain,
  classified_at          timestamptz,
  manual_override        boolean not null default false,

  last_synced_at         timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger linear_tickets_set_updated_at before update on linear_tickets
for each row execute function set_updated_at();

create index linear_tickets_open_idx
  on linear_tickets (status_type, in_scope) where closed_at is null;
create index linear_tickets_classification_idx on linear_tickets (classification, domain);
create index linear_tickets_created_idx on linear_tickets (linear_created_at desc);
create index linear_tickets_closed_idx on linear_tickets (closed_at desc) where closed_at is not null;

alter table linear_tickets enable row level security;
-- No policy — service-role only, matching the Auth0 model in 0016.
-- The browser never calls Supabase directly; the app's server routes use
-- supabaseAdmin, gated by Auth0 session middleware.

comment on table linear_tickets is
  'Synced snapshot of Linear tickets relevant to the V2 migration (raw fields) plus a periodic human/Claude classification layer (judgment fields). See lib/sync/linear-tickets.ts.';

-- ── team_asks ─────────────────────────────────────────────────────────────────

create table team_asks (
  id            uuid primary key default gen_random_uuid(),
  ask_text      text not null,
  requester     text not null,
  priority_tier ask_priority_tier not null default 'soon',
  status        ask_status not null default 'open',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger team_asks_set_updated_at before update on team_asks
for each row execute function set_updated_at();

create index team_asks_status_idx on team_asks (status, priority_tier, created_at desc);

alter table team_asks enable row level security;

comment on table team_asks is
  'Team-maintained log of what we need right now, independent of Linear. Never written back to Linear — a human updates the underlying ticket themselves.';

-- ── team_ask_tickets (join) ───────────────────────────────────────────────────

create table team_ask_tickets (
  ask_id     uuid not null references team_asks(id) on delete cascade,
  ticket_id  text not null references linear_tickets(id) on delete cascade,
  primary key (ask_id, ticket_id)
);

alter table team_ask_tickets enable row level security;

comment on table team_ask_tickets is
  'Many-to-many link between team_asks and linear_tickets — one ask can cover several tickets, one ticket can have several asks against it over time.';
