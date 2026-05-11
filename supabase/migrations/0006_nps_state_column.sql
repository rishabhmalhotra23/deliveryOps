-- Phase 2 Pass I — NPS responses cache column parity
--
-- monday_nps_responses was missing the `state` column that monday_projects
-- and monday_activities have. The Monday sync code writes state on every
-- row, which 0-failed silently against the cache schema cache until we
-- exercised the NPS path with a populated dataset.

alter table monday_nps_responses
  add column if not exists state text;

create index if not exists monday_nps_state_idx on monday_nps_responses (state);
