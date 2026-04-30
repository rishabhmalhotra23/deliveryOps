# DeliveryOps

The single source of truth for everything that happens to a customer after the deal closes. DeliveryOps unifies Salesforce, Kognitos (v1 + v2), Google Workspace (Drive / Gmail / Calendar / Slides), Slack, Microsoft Teams, and Monday.com behind one operational dashboard and one Claude-powered agent.

This repo is the production rewrite of an internal Python prototype called Curator. Curator's brain — tools, prompts, profile schema, ingestion pipeline — lives under `legacy/` as a port-from reference and never deploys.

> **The why.** This README is the *how*. For the long-form *why* — the problem we're solving, the principle behind one customer / one source of truth / one agent, what "done" looks like, what we deliberately won't build — read [**`docs/VISION.md`**](./docs/VISION.md). It's the doc to send a new engineer or stakeholder.

## Run locally in 5 minutes (no Slack / Google / Vercel apps needed)

You need:

- **Docker** running locally (for Supabase).
- An **Anthropic API key** (free to sign up; ~$5 covers a lot of dev).
- **Node 20+** (`nvm install 20 && nvm use 20`).

```bash
# 1. Install dependencies + Lattice tarball
npm install

# 2. Start Supabase locally (Postgres + Storage + Auth on Docker)
npm run db:start

# 3. Apply migrations + seed the demo customer (Acme)
npm run db:reset

# 4. Grab the local Supabase keys + paste them into .env.local
npm run db:status            # prints API URL, anon key, service-role key
cp .env.example .env.local   # then fill in:
#    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from db:status>
#    SUPABASE_SERVICE_ROLE_KEY=<service_role key from db:status>
#    ANTHROPIC_API_KEY=<your key>

# 5. Start the Inngest dev server (background jobs) in a second terminal
npm run inngest:dev          # serves http://localhost:8288

# 6. Start Next.js
npm run dev                  # http://localhost:4001
```

