-- The last values that needed a deploy to change.
--
-- Two groups were left hardcoded after the 2026-09-08 configurability pass:
--
--   The value-delivered model — VAL_TIER_HOURS (low/medium/high hours saved
--   per year) and the $30/$35/$45 loaded rates in lib/analytics/loader.ts.
--   Every "value delivered by domain" number on Dashboard -> Trends derives
--   from these six figures, so tuning the model meant a code change and a
--   deploy to a chart the team presents.
--
--   The NPS email templates — invite and reminder subject/body, the from
--   address, and the reminder cadence, in lib/nps/constants.ts. Its own
--   comment called them "trivial to promote to columns later"; this is later.
--
-- One key-value table rather than a column per setting: these are unrelated
-- scalars read by one caller each, and a column apiece would mean a migration
-- for every new one — which is the problem being solved.
--
-- jsonb so a setting can be a number, a string, or the small object the value
-- model wants, without a type column or stringly-typed parsing at each
-- reader.

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  -- Shown next to the field in Configure. These are model assumptions, and a
  -- number like "$35/hr loaded rate" is meaningless to the next person
  -- without it.
  description text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

drop trigger if exists app_settings_set_updated_at on app_settings;
create trigger app_settings_set_updated_at before update on app_settings
for each row execute function set_updated_at();

comment on table app_settings is
  'Tunable scalars that used to be TypeScript constants: the value-delivered model and the NPS email templates. Read through lib/settings/store.ts, which falls back to the compiled default when a key is absent — so a missing row degrades to today''s behaviour rather than a zero.';

-- Seeded with exactly the values the constants hold, so nothing changes on
-- deploy. Every reader falls back to its compiled default anyway; these rows
-- exist so the settings are visible and editable, not so they are load-bearing.
insert into app_settings (key, value, description, updated_by) values
  ('value_model.tier_hours',
   '{"low": 1200, "medium": 2600, "high": 5200}'::jsonb,
   'Hours saved per year by process complexity. Drives every "value delivered" figure on Dashboard → Trends.',
   'migration:0043'),
  ('value_model.rates',
   '{"low": 30, "mid": 35, "high": 45}'::jsonb,
   'Loaded hourly cost in USD by band, used to convert saved hours into value.',
   'migration:0043'),
  ('value_model.hours_per_fte',
   '2080'::jsonb,
   'Working hours per FTE per year, for expressing saved hours as headcount.',
   'migration:0043'),
  ('nps.from_address',
   '"ai.cx@kognitos.com"'::jsonb,
   'From address on NPS invites and reminders.',
   'migration:0043'),
  ('nps.max_auto_reminders',
   '3'::jsonb,
   'How many automatic reminders a recipient gets before the campaign stops chasing them. Manual reminders are never capped.',
   'migration:0043'),
  ('nps.reminder_interval_days',
   '7'::jsonb,
   'Days between automatic NPS reminders.',
   'migration:0043')
on conflict (key) do nothing;
