-- Simplify RLS after switching from Supabase Auth → Auth0.
--
-- With Supabase Auth, we used a custom is_internal_user() function that read
-- the JWT email claim to enforce @kognitos.com. Auth0 issues its own JWTs
-- which Supabase doesn't validate as user sessions, so that function is now
-- meaningless.
--
-- New model:
--   - Authentication: Auth0 (session cookie, validated in Next.js middleware)
--   - Authorisation:  All DB queries use the service-role client which
--                     bypasses RLS. The browser never calls Supabase directly.
--   - RLS stays ENABLED on every table (defence in depth). We drop the
--     authenticated-user policies (they were only useful with Supabase Auth
--     JWTs) and add nothing in their place — no policy = deny all except
--     service-role.
--   - internal_profiles: still zero policies, still inaccessible to anything
--     other than service-role. Structural fence unchanged.
--
-- To migrate back to per-user RLS later (e.g. for multi-tenant external
-- version), configure Supabase to accept Auth0 JWTs as a custom JWT provider
-- and recreate the policies with the new JWT structure.

-- ── Drop the Supabase-Auth-specific helper and all policies it powered ────────

drop function if exists public.is_internal_user() cascade;
-- `cascade` also drops the policies that reference it.

-- ── Drop any remaining authenticated-user policies not covered by cascade ────
-- (These might exist if is_internal_user() was not referenced in the USING
-- clause but dropped separately at some point; safe to call idempotently.)

drop policy if exists customers_kognitos          on customers;
drop policy if exists profiles_kognitos           on profiles;
drop policy if exists events_kognitos             on events;
drop policy if exists rules_kognitos              on rules;
drop policy if exists tasks_kognitos              on tasks;
drop policy if exists conversations_kognitos      on conversations;
drop policy if exists customer_users_kognitos     on customer_users;
drop policy if exists chat_sessions_kognitos      on chat_sessions;
drop policy if exists chat_messages_kognitos      on chat_messages;
drop policy if exists pending_approvals_kognitos  on pending_approvals;
drop policy if exists sf_accounts_kognitos        on sf_accounts;
drop policy if exists sf_opportunities_kognitos   on sf_opportunities;
drop policy if exists sf_cases_kognitos           on sf_cases;
drop policy if exists monday_projects_kognitos    on monday_projects;
drop policy if exists monday_activities_kognitos  on monday_activities;
drop policy if exists monday_nps_responses_kognitos on monday_nps_responses;
drop policy if exists sync_runs_kognitos          on sync_runs;
drop policy if exists k2_workspaces_kognitos      on k2_workspaces;
drop policy if exists k2_processes_kognitos       on k2_processes;
drop policy if exists k2_runs_kognitos            on k2_runs;

-- ── Verify RLS still enabled (it is — we never disabled it) ──────────────────
-- Just for documentation: RLS is enabled on all 21 tables from migrations
-- 0001 and 0015. No authenticated-user policies exist. Service-role bypasses
-- RLS by design (Postgres built-in). Every authenticated non-service-role
-- request gets denied — which is correct because all app queries now use the
-- service-role client.
