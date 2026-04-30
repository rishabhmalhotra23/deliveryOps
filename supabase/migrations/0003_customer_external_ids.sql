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
