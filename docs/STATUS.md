# DeliveryOps — Deployment Status

Last updated: 2026-05-17

## ✅ Live in production

**URL:** https://delivery-ops-delta.vercel.app

| Layer | Status |
|---|---|
| Vercel deploy | ✅ Auto-built from CLI; auto-deploy on push pending GitHub app install (see below) |
| Supabase Cloud | ✅ `prnakdaxcpzagntgvaqf` (us-east-1) — 21 tables, 20 RLS policies, `is_internal_user()` helper applied |
| Auth | ✅ Middleware gates dashboard; @kognitos.com restricted server-side + RLS |
| RLS | ✅ All 13 customer-data tables verified anon-blocked; service-role bypass works |
| Vercel cron (2 of 2 Hobby slots) | ✅ `daily-sync` 02:30 UTC · `run-tasks` 08:00 UTC |
| Background jobs (`/api/jobs/*`) | ✅ ingest-document, run-task, process-email — JOBS_SECRET-authed |
| Destructive-ops guardrails | ✅ Cursor hook, repo wrapper, pre-commit migration scan all active |
| Secret hygiene | ✅ Zero secrets in tracked files; .env.local + .vercel gitignored |
| Tests + typecheck | ✅ 81/81 pass; tsc clean |

## ⛔ Blocked on manual dashboard action (30 sec each)

1. **GitHub auto-deploy** — Vercel GitHub App not on personal account.
   → [github.com/apps/vercel/installations/select_target](https://github.com/apps/vercel/installations/select_target)
   → Pick `rishabhmalhotra23` → Only select repositories → `deliveryOps` → Install
   → Tell the agent; it'll link the project and pushes will auto-deploy

2. **Supabase auth redirect URLs** — so magic-link works on prod.
   → [Supabase Auth URL config](https://supabase.com/dashboard/project/prnakdaxcpzagntgvaqf/auth/url-configuration)
   → **Site URL:** `https://delivery-ops-delta.vercel.app`
   → **Redirect URLs** (add): `https://delivery-ops-delta.vercel.app/auth/callback`, `https://delivery-ops-delta.vercel.app/**`
   *Alternative:* grab a Supabase access token from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → paste → agent scripts it

## ⏳ Pending external access (you flagged for later)

- **Google Workspace OAuth** — unblocks magic-link via real Gmail account, plus Drive/Calendar/Slides features. Six scopes needed (see CREDENTIALS.md § 2). IT/admin ask in flight.
- **Vercel Pro upgrade** — would unblock per-minute `run-tasks` cron + add a 3rd cron slot for monthly-digest. Currently fine on Hobby for testing.

## 🔭 Next session — likely next steps

1. Once GitHub app installed → link repo → push-to-deploy goes live.
2. Once Supabase redirect URLs added → end-to-end magic-link test on prod.
3. Seed cloud Supabase with the same 41-customer dataset from local (via `/api/dev/import` once auth lets you in).
4. Pick the first real customer Slack channel to invite the DeliveryOps bot to.
5. Resume on the Customer Health Report card or the Calendar sync — whichever you want first.

## How to verify everything still works locally

```bash
nvm use 20
npm run db:start              # Supabase via Colima/Docker
npx tsx scripts/safe-migrate.ts
npm run dev                   # http://localhost:4001
```

Sign in via `/login` → email magic-link → grab it from Mailpit at `http://127.0.0.1:54324`.
