-- Manual card order within a board lane.
--
-- Dragging a card inside its own lane had nowhere to record the result: lane
-- membership is derived (lifecycle + blocked_on for Active work,
-- migration_stage for V2), so a same-lane drop either did nothing or — worse,
-- before this — rewrote lifecycle just to force a re-render, silently
-- downgrading e.g. `upcoming` to `backlog`.
--
-- Deliberately a float, not an int: reordering then only ever writes the ONE
-- card that moved, using the midpoint of its new neighbours
-- ((prev + next) / 2). An integer sequence would have to renumber every card
-- below the insertion point, which is a fan-out of writes per drag and races
-- badly when two people reorder the same lane.
--
-- Nullable on purpose. NULL means "never manually placed" and sorts after
-- positioned cards, so existing rows keep their current stalest-first order
-- until someone actually drags them. No backfill needed.

alter table processes
  add column if not exists board_position double precision;

comment on column processes.board_position is
  'Manual order within a board lane. Lower sorts first; NULL (never dragged) sorts last, falling back to updated_at. Fractional midpoints keep a drag to a single-row write.';

-- Lane membership is derived rather than stored, so this can''t be a
-- per-lane partial index; ordering is applied per lane in memory over the
-- already-loaded page. The index just keeps the common "positioned rows
-- first" read cheap.
create index if not exists processes_board_position_idx
  on processes (board_position)
  where deleted_at is null and board_position is not null;
