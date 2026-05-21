# Runbook

Operations playbook for the things that can go wrong with the local DeliveryOps stack. Each section is one scenario → exact steps to recover. Tested in production-like conditions.

If a scenario isn't here and you fix it, add it.

---

## Index

- [Database wiped or partially missing](#database-wiped-or-partially-missing)
- [Applying a new migration](#applying-a-new-migration)
- [Stale `.next` cache after running `npm run build` with dev still on](#stale-next-cache-after-running-npm-run-build-with-dev-still-on)
- [Salesforce sync returning stale data](#salesforce-sync-returning-stale-data)
- [Monday sync 0 matches for a board](#monday-sync-0-matches-for-a-board)
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

4. **Re-import the customer portfolio from Monday:**

   ```bash
   curl -s http://localhost:4001/api/dev/import/preview | \
     python3 -c "
   import sys, json
   data = json.load(sys.stdin)
   sel = [{
     'monday_item_id': c['monday']['item_id'],
     'monday_workspace_id': (c['workspace'] or {}).get('id') if c['workspace'] else None,
     'display_name': c['monday']['name'],
     'proposed_key': c['proposed_key'],
     'salesforce_account_id': (c['salesforce_candidates'][0]['Id'] if c['salesforce_candidates'] else None),
     'partner': c['monday'].get('partner'),
     'ae_owner': c['monday'].get('ae_owner'),
     'lifecycle_group': c['monday'].get('group'),
   } for c in data['candidates']]
   json.dump({'selections': sel, 'drop_seed': True}, open('/tmp/import.json','w'))
   "
   curl -s -X POST http://localhost:4001/api/dev/import/run \
     -H "Content-Type: application/json" -d @/tmp/import.json | python3 -m json.tool
   ```

5. **Re-apply the curated SF mapping fixes:**

   ```bash
   npx tsx scripts/apply-mapping-fixes.ts
   ```

6. **Run a full sync to repopulate caches:**

   ```bash
   curl -s -X POST http://localhost:4001/api/dev/sync/run \
     -H "Content-Type: application/json" \
     -d '{"sources":["salesforce","monday"]}' | python3 -m json.tool
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

## Monday sync 0 matches for a board

**Symptom:** `monday/<board>` shows `matched: 0` even though items exist.

Most common cause: the relation column on the source board isn't being read via the `BoardRelationValue.linked_item_ids` GraphQL fragment.

Verify by probing the board directly:

```bash
# Edit script to point at the board ID in question, then:
npx tsx scripts/inspect-projects-board.ts
```

If the typed fragment returns `linked_items` correctly, the sync should pick it up automatically. If not, the column isn't populated in Monday — populate it there.

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
