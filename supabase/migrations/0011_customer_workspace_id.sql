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
