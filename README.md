# DeliveryOps

**One screen for every customer, after the deal closes.**

DeliveryOps is the operational system of record for the Kognitos Forward Deployed Engineering team. It collapses Salesforce, Kognitos (v1 + v2), Google Workspace (Drive · Gmail · Calendar · Slides), Slack, and Monday.com into one customer page driven by one Claude-powered agent. Every fact about a customer lives in exactly one row in Postgres; every customer-facing string flows through one prompt with the brand voice baked in.

This repo is the production rewrite of an internal Python prototype called **Curator**. Curator's brain — tools, prompts, profile schema, ingestion pipeline — lives under [`legacy/`](./legacy) as a port-from reference and never deploys.

> **Want the long-form _why_?** Read [**`docs/VISION.md`**](./docs/VISION.md) — the problem we're solving, the principle behind one customer / one source of truth / one agent, what "done" looks like, what we deliberately won't build. It's the doc to send a new engineer or a stakeholder.

---

## The problem in one paragraph

A Kognitos customer signs the contract. To answer _"what's going on with this customer?"_ an FDE opens Salesforce, the Kognitos workspace, Drive, Gmail, Slack, Monday, and the QBR deck from three months ago. Seven tabs. Maybe nine. Every week, for every customer, by hand. The information is all there — it's just smeared across seven systems and one human's memory. **The FDE _is_ the database.** That doesn't scale. DeliveryOps replaces the dig.

## The principle

**One customer, one source of truth, one agent.**

- **One source of truth.** Exactly one place that knows everything we know about a customer — DeliveryOps. Salesforce data, Kognitos runs, Slack threads, Gmail, Drive, Calendar, Monday tickets, QBR notes, internal observations — all indexed, all queryable, all editable from one screen.
- **One agent.** Exactly one assistant operates on that source of truth. It answers questions, updates profiles, logs events, drafts emails, schedules reminders, escalates to humans, writes the monthly digest. One prompt drives everything.
- **One voice.** Every customer-facing string sounds like the same person wrote it. Because it is the same person.

---

## What works today

DeliveryOps is **post-Phase 2**. Below is shipped and running locally. Production deploy is the next milestone — Vercel + Supabase Cloud access is in motion.

### The dashboard

| Route | What it is |
|---|---|
| `/dashboard` | Command centre. Overnight changes, source-of-truth pipeline, top-of-funnel risks, sync status. |
| `/customers` | Filterable customer list. Status, ARR, NPS, owner. Click into any one. |
| `/customers/[key]` | Customer 360 — hero, profile, internal profile, contacts, projects, NPS, events timeline, tasks, documents, rules, agent chat. Inline-editable. |
| `/delivery` | Portfolio-wide delivery view. Q-on-Q charts, project velocity, team workload. |
| `/analytics` | Aggregate analytics across the book. Customer concentration, ARR by category, NPS distribution. |
| `/reports` | Auto-generated reports — QBR Generator, Weekly Delivery Update, Monthly Digest, Health Report. (Several still scaffolded; first goes live next.) |
| `/operations` | Sync status, queued approvals, tool-call audit log. |
| `/chat` | Talk to the DeliveryOps agent directly, scoped to any customer. |
| `/dev/*` | Local dev console — integration status, inbound simulator, outbox feed. (Local-only — gated in production.) |

### The agent — 16 tools, one Claude (Sonnet 4.5) loop

Per-customer scoped. Every tool call is audited in `chat_messages.tool_calls`.

| Read | Write | Outbound | Workflow |
|---|---|---|---|
| `get_customer_profile` | `update_customer_profile` | `send_slack_message` | `create_task` |
| `search_customer_docs` | `update_customer_rules` | `send_email` | `list_tasks` |
| `get_credit_usage` | `log_event` | `revise_email_draft` | `cancel_task` |
| `get_slack_history` |  | `revise_pending_action` | `escalate_to_human` |
| `get_customer_rules` |  |  |  |

The agent has **no access** to the `internal_profiles` table — that's structural, not procedural (no tool surface + RLS denies all reads except service-role).

### Integrations

