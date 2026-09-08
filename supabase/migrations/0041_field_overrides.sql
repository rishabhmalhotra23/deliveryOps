-- Human corrections to values this app does not own.
--
-- Some numbers on screen have no column to edit. The Salesforce sync writes
-- ONLY to the sf_* cache tables — it never touches `customers` or `profiles` —
-- so confirmed ARR, renewal date and the rest are derived at read time from
-- sf_opportunities. There is nothing to write, which is why correcting one has
-- until now meant editing TypeScript and deploying:
-- CONFIRMED_ARR_OVERRIDES in lib/commercials/confirmed-arr.ts is a hardcoded
-- map, and it holds exactly one entry (Norco, whose SF figure is pre-
-- renegotiation).
--
-- This table is that map promoted out of source code and given provenance, so
-- a correction is a thing somebody does in the product rather than a code
-- change and a deploy.
--
-- Deliberately NOT a write-back to Salesforce. An override is local truth:
-- "for our purposes this number is wrong, and here is the right one." SF stays
-- the system of record for its own data, and `synced_value` keeps what it said
-- at the moment of the override so the UI can show both and a wrong
-- correction stays findable instead of silently permanent.
--
-- Deliberately NOT a way to edit the sf_* cache. The next sync would flatten
-- it, which is worse than not offering the edit.

create table if not exists field_overrides (
  id            uuid primary key default gen_random_uuid(),
  -- Which record the field belongs to. Text rather than an enum: the whole
  -- point of this table is that extending it must not need a migration, and
  -- a new entity kind is exactly the sort of thing that would.
  entity_type   text not null check (entity_type in ('customer', 'process', 'profile')),
  entity_id     uuid not null,
  field         text not null,
  -- jsonb so one table serves numbers, dates, strings and enums without a
  -- column per type or a stringly-typed value everyone has to re-parse.
  value         jsonb not null,
  -- What the source said when the override was set. Shown next to the
  -- override ("Salesforce still says $689,000") and the thing that makes a
  -- stale correction detectable later.
  synced_value  jsonb,
  -- Free text, optional, and the most valuable column here: in six months
  -- this is the only record of WHY a number disagrees with Salesforce.
  reason        text,
  set_by        text not null,
  set_at        timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One live override per field. Re-correcting a value updates the row rather
-- than stacking a second one, so there is never a question of which wins.
create unique index if not exists field_overrides_unique_idx
  on field_overrides (entity_type, entity_id, field);

-- The read path is "every override for this entity kind", loaded once per
-- request and applied in memory — there are a handful of these, not a
-- per-row lookup.
create index if not exists field_overrides_entity_idx
  on field_overrides (entity_type, field);

create trigger field_overrides_set_updated_at before update on field_overrides
for each row execute function set_updated_at();

comment on table field_overrides is
  'Human corrections to values DeliveryOps does not own, principally Salesforce-derived numbers that are computed at read time and so have no column to edit. Replaces the hardcoded CONFIRMED_ARR_OVERRIDES map. Never written back to Salesforce; synced_value records what the source said so both can be shown.';
comment on column field_overrides.synced_value is
  'What the upstream source reported when this override was set. Kept so the UI can show "Salesforce still says X" and so a correction that has since become wrong is findable.';
comment on column field_overrides.reason is
  'Why the synced value was wrong. Optional, but it is the only durable record of the judgement behind the correction.';

-- Migrate the one hardcoded entry, carrying its source comment across as the
-- reason so the explanation survives the move.
insert into field_overrides (entity_type, entity_id, field, value, synced_value, reason, set_by, set_at)
select 'customer', c.id, 'confirmed_arr', to_jsonb(311000), to_jsonb(689000),
       'Renegotiated — the most recent past Closed-Won SF opp is the pre-renegotiation figure. Migrated from CONFIRMED_ARR_OVERRIDES, originally set 2026-08-06.',
       'migration:0041', '2026-08-06T00:00:00Z'
from customers c
where c.key = 'norco'
on conflict (entity_type, entity_id, field) do nothing;
