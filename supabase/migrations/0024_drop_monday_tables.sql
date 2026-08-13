-- ALLOW_DESTRUCTIVE: Monday.com fully decommissioned (docs/MONDAY-DECOMMISSION-LOG.md).
-- Sync disabled (0001-sync-runner.ts no longer has a "monday" source), the last live
-- reader (Customer 360 Activity tab) was removed, and no other code reads these tables
-- (verified via repo-wide grep immediately before this migration was written). Monday
-- itself remains the source of truth if this data is ever needed again; local
-- monday-backup*/ snapshots also exist (gitignored, not in this repo).

drop table if exists monday_projects;
drop table if exists monday_activities;
drop table if exists monday_nps_responses;