| System | Status | What we use it for |
|---|---|---|
| **Anthropic Claude (Sonnet 4.5)** | Live | The agent + Claude vision for document extraction (PDFs, decks, transcripts) |
| **Supabase** (Postgres + Storage + Auth) | Live | Single source of truth + sign-in (Google OAuth + magic-link) |
| **Salesforce** | Live | Contracts, renewals, opportunities, cases — daily sync |
| **Monday.com** | Live | Projects portfolio, NPS responses, activity log — daily sync + webhooks |
| **Kognitos v2** | Live | Workspaces, processes, runs, exceptions — daily sync at 08:00 IST |
| **Slack** | Wired | Customer-channel listener, file ingestion, agent replies, approval cards |
| **Gmail** | Wired | Send + Pub/Sub-driven inbound watch (per-customer email aliases) |
| **Google Drive** | Wired | Per-customer folder mirror + ingestion |
| **Google Calendar** | Stub | Phase 3 — auto QBR follow-ups |
| **Google Slides** | Stub | Phase 3 — QBR deck generator |
| **Microsoft Teams** | Roadmap | Phase 3 — mirror of Slack listener |
| **Kognitos v1** | Roadmap | Phase 3 — legacy customers |

Anything not yet "Live" routes through a **mock layer** to `/dev/outbox` so you can run end-to-end without external accounts. Auto-detection of which credentials are present — no flag to flip.

### Background workers (Vercel Cron + `/api/jobs/*`)

Two Vercel-native primitives, no external queue:

- **Cron** (`vercel.json`): `daily-sync` (02:30 UTC) runs Salesforce + Monday + Kognitos v2 sync; `run-tasks` (08:00 UTC) fires user-scheduled reminders. On Vercel Pro, `run-tasks` can move to per-minute and `monthly-digest` (1st of month) can be added.
- **Fire-and-forget jobs** (`/api/jobs/*`): webhooks call `dispatchJob("ingest-document" | "run-task" | "process-email", data)` — POST returns immediately while a fresh Vercel function execution does the work (Claude vision OCR, agent reply, etc.). Authed by `JOBS_SECRET` (falls back to `CRON_SECRET`).

### Auth & data safety

- **Sign-in.** Google OAuth restricted to `@kognitos.com` (production) + email magic-link (local dev via Mailpit, or via Resend SMTP for real inboxes).
- **Middleware gate** on every dashboard route. Webhook + cron + job routes (`/api/slack/`, `/api/gmail/`, `/api/cron/`, `/api/jobs/`) bypass — they're authenticated by signature/secret.
- **RLS** on every customer-data table requires a `@kognitos.com` JWT. `internal_profiles` denies all authenticated reads — only service-role can touch it.
- **Three structural guardrails** against destructive operations (Cursor agent hook + repo wrapper + pre-commit migration scan). See "[Data safety](#data-safety)" below.

---

## What's coming

Honest list, in rough priority order.

1. **Vercel deploy.** ✅ Done — live at `delivery-ops-delta.vercel.app` with Supabase Cloud + 23 env vars + Hobby cron (2 of 2 slots used).
2. **Reports go live.** Weekly Delivery Update is first (Slack + Monday + SF data is all live; just needs the generator). Then Monthly Digest, Customer Health Report, QBR Generator (gated on Google Slides API).
3. **Calendar sync + QBR follow-ups.** Calendar sync is currently a stub — once Google OAuth lands, it'll be wired into the daily-sync cron and the QBR follow-up job.
4. **Kognitos v1 adapter.** Legacy customers.
5. **Microsoft Teams listener.** Mirror of the Slack listener for customers on Teams.
6. **Multi-tenant + per-FDE scoping.** RLS through `customer_users`, per-FDE OAuth so every FDE sends from their own Gmail / Salesforce credentials. Read-only customer portal.

The end-state target — what "done" looks like — is in [`docs/VISION.md`](./docs/VISION.md).

---

## Architecture at a glance

