-- New lifecycle value: "needs_triage" — active-shaped work that hasn't been
-- reviewed against the current source of truth (Rishabh, 2026-08-24: the
-- Delivery Active view had drifted to ~39 processes against an 11-project
-- working list). Distinct from on_hold (genuinely active, paused for a real
-- reason) and from cancelled/churned/retired (actually dead) — this is
-- "unclassified until someone looks at it again." Routed to the Archive view
-- (lib/import/monday-taxonomy.ts's viewForLifecycle), not Active, since the
-- three-view model (active/delivered/archive) has no fourth bucket.

alter type process_lifecycle add value if not exists 'needs_triage' after 'on_hold';
