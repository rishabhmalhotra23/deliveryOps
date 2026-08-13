# Runbook

Operations playbook for the things that can go wrong with the local DeliveryOps stack. Each section is one scenario → exact steps to recover. Tested in production-like conditions.

If a scenario isn't here and you fix it, add it.

---

## Index

- [Database wiped or partially missing](#database-wiped-or-partially-missing)
- [Applying a new migration](#applying-a-new-migration)
- [Stale `.next` cache after running `npm run build` with dev still on](#stale-next-cache-after-running-npm-run-build-with-dev-still-on)
- [Salesforce sync returning stale data](#salesforce-sync-returning-stale-data)
- [Background job didn't run](#background-job-didnt-run)
- [Colima / Docker not running (Supabase containers down)](#colima--docker-not-running-supabase-containers-down)

---

## Database wiped or partially missing

**Symptom:** `npx tsx scripts/db-sanity-check.ts` fails, customer pages 404 or render empty, dashboard shows 0 customers.

**Tested:** 2026-05-11. Recovery time: ~10 minutes end-to-end.

**Cause:** Almost always one of:
- `supabase db reset` ran (manually or as a `cmd-A || db-reset` fallback)
- The Postgres volume was removed (`docker volume rm`)
- Migration with an unsafe `DROP TABLE` got applied via the wrong path

**Recovery:**

1. **Confirm the damage.** Don't panic-run anything yet:

   ```bash
   npx tsx scripts/db-sanity-check.ts
   ```

   Note which tables are below minimum.

2. **Verify Supabase is up.** If not, start it:

   ```bash
   docker ps | grep supabase_kong  # should be 'healthy'
   # if missing:
   colima start
   supabase start
   ```

3. **Apply migrations if a fresh DB:**

   ```bash
   npx tsx scripts/safe-migrate.ts
   ```

4. **Re-import the customer portfolio — MONDAY-BASED IMPORT NO LONGER EXISTS.**

   `/api/dev/import/preview` and `/api/dev/import/run` (the Monday-sourced import wizard this step used to describe) were deleted as part of the 2026-08 Monday.com decommission — Monday is no longer a source of truth for the customer roster. There is currently no automated re-import path.

   If the `customers` table is empty or partially missing, restoring it is a manual/seed operation: rebuild the roster from the most recent backup (see `monday-backup-<date>/` if one exists locally, or a Supabase point-in-time-recovery snapshot) and insert directly into `customers`, or reconstruct rows by hand from Salesforce account data. There's no scripted replacement for this step yet — treat `customers` as the thing that needs manual attention here before continuing to step 5.

5. **Re-apply the curated SF mapping fixes:**

   ```bash
   npx tsx scripts/apply-mapping-fixes.ts
   ```

6. **Run a full sync to repopulate caches:**

   ```bash
   curl -s -X POST http://localhost:4001/api/dev/sync/run \
     -H "Content-Type: application/json" \
     -d '{"sources":["salesforce","kognitos-v2","linear-tickets"]}' | python3 -m json.tool
   ```

7. **Backfill profiles + internal_profiles:**

   ```bash
   npx tsx scripts/backfill-profiles.ts
   ```

8. **Verify recovery:**

   ```bash
   npx tsx scripts/db-sanity-check.ts
   # should be healthy
   ```

---

## Applying a new migration

**Never use `supabase db reset` — it wipes data.** See [destructive-operations.mdc](../.cursor/rules/destructive-operations.mdc).

```bash
# Preview what would run:
npx tsx scripts/safe-migrate.ts --dry

# Apply pending migrations one at a time, in a transaction:
npx tsx scripts/safe-migrate.ts

# Check status:
npx tsx scripts/safe-migrate.ts --status
```

The script refuses to run if it finds destructive SQL (`DROP TABLE`, `TRUNCATE`, etc.) without an explicit `--allow-destructive` flag. Even then, with non-empty `customers`, it requires `I_REALLY_MEAN_IT=1` in the env.

---

## Stale `.next` cache after running `npm run build` with dev still on

**Symptom:** Pages 500 after a build interrupts the dev server. `Cannot find module '/path/to/.next/...'` in `/tmp/nextdev.log`.

```bash
lsof -ti :4001 | xargs -r kill -9
rm -rf .next
npm run dev > /tmp/nextdev.log 2>&1 &
```

Wait ~10 seconds for Turbopack to compile the first request, then verify with `curl localhost:4001/dashboard`.

To prevent this: don't run `npm run build` while `npm run dev` is up. If you need both, run build in a temp checkout.

---

## Salesforce sync returning stale data

**Symptom:** `sf_accounts.synced_at` shows >24h old; per-customer pages show outdated industry or contact count.

```bash
curl -s -X POST http://localhost:4001/api/dev/sync/run \
  -H "Content-Type: application/json" \
  -d '{"sources":["salesforce"]}' | python3 -m json.tool
```

If that fails: check `SALESFORCE_*` env vars (`grep -E "^SALESFORCE_" .env.local`), confirm the Connected App still has Client Credentials enabled.

---

## Background job didn't run

**Symptom:** Slack file upload acknowledged but no `DOCUMENT_INGESTED` event ever appears for the customer.

Cron + jobs both POST through Vercel functions. Debug from both ends:

```bash
# 1. Was the dispatch issued? Check the webhook handler logs in Vercel.
#    Look for "jobs.dispatch" log entries with the job name.
vercel logs --since 10m | grep "jobs.dispatch"

# 2. Did /api/jobs/* receive the POST?
vercel logs --since 10m | grep "/api/jobs/"

# 3. Manually re-dispatch (replace the body):
curl -X POST "https://<your-domain>/api/jobs/ingest-document" \
  -H "Authorization: Bearer $JOBS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"customerKey":"acme","filename":"x.pdf","mimeType":"application/pdf","source":"upload","storagePath":"acme/raw/.../x.pdf"}'
```

If the dispatch is logged but the POST never lands, the JOBS_SECRET on Vercel differs from the dispatcher's. Make sure both `CRON_SECRET` and (optionally) `JOBS_SECRET` are set in the Vercel project — the dispatcher falls back from `JOBS_SECRET` to `CRON_SECRET`.

---

## Colima / Docker not running (Supabase containers down)

**Symptom:** `psql "postgresql://...:54322/postgres"` returns connection refused; `docker ps` says daemon not running.

```bash
colima start
supabase start
# wait ~30s for containers, then verify:
docker ps --format 'table {{.Names}}\t{{.Status}}' | head
npx tsx scripts/db-sanity-check.ts
```

If the sanity check fails after `supabase start`, the volume was likely garbage-collected — proceed to [Database wiped](#database-wiped-or-partially-missing).
