-- V2 migration tracker — the live source of truth for which customer processes
-- are moving from Kognitos v1 to v2. Imported from the "V2 Migration List"
-- spreadsheet (Working Sheet) and maintained in DeliveryOps going forward.
--
-- This table REPLACES the Monday-sourced v2_migration_list + the
-- MANUAL_V2_MIGRATIONS constants as the source for the weekly report
-- "Migrating to V2" tile (lib/reports/weekly-loader.ts) — rewired in a
-- follow-up PR, kept separate so this migration is data-only.
--
-- migration_stage drives the Slack notifier: when a row first enters
-- 'live_on_v2', the app posts to Slack (#deliveryops_test first, then #general).
-- went_live_at gives idempotency so we post exactly once, not on every re-save.
--
-- Links are intentionally SOFT (no FKs) so the one-time import never fails on a
-- value that doesn't resolve yet:
--   * customer_key      -> customers.key      (null until matched; account keeps the raw label)
--   * linear_ticket_ids -> linear_tickets.id  (text[]; joined in-app, no native array FK)

create type migration_stage as enum (
  'not_required',        -- stays on v1 / no migration needed
  'in_development',      -- v2 build in progress
  'engg_pending',        -- blocked on engineering
  'parity_testing',      -- v1 parity testing
  'customer_validation', -- handed to customer for validation
  'live_on_v2',          -- migrated and cut over (terminal, fires Slack)
  'v2_native'            -- built natively on v2, never a v1 process (terminal, no trigger)
);

create table migration_processes (
  id                        uuid primary key default gen_random_uuid(),

  -- identity / linkage
  account                   text not null,   -- raw "Account / Customer" from the sheet
  customer_key              text,            -- soft link to customers.key (nullable, no FK)
  process_name              text not null,

  -- classification
  process_status            text,            -- Live / In Development / To be Dropped / Churned / Retired / Discovery
  platform                  text,            -- V1 / V2 / Custom Solution
  migration_stage           migration_stage not null default 'in_development',
  is_blocked                boolean not null default false,  -- red overlay; independent of stage
  priority                  text,            -- High / Medium / Low

  -- ownership
  fde_owner                 text,
  engg_owner                text,

  -- migration progress
  date_parity_complete      date,
  date_customer_handover    date,
  date_customer_validation  date,
  go_live_date              date,
  completion_pct            numeric(4,3),    -- 0.000-1.000
  effort_required           text,            -- freeform, e.g. "3 weeks"
  went_live_at              timestamptz,     -- stamped once when stage first becomes live_on_v2 (Slack idempotency)

  -- customer-facing
  active_usage              text,            -- e.g. "1850 per month"
  customer_notified         text,            -- Yes / No / blank (kept as-is from sheet)
  customer_contact          text,

  -- detail
  blockers                  text,
  notes                     text,
  feature_delta             text,            -- "Feature Set Delta in V2"

  -- links (features 2 + 3)
  linear_ticket_ids         text[] not null default '{}',  -- soft link to linear_tickets.id
  v2_workspace_url          text,

  -- commercial context (flat for v1; may move to a customers link later)
  arr                       numeric,
  company_size              text,            -- e.g. "~$4.4B"

  -- provenance
  source_phase              text,
  source_board              text,

  -- audit
  updated_by                text,            -- who last saved (used in the Slack message)
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger migration_processes_set_updated_at before update on migration_processes
for each row execute function set_updated_at();

create index migration_processes_stage_idx on migration_processes (migration_stage);
create index migration_processes_customer_idx on migration_processes (customer_key);
create index migration_processes_platform_idx on migration_processes (platform);
create index migration_processes_blocked_idx on migration_processes (is_blocked) where is_blocked;

alter table migration_processes enable row level security;
-- No policy — service-role only, matching the Auth0 model in 0016. The browser
-- never calls Supabase directly; the app's server routes use supabaseAdmin,
-- gated by Auth0 session middleware.

comment on table migration_processes is
  'Live V2 migration tracker (one row per customer process). Source of truth for the weekly report V2 tile and the Slack status-change notifier. Imported from the V2 Migration List spreadsheet; maintained in DeliveryOps.';
