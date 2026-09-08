-- Adding a value to a delivery vocabulary should not require a deploy.
--
-- The seven vocabularies below are Postgres enums, which is right: they are
-- the fields every section-routing rule, report and staleness signal keys on,
-- and an enum is what stops a typo becoming a new lifecycle. But it made
-- EXTENDING one a schema migration — adding `to_be_retired` on 2026-09-04
-- needed a migration plus edits to three label maps and a hue map.
--
-- Deliberately NOT converting the columns to text. The 17 exhaustive
-- `Record<MigrationStage, ...>` maps in the codebase are a real safety net:
-- they are what forced `to_be_retired` to be given a label, a short label and
-- a colour, and TypeScript would have failed the build if any had been
-- missed. Dropping the enums trades "adding a value needs a migration" for
-- "adding a value silently renders as a blank grey chip", which is worse.
--
-- So the enum stays and the PRESENTATION moves here: label, short label,
-- colour and order become data. Adding a value is then one product operation
-- (see add_vocabulary_value below) instead of a migration and four map edits.
--
-- This table is also where chip colours now live. They were in localStorage
-- (`dops.viewPrefs`), so Configure -> Colours was per-browser: two people
-- looking at the same board saw different colours, and a new laptop lost the
-- scheme. Colour is a property of the value, not of the viewer.

