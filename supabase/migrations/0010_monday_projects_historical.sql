-- Extend monday_projects with historical data support + richer columns.
--
-- We now sync 6 boards instead of 1:
--   18395281570  Projects (active, in-flight)
--   18398797267  FY-2026 Deliverables
--   18398797224  FY-2025 Deliverables
--   18398797248  FY-2024 Deliverables
--   18398797257  FY-2023 Deliverables
--   18398797301  Inactive / Cancelled projects
--
-- New columns extracted from raw_columns on each sync:
--   total_effort_days  — "Total Effort" numbers column (numeric_mm0664sx)
--   delivered_value    — "Delivered Value" text column (text_mm09rsbe)
--   ttv_days_text      — "TTV (Days)" formula column (formula_mm01p18k)
--   timeline_start     — left edge of the Timeline timeline column
--   timeline_end       — right edge of the Timeline timeline column
--   latest_update      — most-recent Monday item update body (fetched separately)
--   fiscal_year        — "FY-2025" / "FY-2026" / "active" / "inactive"
--   board_name         — board display name for provenance

alter table monday_projects
  add column if not exists total_effort_days   integer,
  add column if not exists delivered_value     text,
  add column if not exists ttv_days_text       text,
  add column if not exists timeline_start      date,
  add column if not exists timeline_end        date,
  add column if not exists latest_update       text,
  add column if not exists fiscal_year         text,
  add column if not exists board_name          text;

comment on column monday_projects.fiscal_year is
  'Source board fiscal year: "FY-2026", "FY-2025", "FY-2024", "FY-2023", "active", "inactive".';
comment on column monday_projects.board_name is
  'Human-readable source board name for provenance.';
comment on column monday_projects.total_effort_days is
  'Total effort in person-days (numeric_mm0664sx).';
comment on column monday_projects.delivered_value is
  'Free-text summary of value delivered (text_mm09rsbe).';
comment on column monday_projects.ttv_days_text is
  'Time-to-value formula result in days (formula_mm01p18k).';
comment on column monday_projects.timeline_start is
  'Left edge of the Monday Timeline column.';
comment on column monday_projects.timeline_end is
  'Right edge of the Monday Timeline column.';
comment on column monday_projects.latest_update is
  'Most-recent Monday item update/comment body, stripped of HTML.';
