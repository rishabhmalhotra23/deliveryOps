-- Two additions from the 2026-09-04 Delivery review
-- (mockups: docs/mockups/2026-09-04-delivery-three-sections.html and
--  docs/mockups/2026-09-04-two-section-delivery-and-customers.html).
--
-- 1. migration_stage gains 'to_be_retired'.
--    Delivery's sections are now derived purely from lifecycle +
--    migration_stage, so V2 migration is "everything not yet V2-native,
--    pending a migrate-or-retire call". `not_required` already covered
--    "migration was never needed"; this covers the different, deliberate
--    decision "we have looked at this and it will be killed rather than
--    migrated". Distinct from lifecycle 'retired', which means the killing
--    already happened.
--
-- 2. customers gains `active`.
--    Churned customers still appeared in every customer dropdown, because
--    the option list only filtered `deleted_at`. Deliberately a new boolean
--    rather than reusing custom_category = 'Churned': that column is a
--    reporting bucket (At Risk / Upcoming Renewals / Strategic Growth /
--    Partner Managed / POV), and overloading it as a selectability flag would
--    make "active customer who is also At Risk" inexpressible. Same shape and
--    same semantics as roster_entries.active (0032): an inactive customer
--    keeps every process already assigned to them and keeps their
--    customer-360 page, they just cannot be picked for new work.

-- ── 1. to_be_retired ──────────────────────────────────────────────────────
-- Additive, and `if not exists`, so this is safe to re-run. Postgres cannot
-- add an enum value inside a transaction block that later uses it, but this
-- migration never reads the new value, so a plain ALTER TYPE is fine here
-- (same pattern as 0023).
alter type migration_stage add value if not exists 'to_be_retired';

-- ── 2. customers.active ───────────────────────────────────────────────────
alter table customers
  add column if not exists active boolean not null default true;

comment on column customers.active is
  'False = no longer a live customer; hidden from every customer picker but keeps its processes and its customer-360 page. Separate from custom_category, which is a reporting bucket and must stay orthogonal to selectability.';

create index if not exists customers_active_idx
  on customers (active) where deleted_at is null and active;

-- Backfill: the 13 already categorised Churned. "To Drop" (Bradley & Beams,
-- Halemeyer) deliberately stays active per the 2026-09-04 decision — both
-- still have live V1 processes and the drop isn't decided yet.
update customers
set active = false
where deleted_at is null
  and custom_category = 'Churned';
