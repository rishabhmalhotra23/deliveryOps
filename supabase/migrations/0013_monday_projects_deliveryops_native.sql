-- Add delivery_notes to monday_projects so users can annotate projects
-- directly in DeliveryOps without those notes being overwritten by syncs.
-- The sync never writes this column; it is purely DeliveryOps-native.
--
-- Also adds last_synced_at as an alias for synced_at (kept for audit) and
-- a removed_from_monday flag so projects deleted from Monday boards are
-- preserved in DeliveryOps history and just marked inactive rather than
-- deleted.

alter table monday_projects
  add column if not exists delivery_notes     text,
  add column if not exists removed_from_monday boolean not null default false;

comment on column monday_projects.delivery_notes is
  'Free-text notes added directly in DeliveryOps. Never written by sync; survives all re-syncs.';
comment on column monday_projects.removed_from_monday is
  'Set to true when a project is no longer found on any Monday board during sync. Preserves the record for history.';
