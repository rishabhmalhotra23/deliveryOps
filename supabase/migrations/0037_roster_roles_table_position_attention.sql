-- Three fixes from the 2026-09-04 Delivery tab review
-- (mockup: docs/mockups/2026-09-04-delivery-feedback.html).
--
-- 1. Backfill roster_entries.roles.
--    0033 created 27 roster rows and never wrote `roles`, leaving every one
--    of them at the '{}' default. The FDE and TAM pickers filter with
--    `roles @> {'fde'}` / `{'tam'}`, so both matched zero rows and were
--    permanently, silently empty — no amount of typing produced a hit. The
--    role a person actually holds is already recorded, in the process rows
--    that point at them, so this derives it from usage rather than guessing
--    from names. The app side stops relying on the filter being complete
--    (the picker now sorts by role instead of filtering on it), so a row
--    this misses degrades to "listed under Everyone else", not "invisible".
--
-- 2. Add processes.table_position for hand-ordering table rows.
--    Deliberately NOT reusing board_position: that column is numbered per
--    lane (every lane starts at 1000 and steps by 1000), so the same value
--    repeats across lanes and ordering a flat list by it interleaves lanes
--    meaninglessly. Two independent orders need two columns.
--
-- 3. Clear needs_attention on rows a human has already edited.
--    The flag was Monday-import triage. It is excluded from EDITABLE_FIELDS
--    in lib/processes/store.ts, so nothing in the UI could ever clear it and
--    22 rows carried a permanent amber banner — 12 of them on rows somebody
--    had already gone in and edited. Those 12 are cleared here; the app now
--    clears the rest on the next edit or on an explicit dismiss.

-- ── 1. roles, derived from how each entry is actually referenced ───────────

update roster_entries r set roles = sub.roles
from (
  select id, array_agg(distinct role order by role) as roles
  from (
    select fde_owner_id  as id, 'fde'  as role from processes where fde_owner_id  is not null
    union all
    select tam_owner_id,        'tam'        from processes where tam_owner_id   is not null
    union all
    select engg_owner_id,       'engg'       from processes where engg_owner_id  is not null
  ) usage
  group by id
) sub
where r.id = sub.id
  -- Only fill in the blanks. A role somebody set by hand in the roster UI
  -- outranks anything inferred from usage, so this must never overwrite a
  -- non-empty array.
  and r.roles = '{}';

-- ── 2. table_position ─────────────────────────────────────────────────────

alter table processes
  add column if not exists table_position double precision;

comment on column processes.table_position is
  'Manual row order in the Delivery table, independent of board_position (which is numbered per board lane and so cannot express a flat order). Lower sorts first; NULL (never dragged) sorts last. Fractional midpoints keep a drag to a single-row write. Only honoured when no column sort is active.';

create index if not exists processes_table_position_idx
  on processes (table_position)
  where deleted_at is null and table_position is not null;

-- Reordering rows is a view preference, not a content change, so it must not
-- reset "Last touched" — the same reasoning as board_position in 0036. This
-- re-declares that function with table_position added to both sides of the
-- comparison; everything else is verbatim from 0036.
create or replace function processes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (
    to_jsonb(new) - 'updated_at' - 'ttv_days' - 'updated_by' - 'field_provenance'
      - 'board_position' - 'table_position' - 'reviewed_at' - 'reviewed_by'
  ) = (
    to_jsonb(old) - 'updated_at' - 'ttv_days' - 'updated_by' - 'field_provenance'
      - 'board_position' - 'table_position' - 'reviewed_at' - 'reviewed_by'
  ) then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

comment on function processes_set_updated_at() is
  'Maintains processes.updated_at as a content-change timestamp: a write that only touches board_position / table_position (manual ordering) or reviewed_at/reviewed_by (mark reviewed) preserves the previous value, so "Last touched" and every staleness signal built on it stay honest.';

-- ── 3. retire the flag on rows already worked ─────────────────────────────

update processes
set needs_attention = false,
    needs_attention_reason = null
where needs_attention
  and deleted_at is null
  and (field_provenance <> '{}'::jsonb or reviewed_at is not null);
