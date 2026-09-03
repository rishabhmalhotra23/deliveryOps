-- processes.notes / processes.blockers are single free-text fields that get
-- overwritten on every edit -- there is no way to see what was said before
-- the last edit. field_provenance (0025-style, per-field) only tracks the
-- *last* editor per field, not a timeline either. This adds a real
-- append-only feed: who said what, when, one row per note.
--
-- A dedicated table, not an extension of `events` -- events.customer_id is
-- not null, while processes.customer_id is nullable (several processes were
-- never matched to a customer at import), so reusing `events` would force
-- either mis-attributing a note to the wrong customer or loosening a
-- constraint every existing events reader assumes holds.

create type process_note_kind as enum ('note', 'blocker', 'system');

create table process_notes (
  id          uuid primary key default gen_random_uuid(),
  process_id  uuid not null references processes(id) on delete cascade,
  kind        process_note_kind not null default 'note',
  body        text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger process_notes_set_updated_at before update on process_notes
for each row execute function set_updated_at();

create index process_notes_process_idx on process_notes (process_id, created_at desc)
  where deleted_at is null;

alter table process_notes enable row level security;

-- Backfill: one row per existing non-empty notes/blockers value, so the feed
-- isn't empty for every process that already had something written in the
-- old single-value fields. created_at/created_by use the best timestamp we
-- actually have (updated_at/updated_by) -- an approximation, not real
-- history, since none was ever kept for these two columns.
insert into process_notes (process_id, kind, body, created_by, created_at)
select id, 'note', notes, coalesce(updated_by, 'import'), updated_at
from processes
where notes is not null and btrim(notes) <> '';

insert into process_notes (process_id, kind, body, created_by, created_at)
select id, 'blocker', blockers, coalesce(updated_by, 'import'), updated_at
from processes
where blockers is not null and btrim(blockers) <> '';
