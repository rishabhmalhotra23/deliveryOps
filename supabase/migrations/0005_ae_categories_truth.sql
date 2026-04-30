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