create table if not exists vocabulary_values (
  id           uuid primary key default gen_random_uuid(),
  -- The Postgres enum type this value belongs to, e.g. 'migration_stage'.
  vocabulary   text not null,
  -- The enum label itself. Must exist in the enum type; add_vocabulary_value
  -- keeps the two in step.
  value        text not null,
  label        text not null,
  -- Board cards are 268px wide and "Migrated, pending commercial" wraps to
  -- three lines there. Null falls back to `label`.
  short_label  text,
  -- One of the 8 --st-* hues in app/globals.css. Null falls back to neutral,
  -- which is why an unstyled new value is drab rather than broken.
  hue          text,
  sort_order   int not null default 0,
  -- Retire a value without deleting it: rows already carrying it keep
  -- rendering, but it stops being offered in pickers. The enum label can
  -- never be removed (Postgres has no DROP VALUE), so this is the only
  -- honest way to take one out of circulation.
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists vocabulary_values_unique_idx
  on vocabulary_values (vocabulary, value);
create index if not exists vocabulary_values_lookup_idx
  on vocabulary_values (vocabulary, sort_order);

drop trigger if exists vocabulary_values_set_updated_at on vocabulary_values;
create trigger vocabulary_values_set_updated_at before update on vocabulary_values
for each row execute function set_updated_at();

comment on table vocabulary_values is
  'Presentation for the delivery enum vocabularies: label, short label, colour and order, as data rather than as TypeScript maps. The enum types remain the integrity constraint; this makes extending and restyling them a product operation. Also replaces the localStorage colour map, which made Configure -> Colours per-browser.';

-- ── Seed from the enums and the maps that currently hold the presentation ──
-- Values come from pg_enum so this can't drift from the actual types;
-- labels/hues mirror lib/delivery/labels.ts and lib/delivery/hues.ts as of
-- 2026-09-08.
insert into vocabulary_values (vocabulary, value, label, short_label, hue, sort_order)
select t.typname, e.enumlabel, e.enumlabel, null, null, (e.enumsortorder * 10)::int
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
where t.typname in ('migration_stage','process_lifecycle','process_phase',
                    'process_health','process_blocked_on','process_work_mode','process_platform')
on conflict (vocabulary, value) do nothing;

-- Real labels and hues over the placeholder seed above.
update vocabulary_values v set label = m.label, short_label = m.short_label, hue = m.hue
from (values
  ('migration_stage','not_required','Not required','Not required','neutral'),
  ('migration_stage','in_development','In development','In development','indigo'),
  ('migration_stage','engg_pending','Engg pending','Engg pending','orange'),
  ('migration_stage','parity_testing','Parity testing','Parity testing','blue'),
  ('migration_stage','customer_validation','Customer validation','Cust. validation','amber'),
  ('migration_stage','live_on_v2','Live on v2','Live on V2','emerald'),
  ('migration_stage','v2_native','V2 native','V2 native','emerald'),
  ('migration_stage','migrated_pending_commercial','Migrated, pending commercial','Migrated · commercial','fuchsia'),
  ('migration_stage','to_be_retired','To be retired','To be retired','red'),
  ('process_lifecycle','backlog','Backlog',null,'neutral'),
  ('process_lifecycle','upcoming','Upcoming',null,'blue'),
  ('process_lifecycle','discovery','Discovery',null,'indigo'),
  ('process_lifecycle','in_development','In development',null,'fuchsia'),
  ('process_lifecycle','uat','UAT',null,'amber'),
  ('process_lifecycle','live','Live',null,'emerald'),
  ('process_lifecycle','on_hold','On hold',null,'orange'),
  ('process_lifecycle','needs_triage','Needs triage',null,'red'),
  ('process_lifecycle','cancelled','Cancelled',null,'neutral'),
  ('process_lifecycle','churned','Churned',null,'red'),
  ('process_lifecycle','retired','Retired',null,'neutral'),
  ('process_health','on_track','On track',null,'emerald'),
  ('process_health','at_risk','At risk',null,'amber'),
  ('process_health','off_track','Off track',null,'red'),
  ('process_phase','pre_kickoff','Pre-kickoff',null,null),
  ('process_phase','m1_discovery','M1 · Discovery',null,null),
  ('process_phase','m2_development','M2 · Development',null,null),
  ('process_phase','m3_testing_uat','M3 · Testing / UAT',null,null),
  ('process_phase','m4_deployment','M4 · Deployment',null,null),
  ('process_phase','m5_exception_handling','M5 · Exception handling',null,null),
  ('process_blocked_on','none','Nothing',null,null),
  ('process_blocked_on','customer','Customer',null,null),
  ('process_blocked_on','kognitos_engg','Kognitos engineering',null,null),
  ('process_blocked_on','kognitos_delivery','Kognitos delivery',null,null),
  ('process_blocked_on','partner','Partner',null,null),
  ('process_work_mode','steady_state','Steady state',null,null),
  ('process_work_mode','exception_handling','Exception handling',null,null),
  ('process_work_mode','enhancement','Enhancement',null,null),
  ('process_work_mode','support','Support',null,null),
  ('process_platform','v1','V1',null,null),
  ('process_platform','v2','V2',null,null),
  ('process_platform','custom','Custom',null,null)
) as m(vocabulary, value, label, short_label, hue)
where v.vocabulary = m.vocabulary and v.value = m.value;

-- ── Adding a value, as one operation ─────────────────────────────────────
-- ALTER TYPE ... ADD VALUE is additive and does not rewrite the table, but it
-- is DDL, so it lives behind a SECURITY DEFINER function with a hard
-- allow-list rather than the app holding DDL rights on the schema.
--
-- Note there is no matching remove: Postgres has no DROP VALUE, and even if
-- it did, rows could already carry it. Retiring a value is
-- `active = false`, which this function's companion UI offers instead.
create or replace function add_vocabulary_value(
  p_vocabulary text,
  p_value      text,
  p_label      text,
  p_short_label text default null,
  p_hue        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array['migration_stage','process_lifecycle','process_phase',
                          'process_health','process_blocked_on','process_work_mode',
                          'process_platform'];
  next_order int;
begin
  if not (p_vocabulary = any(allowed)) then
    raise exception 'Vocabulary % cannot be extended here. Allowed: %',
      p_vocabulary, array_to_string(allowed, ', ');
  end if;

  -- The value reaches ALTER TYPE, so it is constrained to the shape every
  -- existing label already has rather than quoted and hoped for.
  if p_value !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'Value must be lower_snake_case, 1-41 chars, starting with a letter. Got: %', p_value;
  end if;
  if coalesce(btrim(p_label), '') = '' then
    raise exception 'A label is required.';
  end if;
  if p_hue is not null and not (p_hue = any(array['neutral','indigo','blue','emerald','amber','orange','red','fuchsia'])) then
    raise exception 'Unknown hue: %', p_hue;
  end if;

  -- Idempotent: adding a value that already exists updates its presentation
  -- rather than failing, which is what a retry after a partial failure wants.
  execute format('alter type %I add value if not exists %L', p_vocabulary, p_value);

  select coalesce(max(sort_order), 0) + 10 into next_order
  from vocabulary_values where vocabulary = p_vocabulary;

  insert into vocabulary_values (vocabulary, value, label, short_label, hue, sort_order)
  values (p_vocabulary, p_value, btrim(p_label), nullif(btrim(coalesce(p_short_label,'')), ''), p_hue, next_order)
  on conflict (vocabulary, value) do update
    set label = excluded.label,
        short_label = excluded.short_label,
        hue = excluded.hue,
        active = true;
end;
$$;

comment on function add_vocabulary_value(text, text, text, text, text) is
  'Extends one of the seven delivery enum vocabularies and records its presentation, in one call. SECURITY DEFINER with a hard allow-list because it runs ALTER TYPE. There is no inverse: Postgres cannot drop an enum value, so taking one out of circulation is vocabulary_values.active = false.';
