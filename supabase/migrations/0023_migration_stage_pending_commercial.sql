-- 0023 — add a new migration_stage value for processes whose V2 migration is
-- technically complete but not live because commercial terms aren't settled,
-- or the process won't be used going forward.
--
-- Surfaced during the 2026-08-06 V2 Migration List reconciliation: 8 Wipro
-- FSS rows carry the Migration Status "Migration complete, waiting for
-- commercial discussion or won't be used for now". Rishabh's call: this is a
-- real, distinct state, not a forced fit into `live_on_v2` (implies the
-- customer is actually running on v2 today) or `not_required` (implies v2 was
-- never built). Forcing it into either would misstate the V2 estate in the
-- all-hands report.
--
-- Adding the enum value only — no row is set to it here. A freshly added enum
-- value cannot be used in the same transaction that creates it, and the
-- reconciliation pass that assigns it to the 8 Wipro FSS rows is a separate,
-- later step (see docs/MONDAY-DECOMMISSION-LOG.md, 2026-08-06 handoff).

alter type migration_stage add value if not exists 'migrated_pending_commercial';
