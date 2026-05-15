-- Tighten Row-Level Security so that authenticated requests are only allowed
-- when the JWT belongs to a @kognitos.com user. Service-role calls (Inngest
-- workers, cron jobs, the agent runner, the sync pipelines) continue to
-- bypass RLS as before — the service_role JWT is exempt by design.
--
-- Two separate gates:
--
--   1. Most customer-data tables (customers, profiles, events, rules, tasks,
--      conversations, customer_users, chat_*, pending_approvals, sf_*,
--      monday_*, k2_*, sync_runs):
--      → kognitos.com authenticated users get full read/write.
--
--   2. internal_profiles: NO authenticated-user policy. RLS denies every
--      non-service-role read. This makes the "agent has zero access to the
--      internal profile" rule from docs/VISION.md a structural fence rather
--      than a procedural one — even a misbehaving server component using the
--      anon client can't see internal notes.
--
-- Phase 3 (multi-tenant) will tighten further by joining through
-- customer_users for per-CSM scoping. For now we are single-tenant — every
-- kognitos.com user sees every customer.

-- ── Helper: SQL function the policies call ────────────────────────────────
-- Returns true when the request carries a Supabase Auth JWT whose `email`
-- claim ends in @kognitos.com. Used by every policy below so the rule lives
-- in one place and can be widened (multi-tenant) later without rewriting
-- every policy.

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(auth.jwt() ->> 'email', '')) like '%@kognitos.com',
    false
  );
$$;

comment on function public.is_internal_user() is
  'True when the calling JWT has an @kognitos.com email. Replace with a join through customer_users in Phase 3 multi-tenant work.';

-- ── Drop the old permissive policies ──────────────────────────────────────
-- These were "for all to authenticated using (true) with check (true)" — any
-- random Supabase user (including non-kognitos.com signups) could read
-- everything. Replace one by one.

drop policy if exists customers_open          on customers;
drop policy if exists profiles_open           on profiles;
drop policy if exists internal_profiles_open  on internal_profiles;
drop policy if exists events_open             on events;
drop policy if exists rules_open              on rules;
drop policy if exists tasks_open              on tasks;
drop policy if exists conversations_open      on conversations;
drop policy if exists customer_users_open     on customer_users;
drop policy if exists chat_sessions_open      on chat_sessions;
drop policy if exists chat_messages_open      on chat_messages;
drop policy if exists pending_approvals_all   on pending_approvals;

-- ── Customer-data tables: kognitos.com only ────────────────────────────────

create policy customers_kognitos
  on customers for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy profiles_kognitos
  on profiles for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy events_kognitos
  on events for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy rules_kognitos
  on rules for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy tasks_kognitos
  on tasks for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy conversations_kognitos
  on conversations for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy customer_users_kognitos
  on customer_users for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy chat_sessions_kognitos
  on chat_sessions for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy chat_messages_kognitos
  on chat_messages for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

create policy pending_approvals_kognitos
  on pending_approvals for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- ── internal_profiles: deny all authenticated reads ───────────────────────
-- No policy is created here. RLS is enabled, so PostgREST denies every
-- authenticated/anon request. Only service-role (which bypasses RLS) can
-- read or write. This enforces the VISION.md rule structurally — even if a
-- developer accidentally introduces a `select * from internal_profiles` in a
-- server component using the anon client, the row is invisible.

-- ── Cache tables: enable RLS and apply the same gate ──────────────────────
-- These tables were created without RLS — meaning anon could in principle
-- read them via the public anon API. Lock them down to kognitos.com.

alter table sf_accounts            enable row level security;
alter table sf_opportunities       enable row level security;
alter table sf_cases               enable row level security;
alter table monday_projects        enable row level security;
alter table monday_activities      enable row level security;
alter table monday_nps_responses   enable row level security;
alter table sync_runs              enable row level security;
alter table k2_workspaces          enable row level security;
alter table k2_processes           enable row level security;
alter table k2_runs                enable row level security;

create policy sf_accounts_kognitos          on sf_accounts          for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy sf_opportunities_kognitos     on sf_opportunities     for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy sf_cases_kognitos             on sf_cases             for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy monday_projects_kognitos      on monday_projects      for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy monday_activities_kognitos    on monday_activities    for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy monday_nps_responses_kognitos on monday_nps_responses for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy sync_runs_kognitos            on sync_runs            for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy k2_workspaces_kognitos        on k2_workspaces        for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy k2_processes_kognitos         on k2_processes         for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
create policy k2_runs_kognitos              on k2_runs              for all to authenticated using (public.is_internal_user()) with check (public.is_internal_user());
