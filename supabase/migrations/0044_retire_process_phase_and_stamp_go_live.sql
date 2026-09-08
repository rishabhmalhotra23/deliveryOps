-- ALLOW_DESTRUCTIVE: drops processes.phase (38 non-null values, all but 5 a
-- 1:1 restatement of lifecycle), the process_phase enum, and the 6
-- vocabulary_values rows for it. Safe because every reader was repointed to
-- lifecycle first and tsc proved it: the exhaustive Record<ProcessPhase, ...>
-- maps made each remaining consumer a compile error. processes.phase is the
-- type's only dependency (no index, no view, no other column). Rationale and
-- the production audit are below.

-- Retires `processes.phase` and the `process_phase` enum, and gives
-- `went_live_at` its first real values.
--
-- WHY PHASE GOES
-- --------------
-- `phase` restated `lifecycle`. lib/processes/store.ts derived it on every
-- write through LIFECYCLE_TO_PHASE (backlog -> pre_kickoff, discovery ->
-- m1_discovery, in_development -> m2_development, uat -> m3_testing_uat, live
-- -> m4_deployment), so the two columns sat side by side in the Delivery table
-- saying the same thing twice. Production audit on 2026-09-08, 149 live rows:
--
--     phase IS NULL                         111   (75%)
--     phase set                              38
--       of which post-live (m4/m5)            5   the only independent signal
--       of which a restatement of lifecycle  33
--
-- And where it was stale it actively misled: 4 `retired` processes still read
-- "M1 - Discovery" and 2 `cancelled` read "M3 - Testing/UAT", because nothing
-- cleared a phase when a lifecycle moved off the happy path.
--
-- The one thing it added — deployment vs exception handling after go-live — is
-- already carried by `processes.work_mode`, which holds 'exception_handling'.
-- 62 rows are live and only 5 of them ever had a post-live phase set, so
-- nothing is lost that anyone was maintaining.
--
-- Every reader was repointed first (see the commit): the Trends chart
-- "Projects by milestone phase" became "Projects by delivery stage" reading
-- the lifecycle label, the Weekly Delivery Review chip reads `lifecycle`, and
-- lib/delivery/taxonomy.ts's legacy bridge exposes `lifecycle_label` where it
-- used to expose `phase`. The 17 exhaustive Record<ProcessPhase, ...> maps
-- were the safety net that found them — dropping the TS type surfaced every
-- consumer as a compile error, which is exactly the argument migration 0042's
-- header makes for keeping the enums.
--
-- WHY THE went_live_at BACKFILL
-- -----------------------------
-- 0019's header promised a Slack notifier: "when a row first enters
-- 'live_on_v2', the app posts to Slack ... went_live_at gives idempotency so
-- we post exactly once, not on every re-save." That code was written, then
-- moved to archive/superseded/lib-migrations/ and never redeployed, leaving
-- MIGRATION_DONE_STAGE in the types with no caller.
--
-- So NO WRITE PATH has ever stamped this column. The 11 rows that do carry a
-- value all came in through the Monday import (source_system = 'monday') —
-- they were never stamped by the app. lib/reports/delivery-review-loader.ts
-- documents the consequence as a known gap: a process that went live via a
-- plain lifecycle edit under-reports as "live" rather than "done".
--
-- stampGoLive() in lib/processes/store.ts closes that going forward. This
-- backfills the history so the column isn't 47 rows of nothing on day one.
--
-- Deliberately only touches NULLs. Three of the 11 imported values diverge
-- from go_live_date on purpose (Bradley & Beams - Engagement Letters: go-live
-- 2025-10-31, went live 2026-03-19), and overwriting those would replace a
-- recorded fact with a re-derivation.

begin;

-- 1. Backfill. `date` -> `timestamptz` at UTC midnight, matching the shape the
--    Monday import already used. Restricted to rows that actually shipped:
--    go_live_date is a target as often as a fact and is hand-edited months
--    ahead, so the <= current_date guard is the same one
--    lib/delivery/sections.ts's inHistoricalLens applies.
update processes
   set went_live_at = (go_live_date::timestamp at time zone 'UTC')
 where went_live_at is null
   and go_live_date is not null
   and go_live_date <= current_date
   and lifecycle = 'live'
   and deleted_at is null;

-- 2. The Configure -> Vocabularies rows for a vocabulary that no longer
--    exists. Seeded by 0042 with hue = null (phase was never colour-coded).
delete from vocabulary_values where vocabulary = 'process_phase';

-- 3. Narrow add_vocabulary_value()'s allow-list from seven enums to six.
--    Re-declared in full rather than patched: the allow-list is the security
--    boundary for a SECURITY DEFINER function that interpolates into
--    `alter type ... add value`, so it should be readable in one piece.
--    Body is 0042's verbatim apart from the removed 'process_phase' entry.
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
  allowed text[] := array['migration_stage','process_lifecycle',
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
  'Extends one of the six delivery enum vocabularies and records its presentation, in one call. SECURITY DEFINER with a hard allow-list because it runs ALTER TYPE. There is no inverse: Postgres cannot drop an enum value, so taking one out of circulation is vocabulary_values.active = false.';

-- 4. The column, then the type. `processes.phase` is the type's only
--    dependency — checked against production: no index mentions it, no view in
--    the public schema references it, and information_schema reports exactly
--    one column of type process_phase. ttv_days is generated from
--    kickoff_date/go_live_date only, so the generated column is untouched.
--
--    Residual "phase" keys inside processes.field_provenance are left alone:
--    that JSON is an audit trail of who edited what and when, and rewriting
--    history to hide a column that existed would be the wrong kind of tidy.
alter table processes drop column phase;
drop type process_phase;

commit;
