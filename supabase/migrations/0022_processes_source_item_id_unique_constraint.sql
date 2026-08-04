-- 0022 — fix processes.source_item_id for upsert compatibility.
--
-- 0021 created processes_source_item_idx as a PARTIAL unique index
-- (`where source_item_id is not null`), reasoning that only imported rows
-- need the uniqueness guarantee. That reasoning was right but the
-- implementation breaks upsert: Postgres will not infer an ON CONFLICT
-- target from a partial index unless the statement also restates the exact
-- same WHERE predicate, which supabase-js's `.upsert(rows, { onConflict })`
-- has no way to express. Every upsert against `processes` failed with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — caught when scripts/import-monday-backup.ts ran --apply
-- against production for the first time.
--
-- Fix: a plain (non-partial) unique constraint instead. This preserves the
-- original intent — standard SQL/Postgres uniqueness treats every NULL as
-- distinct from every other NULL, so rows with no Monday origin (hand-created
-- processes, source_item_id null) can still repeat freely. Safe against the
-- 75 existing seeded rows, which all have source_item_id null.

drop index if exists processes_source_item_idx;

alter table processes
  add constraint processes_source_item_id_key unique (source_item_id);
