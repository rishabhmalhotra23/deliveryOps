-- Finishes what 0046 started. 0046 was wrong and this says why.
--
-- 0046 ran:
--   revoke execute on function add_vocabulary_value(...) from anon, authenticated;
--
-- and the advisor still reported both functions as anon-executable afterwards.
-- Checking the ACL showed why:
--
--   add_vocabulary_value  =X/postgres
--                         postgres=X/postgres
--                         service_role=X/postgres
--
-- The first entry has an EMPTY grantee. In Postgres that is `PUBLIC`, and
-- every function gets `EXECUTE` granted to PUBLIC on creation. `anon` and
-- `authenticated` never held a direct grant to revoke — they inherit from
-- PUBLIC — so 0046's REVOKE was a no-op against a grant that was never there.
--
-- The lesson worth keeping: for functions, revoking from named roles does
-- nothing until PUBLIC is revoked. Tables are the opposite way round, which is
-- what makes this easy to get wrong.
--
-- Safe because `service_role` holds an EXPLICIT grant (service_role=X above),
-- and the service role is what every caller uses — lib/vocabulary/store.ts
-- reaches both functions through requireAdmin(). Revoking PUBLIC leaves that
-- untouched.
--
-- Why these two matter, restated from 0046: NEXT_PUBLIC_SUPABASE_ANON_KEY
-- ships to the browser by design, so anything anon can call is callable by
-- anyone reading the page source. add_vocabulary_value runs
-- `ALTER TYPE ... ADD VALUE`, which Postgres cannot undo.
-- rename_customer_category repoints every customer holding a category.

begin;

revoke execute on function add_vocabulary_value(text, text, text, text, text) from public;
revoke execute on function rename_customer_category(text, text)               from public;

-- is_internal_user() is deliberately left executable. It is the predicate the
-- internal_profiles RLS policies call, so the roles those policies are
-- evaluated for must be able to run it — revoking would break the access
-- control it exists to enforce.

commit;
