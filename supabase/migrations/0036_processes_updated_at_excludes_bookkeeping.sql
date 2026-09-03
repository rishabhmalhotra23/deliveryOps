-- `updated_at` on processes should mean "when did the record's content last
-- change", because that is exactly what the UI and the weekly review read it
-- as: the "Last touched" column, its amber/red staleness colouring, the
-- stalest-first lane ordering, and delivery-review's staleness signals.
--
-- Two writes are bookkeeping, not content, and were resetting it to 0d:
--
--   board_position (0035) — dragging a card to reorder a lane is a view
--     preference. It made "Last touched" resettable by a mouse gesture, and
--     since unpositioned cards fall back to updated_at ordering, reordering
--     one card reshuffled the others underneath it.
--   reviewed_at/reviewed_by — markReviewed() is documented in
--     lib/processes/store.ts as explicitly "not an edit" (it deliberately
--     skips field_provenance), but the trigger bumped updated_at anyway, so
--     confirming a row was still accurate made it look freshly worked on.
--
-- Implemented as a processes-only trigger function. set_updated_at() is
-- shared by a dozen other tables (0001) and must not learn about columns
-- that only exist here.

create or replace function processes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Compare the row with the bookkeeping columns normalised away. If nothing
  -- else differs, this write is bookkeeping and the timestamp is preserved.
  --
  -- ttv_days has to come out too: it's a GENERATED column, and in a BEFORE
  -- trigger new.ttv_days is still NULL while old holds the stored value, so
  -- leaving it in made every row with a computed TTV compare unequal and the
  -- guard never fired.
  --
  -- updated_by and field_provenance come out because updateProcess() rewrites
  -- both on every call, including a position-only one. A genuine field edit is
  -- still detected by the field itself changing, so nothing is missed.
  if (
    to_jsonb(new) - 'updated_at' - 'ttv_days' - 'updated_by' - 'field_provenance'
      - 'board_position' - 'reviewed_at' - 'reviewed_by'
  ) = (
    to_jsonb(old) - 'updated_at' - 'ttv_days' - 'updated_by' - 'field_provenance'
      - 'board_position' - 'reviewed_at' - 'reviewed_by'
  ) then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

comment on function processes_set_updated_at() is
  'Maintains processes.updated_at as a content-change timestamp: a write that only touches board_position (lane order) or reviewed_at/reviewed_by (mark reviewed) preserves the previous value, so "Last touched" and every staleness signal built on it stay honest.';

drop trigger if exists processes_set_updated_at on processes;

create trigger processes_set_updated_at before update on processes
for each row execute function processes_set_updated_at();