`npm run dev` uses **Turbopack** (Next 15's modern bundler). If you ever need the legacy webpack-based dev server, run `npm run dev:webpack` — it wipes `.next/` first to avoid stale-chunk corruption.

Open <http://localhost:4001> and you're running. No real Slack workspace, no Google project, no Vercel deploy. Everything outbound (Slack messages, emails, Drive uploads) routes through a **mock layer** to `/dev/outbox`, and you can simulate inbound traffic at `/dev/simulate`.

### What you can do without any external integration

| Page | What it does |
| --- | --- |
| `/dev` | Status: which integrations are live vs mocked. One-click "seed demo customer". |
| `/dev/simulate` | Forms to send a fake Slack message, fake inbound email, or fake file upload — all routed through the same handlers Slack and Gmail call in production. |
| `/dev/outbox` | Reverse-chronological feed of every Slack message, email, and Drive upload the agent has produced. |
| `/customers` | List of customers (Acme is seeded by default). |
| `/customers/acme` | Tabbed dashboard: Overview / Profile / Events / Tasks / Documents / Rules / Chat. |
| `/chat` | Talk to the DeliveryOps agent directly (it scopes to the first customer in the DB). |

### Wiring real integrations

When you're ready to point at real Slack / Google / Vercel, paste the corresponding tokens into `.env.local` and the mock layer turns off automatically for that integration. There's no flag to flip — the modules in `lib/dev/mode.ts` auto-detect which credentials are present.

**Step-by-step for every integration:** see [`docs/CREDENTIALS.md`](./docs/CREDENTIALS.md) — a tickable checklist with the exact dashboard clicks, scopes, callback URLs, and verification commands for each one (Slack Events API, Google OAuth + Gmail watch + Pub/Sub, Salesforce Connected App, Kognitos v2 PAT, Monday API token, plus the production deploy stack — Supabase Cloud, Inngest Cloud, Vercel).

## What it does

- **Customer system of record.** Profiles, internal profiles, events, rules, conversations, tasks — all in Postgres, all queryable, all editable from the dashboard.
- **Ingestion that just works.** Drop a PDF, deck, image, or transcript into Slack, Drive, or email; Claude vision extracts it, the classifier files it, and the agent indexes it.
- **An agent that knows the customer.** A single Claude tool-use loop with access to every integration, scoped per customer, with full event-log audit trail.
- **Outbound that sounds human.** Monthly digests, QBR decks, Slack updates, Gmail replies — all written in DeliveryOps brand voice (intelligent wit, plainspoken, confident, no jargon).

## Tech stack

- Next.js 15 (App Router) + TypeScript + Tailwind v4
- [Lattice UI](https://github.com/kognitos/lattice) (`@kognitos/lattice`) — Kognitos design system
- Supabase (Postgres + Storage + Auth) — single source of truth
- Inngest — durable background jobs (ingestion, syncs, digests)
- Vercel — hosting + Cron triggers (production)
- Anthropic Claude (Sonnet 4.5) — agent + vision-based document extraction

## Repo layout

```
app/                Next.js App Router (pages + route handlers)
  api/              Server routes: chat, slack/events, gmail/push, cron, inngest, dev/simulate
  customers/        Customer dashboard pages
  dev/              Local dev console (status / simulate / outbox)
  fonts/            Self-hosted Neue Machina + Neue Montreal (drop licensed .woff2 here)
  layout.tsx        Lattice ThemeProvider + brand fonts
  globals.css       Tailwind v4 + Lattice theme + brand tokens
lib/
  agent/            Tools, prompts, dispatcher, runner (port of curator/brain)
  ingestion/        Claude vision extractor + classifier + pipeline
  integrations/     salesforce (Phase 2), kognitos/{v1,v2} (Phase 2), monday (Phase 2),
                    google/{drive,gmail,calendar,slides}, slack
  supabase/         Server / client / typed shapes
  brand/            Theme overrides, brand voice helpers
  dev/              Mock layer + outbox (drives /dev pages)
  voice/            brand-voice block injected into every system prompt
inngest/
  client.ts         Inngest client (auto-detects local dev server)
  functions/        ingest-document, sync-*, digest-monthly, run-task
supabase/
  config.toml       Supabase CLI config for local dev
  seed.sql          Demo customer + profile + rules
  migrations/       0001_init.sql onwards
legacy/             READ-ONLY reference port-from material (do not deploy)
.cursor/rules/      Cursor AI rules (workflow, lattice, brand-voice, product-naming, …)
```

## Brand

Primary: **#F2FF70** Yellow. Foreground: **#171717** Night. Display font: **Neue Machina**. Body font: **Neue Montreal**. Inter / Inter Tight as Google fallbacks for emails and decks. Voice: intelligent wit, plainspoken, confident, no hedging — see `.cursor/rules/brand-voice.mdc`.

## Phasing

- **Phase 0 — Foundations** (`b9c350b`): scaffolded from `kognitos-app-template`, Lattice tarball wired, brand tokens applied, Supabase schema drafted, Inngest scaffolded, no functional features.
- **Phase 1 — Port the brain** (`3c93cfe`): agent + tools + prompts, Slack listener, Gmail watch + push, Drive mirror, ingestion pipeline (Claude vision), Vercel Cron + Inngest scheduler, dashboard pages.
- **Phase 1.5a — Local-first dev mode** (this commit): mock layer for Slack / Gmail / Drive, dev console at `/dev`, inbound simulator. No real integration accounts needed to run end-to-end.
- **Phase 1.5b — Approval flows + inline editors**: port email approval / action approval to Slack interactive cards, inline profile + rules editors.
- **Phase 2 — Integrations + pilot**: Salesforce, Kognitos v2, Calendar, Monday, monthly digest, pilot customer wiring.
- **Phase 3 — Roadmap**: Kognitos v1 adapter, QBR deck generator, Microsoft Teams listener, multi-tenant + external version.

## Auth

Supabase Auth with Google OAuth restricted to `kognitos.com`. External / multi-tenant scoping arrives in Phase 3.
