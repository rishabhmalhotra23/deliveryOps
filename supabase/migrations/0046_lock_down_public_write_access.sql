-- Closes public write access to three tables and two RPC functions.
--
-- Found by Supabase's own security advisor while verifying 0044/0045 in
-- production on 2026-09-08, so this is remediation of a live hole rather than
-- hardening in the abstract. One of the two functions is one I added an hour
-- earlier, which is the honest reason this migration exists.
--
-- WHAT WAS OPEN
-- -------------
-- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is, by design, public — it ships to the
-- browser. Anything the `anon` role can reach through PostgREST is therefore
-- reachable by anyone who reads the page source. Three findings:
--
--   ERROR  rls_disabled_in_public
--          field_overrides (0041), vocabulary_values (0042), app_settings
--          (0043) were created without RLS while every other table in the
--          schema has it enabled. PostgREST exposes them, and the default
--          anon/authenticated grants on `public` make them readable and
--          writable directly. Someone could rewrite the ARR overrides the
--          All-Hands deck reads, or the $/hr bands in the value model.
--
--   WARN   anon_security_definer_function_executable
--          add_vocabulary_value (0042) and rename_customer_category (0045)
--          are SECURITY DEFINER and callable via /rest/v1/rpc/. The first
--          runs ALTER TYPE, which cannot be undone. The second repoints every
--          customer carrying a category.
--
-- WHY THIS IS SAFE
-- ----------------
-- Every reader and writer of these three tables goes through requireAdmin()
-- (lib/overrides/store.ts, lib/settings/store.ts, lib/vocabulary/store.ts),
-- which is the service-role client, and the service role bypasses RLS. The
-- browser-side anon client in lib/supabase/client.ts has no importer at all —
-- confirmed by grep before writing this.
--
-- So: RLS on with no policies is exactly the state the other 14 tables are
-- already in. It blocks anon and authenticated, and changes nothing for the
-- app. Deliberately no policies — adding one would be inventing an access
-- model for tables that only ever want service-role access.

begin;

-- ── 1. RLS on the three tables that never had it ──────────────────────────
alter table field_overrides    enable row level security;
alter table vocabulary_values  enable row level security;
alter table app_settings       enable row level security;

comment on table field_overrides is
  'Human corrections to Salesforce-derived values, with who/when/why. RLS enabled with no policies (0046): service-role only, like every other table here. entity_id is polymorphic and deliberately has NO foreign key — it cannot be used in a PostgREST embedded relation. That mistake took production down on 2026-09-08.';

-- ── 2. Revoke the two SECURITY DEFINER functions from the public roles ────
-- REVOKE rather than SECURITY INVOKER: both genuinely need definer rights.
-- add_vocabulary_value runs ALTER TYPE, which the app role cannot do, and
-- rename_customer_category writes two tables in one transaction. The problem
-- was never that they are definer, only that anyone could call them.
revoke execute on function add_vocabulary_value(text, text, text, text, text) from anon, authenticated;
revoke execute on function rename_customer_category(text, text)              from anon, authenticated;

-- is_internal_user() is left alone on purpose. It is the predicate the
-- internal_profiles RLS policies call, so it has to remain executable by the
-- roles those policies evaluate for — revoking it would break the access
-- control it exists to enforce, which is the opposite of the intent here.

commit;
