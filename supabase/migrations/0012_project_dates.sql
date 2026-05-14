-- Store go_live_date + kickoff_date as proper columns on monday_projects
-- so we can ORDER/filter them without hitting raw_columns in every query.
-- The sync now extracts them directly from column_values during each sync run.

alter table monday_projects
  add column if not exists go_live_date  date,
  add column if not exists kickoff_date  date;

create index if not exists monday_projects_go_live_idx  on monday_projects (go_live_date desc) where go_live_date is not null;
create index if not exists monday_projects_kickoff_idx  on monday_projects (kickoff_date) where kickoff_date is not null;

comment on column monday_projects.go_live_date is 'Extracted from raw_columns date_mm01dz3b (Go Live Date). Stored for efficient ORDER BY.';
comment on column monday_projects.kickoff_date is 'Extracted from raw_columns date_mm011n1f (Kickoff Date). Stored for efficient ORDER BY.';
