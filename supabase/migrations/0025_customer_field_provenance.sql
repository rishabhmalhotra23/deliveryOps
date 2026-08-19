-- Per-field edit provenance for customers/profiles/internal_profiles, mirroring
-- the pattern already live on processes.field_provenance (0021). Lets the UI
-- show "who confirmed this field, and when" and compute staleness per field
-- instead of relying on a single whole-row updated_at.

alter table customers add column if not exists field_provenance jsonb not null default '{}'::jsonb;
alter table profiles add column if not exists field_provenance jsonb not null default '{}'::jsonb;
alter table internal_profiles add column if not exists field_provenance jsonb not null default '{}'::jsonb;
