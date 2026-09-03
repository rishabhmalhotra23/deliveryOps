-- A process row can be genuinely wrong -- a duplicate import, a mismatched
-- customer, a test row -- with no way to remove it from the UI today. Hard
-- deleting a production delivery record is unrecoverable, so this adds a
-- soft-delete pair instead: a deleted row disappears from every list/report
-- but the data survives for as long as anyone needs to undo it.
--
-- Deliberately not reusing the "archive" vocabulary already established by
-- ARCHIVE_LIFECYCLES / the Archive view (lib/supabase/types.ts) -- that is a
-- lifecycle bucket (cancelled/churned/retired/needs_triage) for work that is
-- still a real, visible record. This is "the row itself should not exist,"
-- a different concept, so it gets its own deleted_at/deleted_by pair, same
-- shape as customers/profiles/events/rules/tasks/conversations already use.

alter table processes
  add column deleted_at timestamptz,
  add column deleted_by text;

create index processes_active_idx on processes (lifecycle) where deleted_at is null;
