# DeliveryOps

The single source of truth for everything that happens to a customer after the deal closes. DeliveryOps unifies Salesforce, Kognitos (v1 + v2), Google Workspace (Drive / Gmail / Calendar / Slides), Slack, Microsoft Teams, and Monday.com behind one operational dashboard and one Claude-powered agent.

This repo is the production rewrite of an internal Python prototype called Curator. Curator's brain — tools, prompts, profile schema, ingestion pipeline — lives under `legacy/` as a port-from reference and never deploys. DeliveryOps is the one we ship.

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
- Vercel — hosting + Cron triggers
- Anthropic Claude (Sonnet 4.5) — agent + vision-based document extraction

## Dev quickstart

```bash
git clone git@github.com:rishabhmalhotra23/deliveryOps.git
cd deliveryOps

cp .env.example .env.local
# Fill in: ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, INNGEST_*, SLACK_*, GOOGLE_*, KOGNITOS_V2_*, etc.

npm install
npm run dev
# → http://localhost:4001
```

Lattice is installed from the local tarball `kognitos-lattice-1.36.0.tgz` checked into the repo. To upgrade, build a new tarball from [kognitos/lattice](https://github.com/kognitos/lattice), drop it at the repo root, and bump the `@kognitos/lattice` reference in `package.json`. See `.cursor/rules/05-npm-local-packages.mdc` for the full pattern.

## Repo layout

```
app/                Next.js App Router (pages + route handlers)
  api/              Server routes: chat, slack/events, gmail/push, cron, inngest
  customers/        Customer dashboard pages
  fonts/            Self-hosted Neue Machina + Neue Montreal (drop licensed .woff2 here)
  layout.tsx        Lattice ThemeProvider + brand fonts
  globals.css       Tailwind v4 + Lattice theme + brand tokens
lib/
  agent/            Tools, prompts, dispatcher (Phase 1 port of curator/brain)
  ingestion/        Claude vision extractor + classifier + pipeline
  integrations/     salesforce, kognitos/{v1,v2}, monday, google/{drive,gmail,calendar,slides}, slack
  supabase/         Server / client / generated types
  brand/            Theme overrides, brand voice helpers
inngest/
  client.ts         Inngest client
  functions/        ingest-document, sync-*, digest-monthly, run-task
supabase/
  migrations/       0001_init.sql onwards
legacy/             READ-ONLY reference port-from material (do not deploy)
.cursor/rules/      Cursor AI rules (workflow, lattice, brand-voice, product-naming, …)
```

## Brand

Primary: **#F2FF70** Yellow. Foreground: **#171717** Night. Display font: **Neue Machina**. Body font: **Neue Montreal**. Inter / Inter Tight as Google fallbacks for emails and decks. Voice: intelligent wit, plainspoken, confident, no hedging — see `.cursor/rules/brand-voice.mdc`.

## Phasing

- **Phase 0 — Foundations** (this commit): scaffolded from `kognitos-app-template`, Lattice tarball wired, brand tokens applied, Supabase schema drafted, Inngest scaffolded, no functional features.
- **Phase 1 — Port the brain**: agent + tools + prompts, Slack listener, Gmail watch + push, Drive mirror, ingestion pipeline (Claude vision), Vercel Cron + Inngest scheduler, dashboard pages.
- **Phase 2 — Integrations + pilot**: Salesforce, Kognitos v2, Calendar, Monday, monthly digest, pilot customer wiring.
- **Phase 3 — Roadmap**: Kognitos v1 adapter, QBR deck generator, Microsoft Teams listener, multi-tenant + external version.

## Auth

Supabase Auth with Google OAuth restricted to `kognitos.com`. External / multi-tenant scoping arrives in Phase 3.