```
                         Browser (Next.js App Router pages)
                                       │
                          Supabase Auth session cookie
                                       │
                                       ▼
              ┌────────────────────────────────────────────────┐
              │              Next.js (Vercel)                  │
              │  ─────────────────────────────────────────     │
              │  Server components + route handlers            │
              │  Middleware gate + @kognitos.com RLS           │
              │  Agent runner (Claude Sonnet 4.5 + 16 tools)   │
              └────────────────────────────────────────────────┘
                ▲           ▲                 │
                │           │                 ▼
        Slack/Gmail   Monday/SF/K2      Supabase Postgres
        webhooks      Vercel Cron       (single source of
        → /api/jobs/  (run-tasks,        truth, RLS-gated)
                      daily-sync,
                      monthly-digest)
```

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · [Lattice UI](https://github.com/kognitos/lattice) · Supabase (Postgres + Storage + Auth) · Vercel (hosting + cron + fire-and-forget jobs) · Anthropic Claude (Sonnet 4.5).

**Brand:** Primary `#F2FF70` (Yellow). Foreground `#171717` (Night). Display `Neue Machina`. Body `Neue Montreal`. Voice rules in [`.cursor/rules/brand-voice.mdc`](./.cursor/rules/brand-voice.mdc).

---

## Run locally in 5 minutes

Zero external accounts needed beyond Anthropic.

**Prerequisites:** Docker (Colima or Docker Desktop), Node 20+ (`nvm install 20 && nvm use 20`), an [Anthropic API key](https://console.anthropic.com) (~$5 covers a lot of dev).

```bash
# 1. Install (pulls the local Lattice tarball)
npm install

# 2. Local Postgres + Storage + Auth on Docker
npm run db:start           # routes through bin/safe-supabase

# 3. Apply migrations + seed the demo customer (Acme)
npx tsx scripts/safe-migrate.ts

# 4. Local Supabase keys → .env.local
npm run db:status                                 # prints anon + service keys
cp .env.example .env.local                        # then fill in:
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
#   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
#   ANTHROPIC_API_KEY=<your key>

# 5. The app
npm run dev                # http://localhost:4001
```

Hit <http://localhost:4001>, you'll bounce to `/login`. Type your `@kognitos.com` email → click "Email me a sign-in link" → grab it from **Mailpit** at <http://127.0.0.1:54324> → click → you're in as that user.

> **Real-inbox magic-link in dev:** 5-minute Resend setup, instructions in [`docs/CREDENTIALS.md` § Resend SMTP](./docs/CREDENTIALS.md#resend-smtp-for-sign-in-emails-5-min--strongly-recommended).

### What you can do without any external integration

| Page | What it does |
|---|---|
| `/dev` | Status: which integrations are live vs mocked. One-click "seed demo customer". |
| `/dev/simulate` | Send a fake Slack message, fake inbound email, or fake file upload — same handlers Slack and Gmail call in production. |
| `/dev/outbox` | Reverse-chronological feed of every Slack message, email, and Drive upload the agent has produced. |
| `/customers/acme` | Tabbed dashboard with seeded data. |
| `/chat` | Talk to the agent directly (scoped to the first customer). |

---

## Deploy to production

Step-by-step in [`docs/CREDENTIALS.md`](./docs/CREDENTIALS.md):

1. **Tier 0** — Anthropic API key + Resend SMTP (5 min)
2. **Tier 1** — Slack, Google Cloud (OAuth + Pub/Sub), Salesforce, Kognitos v2, Monday (~90 min total, each independent)
3. **Tier 2** — Supabase Cloud + Vercel (no Inngest — Vercel Cron + `/api/jobs/*` handle background work)
4. **Tier 3** — ngrok (local webhooks), Kognitos v1, Microsoft Teams (later)

Production runs on **Supabase Pro** (PITR + daily logical backups — non-negotiable for real customer data) and **Vercel Pro** (10s function-timeout cap on Hobby kills the agent loop).

---

## Data safety

DeliveryOps treats local + production data as gold. Three structural layers protect against the data-loss accidents that wiped local DB on 2026-05-11 and 2026-05-15:

1. **Cursor hook** ([`.cursor/hooks/block-destructive.sh`](./.cursor/hooks/block-destructive.sh)) intercepts every shell command an AI agent in this repo tries to run. Anything matching the data-loss blocklist (`supabase db reset`, `supabase stop --no-backup`, `DROP TABLE`, `docker volume rm`, `git reset --hard`, etc.) is **denied with `failClosed: true`** — the command physically cannot run from inside Cursor.
2. **`bin/safe-supabase` wrapper** catches the same patterns when humans invoke `supabase` directly. The npm scripts (`db:start`, `db:stop`, `db:reset`, `db:status`) all route through it. Override only via `I_REALLY_MEAN_IT=1` env.
3. **Pre-commit `check-migration-safety.ts`** scans staged migrations for destructive SQL. Refuses unless the migration has an opt-in `-- ALLOW_DESTRUCTIVE: <reason>` marker.

In production, **Supabase Cloud Pro** provides automatic point-in-time recovery (7 days). Recovery procedure for any data-loss scenario: [`docs/RUNBOOK.md`](./docs/RUNBOOK.md).

Full rationale + escape hatches: [`.cursor/rules/destructive-operations.mdc`](./.cursor/rules/destructive-operations.mdc).

---

## Repo layout

```
app/                Next.js App Router
  (app)/            Authenticated dashboard (dashboard, customers, delivery,
                    analytics, reports, operations, chat) — gated by middleware
  api/              Server routes
    chat/           Streaming Claude SSE
    cron/           Vercel-cron entries: run-tasks, daily-sync, monthly-digest
    jobs/           Fire-and-forget background jobs: ingest-document,
                    run-task, process-email (JOBS_SECRET-authed)
    slack/, gmail/  Webhook handlers (signature-authed)
    customers/      CRUD + Zod-validated mutations
    dev/, monday/   Dev-only + Monday webhooks
  auth/             Sign-in callback + sign-out
  dev/              Local dev console (status / simulate / outbox)
  login/            Sign-in page (Google OAuth + magic-link)
  fonts/            Self-hosted Neue Machina + Neue Montreal
  layout.tsx        Lattice ThemeProvider + brand fonts
  globals.css       Tailwind v4 + Lattice theme + brand tokens
lib/
  agent/            16 tools, prompts, dispatcher, runner (port of curator/brain)
  api/              Zod request schemas + parseBody helper
  auth/             getCurrentUser + isAllowedEmail (server-side)
  jobs/             dispatch.ts — fire-and-forget HTTP helper for /api/jobs/*
  ingestion/        Claude vision extractor + classifier + pipeline
  integrations/     salesforce, kognitos/{v1,v2}, monday, google/{drive,gmail,
                    calendar,slides}, slack
  supabase/         server.ts (service-role) + server-cookies.ts (RLS-scoped) +
                    middleware.ts + client.ts + ws-polyfill.ts
  sync/             Per-source sync runners called by /api/cron/daily-sync
  brand/            Theme overrides, brand voice helpers
  dev/              Mock layer + outbox (drives /dev pages)
  voice/            brand-voice block injected into every system prompt
  logger.ts         Structured logger (pretty in dev, JSON in prod)
supabase/
  config.toml       Supabase CLI config (local dev) — env-driven SMTP block
  seed.sql          Demo customer + profile + rules
  migrations/       0001_init.sql … 0015_auth_rls_kognitos_domain.sql
scripts/
  safe-migrate.ts          Apply migrations safely (refuses destructive SQL)
  check-migration-safety.ts Pre-commit guard (matches the same patterns)
  db-sanity-check.ts       Row-count health check
  db-snapshot.ts           Take a logical snapshot before risky operations
  verify-auth.ts           Smoke-test RLS + the email-domain gate
  …                        (sync runners, mapping fixers, inspectors)
bin/
  safe-supabase            Wrapper that refuses destructive flags
.cursor/
  rules/                   Cursor AI rules (workflow, brand-voice, lattice,
                           destructive-ops, …)
  hooks/                   Cursor agent guardrails (block-destructive.sh)
  hooks.json               Hook registration (failClosed: true)
docs/
  VISION.md                The why — long-form
  CREDENTIALS.md           Tier 0–3 setup checklist for every external service
  RUNBOOK.md               Recovery procedures for every "what could go wrong"
legacy/                    READ-ONLY port-from material (Curator Python prototype)
```

---

## Reading list, in order

1. [**`docs/VISION.md`**](./docs/VISION.md) — the why. Send this to a new engineer or stakeholder.
2. [**`docs/CREDENTIALS.md`**](./docs/CREDENTIALS.md) — every API key, token, and OAuth setup, with click-by-click instructions and a verify command for each one.
3. [**`docs/RUNBOOK.md`**](./docs/RUNBOOK.md) — operations playbook. What to do when each thing breaks.
4. [**`.cursor/rules/`**](./.cursor/rules) — the project's standing instructions to Cursor agents (workflow, Lattice UI, brand voice, destructive-ops, product naming, chat support).
5. [**`legacy/README.md`**](./legacy/README.md) — what's in the port-from reference and what to do with it.

When you're ready to write code: open [`lib/agent/`](./lib/agent) and [`app/(app)/customers/`](./app/(app)/customers). That's the heart.

---

## License & status

Internal Kognitos project. Not open-source (yet). The Phase 3 multi-tenant work would be the natural moment to consider it.
