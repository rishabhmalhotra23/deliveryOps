# DeliveryOps

The product, the principle behind it, and what the world looks like when it's done.

This is the long-form why. If you only have 30 seconds, [TL;DR](#tldr) is at the top. If you want the wiring, see [`README.md`](../README.md). If you want the architecture, see [`.cursor/plans/curator_full_vercel_rewrite_4412b274.plan.md`](../.cursor/plans/curator_full_vercel_rewrite_4412b274.plan.md). If you want to set up an integration, see [`docs/CREDENTIALS.md`](./CREDENTIALS.md).

## TL;DR

Customer success at Kognitos is a daily archaeological dig across Salesforce, Kognitos, Slack, Gmail, Drive, Calendar, and Monday. DeliveryOps replaces that dig with one customer page, one event timeline, one agent, and one voice. Every fact about a customer lives in exactly one row in Postgres; every customer-facing string flows through one prompt with the brand voice baked in; every external system becomes part of one knowledge graph instead of seven separate dashboards. End state: a CSM does in 30 minutes what used to take half a day, and the company can support hundreds of customers without "Rishabh's brain" being the index.

---

## The problem

A Kognitos customer signs the contract. What happens next?

A CSM gets pinged on Slack. They open Salesforce to find the account. They check the Kognitos workspace to see what the customer has built. They look in Drive for the SOW. They search their inbox for the latest email thread. They open Monday to see what the dev team owes the customer. They open the spreadsheet where they tracked last week's conversation. They open the QBR deck from three months ago to remember where we left off.

Seven tabs. Maybe nine. To answer one question: *"what's going on with this customer?"*

We do this every week, for every customer, by hand. The information is all there — it's just smeared across seven systems and one human's memory. The CSM *is* the database.

That doesn't scale. Today we have a handful of customers and the team knows each one personally. In two years we'll have ten times as many, and "the CSM's working memory" will not be the right place to look up Acme's renewal status.

There's also a quality cost that's harder to see. Every customer-facing email is composed from scratch by a tired person at 4:30 PM. Every QBR deck is rebuilt from a template by hand. Every monthly digest gets skipped half the time because it's nobody's #1 priority on a busy day. Inconsistency creeps in. Mistakes get made. Customers notice.

## The principle

**One customer, one source of truth, one agent.**

- **One source of truth.** There's exactly one place that knows everything we know about a customer — DeliveryOps. Salesforce data, Kognitos runs, Slack conversations, Gmail threads, Drive files, Calendar meetings, Monday tickets, QBR notes, personal preferences, the team's internal observations — all indexed, all queryable, all editable from one screen.
- **One agent.** Exactly one assistant operates on that source of truth — the DeliveryOps agent. It answers questions, updates profiles, logs events, drafts emails, schedules reminders, escalates to humans, writes the monthly digest. It works in *one* style because one prompt drives everything.
- **One voice.** Every customer-facing string — agent replies, email drafts, QBR slide copy, monthly digests, even error messages — sounds like the same person wrote it. Because it is the same person.

If you can describe what a CSM should do, the agent can do most of it. What it can't do, it knows to escalate.

## The end state

When DeliveryOps is fully shipped, it is the system every CSM at Kognitos opens at the start of every day. They don't open Salesforce. They don't search their inbox. They don't ping the dev team in Slack to ask "what's blocked?" Those tools still exist — DeliveryOps just talks to them on the CSM's behalf.

A typical morning, end-state:

1. CSM opens DeliveryOps. The dashboard lists every customer, sorted by **what changed overnight**.
2. Click into Acme. The overview reads: *credit usage spiked 4× yesterday, the QBR is in 2 days, the head of ops sent an email at 11 PM saying they're worried about their renewal, and the dev team flagged one Monday ticket as blocked.*
3. The agent already drafted a response to the late-night email. It's queued for approval in Slack — no human typing required. The CSM reads it, says *"tighten the second paragraph"*, and the agent revises in place.
4. The CSM clicks "Generate QBR". A twelve-slide deck lands in Drive in sixty seconds, with real numbers from Kognitos, real meeting summaries from Calendar, and a brand-correct narrative the CSM reviews and sends.
5. By 9:30 AM the CSM has done what used to take half a day.

Everything customer-facing sounds like the same person wrote it. Because it is.

When the customer asks "have you sent us the renewal terms?", the CSM doesn't search their inbox. They ask DeliveryOps. The answer is correct because DeliveryOps watched the email get sent.

When a new CSM joins the team, they're up to speed on a customer in ten minutes — they read the profile, scroll the events feed, glance at the rules, and they know everything the previous CSM knew.

## The shape — three pieces, all in one app

### 1. The system of record

Customers, profiles (customer-facing + internal), events, rules, tasks, conversations — all in Postgres. Every fact lives in exactly one row.

- Edit it on the dashboard, the agent sees the change immediately.
- Have the agent update it via a tool call, the dashboard sees the change immediately.
- There is no sync, no caching, no second source of truth.

The database *is* the source of truth.

The schema separates **what the customer can see** (the customer-facing profile) from **what the team sees** (the internal profile — health score, churn risk, internal notes). The agent has zero access to the internal profile. That isolation is structural, not procedural — it's a separate table with no tool surface, not a "please don't read this" comment.

### 2. The agent

Claude (Sonnet 4.5) with sixteen tools, all scoped to the current customer:

| Tool | What it does |
| --- | --- |
| `get_customer_profile` / `update_customer_profile` | Read + write the customer-facing profile |
| `search_customer_docs` | Find a contract / SOP / meeting note (Phase 2: vector search) |
| `log_event` | Append to the customer event log |
| `get_credit_usage` | Pull live credit data from Kognitos v2 (Phase 2) |
| `send_slack_message` | Post to the customer's Slack channel |
| `send_email` / `revise_email_draft` | Draft an email; revise per CSM feedback in Slack thread |
| `revise_pending_action` | Edit a queued profile/rules update before approval |
| `escalate_to_human` | Flag for the CS team in `#cs-escalations` |
| `create_task` / `list_tasks` / `cancel_task` | Schedule reminders, recurring checks, cron jobs |
| `get_slack_history` | Read recent channel context |
| `get_customer_rules` / `update_customer_rules` | Read + write the per-customer "dos and don'ts" markdown |

Every customer-facing string the agent produces flows through one voice block — the same one that governs the QBR decks and the monthly digests. The system prompt enforces the voice rules at generation time, not as a post-processing step.

### 3. The integrations as one organism

Seven external systems become one operational view, not seven dashboards:

| System | DeliveryOps role |
| --- | --- |
| **Salesforce** | The contract, renewal date, open opportunities, cases |
| **Kognitos v2** | Customer's automations, runs, exceptions, credit usage |
| **Gmail** | Every email to/from the customer's alias, archived + indexed |
| **Drive** | Every file the customer has sent us, OCR'd by Claude vision and classified |
| **Calendar** | Every meeting with the customer, with auto-created QBR follow-up tasks |
| **Slack** | The daily conversation, files auto-ingested when dropped in channel |
| **Monday** | Dev + CS work owed to the customer |

These don't show up as seven panels. They show up as one customer page where the agent treats every system as part of one knowledge graph. The CSM never has to remember which system the answer lives in.

## What "done" measures

- **Time-to-context for a new customer ticket.** Today: 5–10 minutes of clicking around. Goal: <30 seconds — the CSM opens the customer page and the answer is on screen.
- **Number of CSM-typed words per customer per week.** Today: thousands (emails, Slack messages, QBR notes, internal updates). Goal: hundreds — the CSM edits and approves drafts the agent produced.
- **Customers per CSM.** Today: ~8–12 with full attention. Goal: 25–30 with the same quality of attention, because the agent absorbs the routine work.
- **Time-to-onboard a new CSM.** Today: weeks of shadowing. Goal: a couple of days, because every customer's history is in one queryable place.
- **QBR consistency.** Today: every deck looks slightly different. Goal: every deck has the same brand-correct narrative spine and is generated in <60 seconds from real metrics.
- **Monthly digests sent on time.** Today: variable; depends on bandwidth. Goal: every customer, first business day of every month, no exceptions.

These are leading indicators. The lagging indicator is renewal rate.

## What we deliberately won't build

The shape that emerges from these constraints is sharper than a "do everything" platform — and easier to ship.

- **A generic CRM.** DeliveryOps knows about Kognitos automations, Kognitos credits, Kognitos workspaces. It's opinionated. We will not pretend it works for non-Kognitos customers.
- **A marketplace of plugins.** The integrations list is finite. We add them ourselves, deliberately, because each integration is designed to compose with the others. A plugin marketplace fragments the source of truth.
- **A native mobile app.** The browser is the product surface. CSMs work at desks.
- **A Salesforce replacement.** Salesforce remains the source of truth for contract data. DeliveryOps mirrors it; it does not try to replace it.
- **An external customer-facing chatbot.** The agent serves the CSM. A customer-facing bot is a different product with different failure modes.
- **A "low-code" workflow builder.** If you need a workflow we don't have, you write a TypeScript function in `inngest/functions/`. We optimise for engineering velocity, not citizen-developer reach.

## The voice

The agent talks like a sharp, busy colleague. Not a chatbot, not a SaaS vendor, not a customer-success "delight" platform.

Five traits, in priority order:

1. **Intelligent wit.** Dry, observant, occasionally amused. Cleverness lives in word choice, not punchlines.
2. **Plainspoken.** Short sentences. Active verbs. Concrete nouns. If a word has a shorter equivalent, use the shorter one.
3. **Confident.** State things. Don't hedge. If we don't know, we say *"we don't know yet"* — confidently.
4. **Disruptive / unapologetic.** Take a position. Say what we see. Don't soften the truth to be polite.
5. **Purposeful.** Every sentence either teaches the reader, asks them to do something, or moves the conversation. Cut the rest.

The full rules live in [`.cursor/rules/brand-voice.mdc`](../.cursor/rules/brand-voice.mdc) and get injected into every system prompt via [`lib/voice/brand-voice.ts`](../lib/voice/brand-voice.ts).

**Why is voice in the product spec?** Because the alternative is the SaaS-vendor sludge that floods a CSM's inbox every day, and the whole point of DeliveryOps is to be unmistakably the opposite of that. If our outbound copy reads like everyone else's outbound copy, we've lost the most distinguishable thing about the product.

## How we get there

Four phases. Each is shippable on its own — meaning each one delivers visible value, not just plumbing.

### Phase 0 — Foundations *(done, commit `b9c350b`)*

Scaffold the Next.js app from `kognitos-app-template`. Build the Lattice tarball. Wire the brand (palette + voice + naming). Draft the schema (customers, profiles, events, rules, tasks, conversations). Stub the Inngest functions. Copy the legacy Curator Python service into `legacy/` as a port-from reference. No features yet.

### Phase 1 — Port the brain *(done, commit `3c93cfe`)*

The agent runs. The customer dashboard works. The Slack and Gmail handlers exist. Documents flow through Claude vision (no marker-pdf, no pandoc, no tesseract). Tasks fire on schedule via Vercel Cron + Inngest (no APScheduler). Everything is TypeScript.

What you can do: open `/customers`, click into Acme, talk to the agent, drop a PDF in Slack and watch it get classified, schedule a reminder.

### Phase 1.5 — Local-first + approvals *(in progress, commits `b18d9a0`, `6467f1f`)*

Run the whole app on localhost without a Slack workspace or Google project. Mock layer routes every outbound call to a dev outbox. Inbound simulator drives the same handlers production uses. The email-approval Slack card and inline profile/rules editors close the last loops.

What you can do: a brand-new engineer clones the repo, runs `npm install && supabase start && npm run dev`, drops in their Anthropic key, and has a working agent in five minutes — no external accounts.

### Phase 2 — Integrations + pilot *(~2 weeks)*

Salesforce sync. Kognitos v2 sync. Calendar sync. Monday sync. Monthly digest generator. Pilot customer named and fully migrated — every customer fact in DeliveryOps, every customer interaction running through it.

What you can do: a CSM uses DeliveryOps as their daily driver for one customer. The whole loop works end-to-end in production.

### Phase 3 — Roadmap

Kognitos v1 adapter (legacy customers). QBR deck generator (twelve slides via Google Slides API). Microsoft Teams listener (mirror of the Slack listener). Multi-tenant external version (RLS by `csm_id`, customer-facing portal). Per-CSM OAuth so each team member uses their own Salesforce / Drive / Gmail credentials.

What you can do: every CSM is on it. The customer's primary contact has a read-only portal. The platform is the product.

The honest path from "Phase 0 was last week" to "external version is live" is roughly twelve to sixteen weeks of focused work. The pilot customer is week four to six. Everything after that is iteration.

## Who this is for, today

- **Internal Kognitos CSMs** — the primary user, today and forever.
- **The agent itself** — half the dashboard exists so the agent has somewhere to read and write. The other half exists so a human can see what the agent did and intervene.
- **Eventually (Phase 3), the customer's primary contact** — a read-only / write-restricted version where they see their profile, their events, their pending items, their open tickets. The internal-profile / health-score / internal-notes columns stay invisible to them.

Not for: AEs chasing new logos, marketing chasing campaigns, finance chasing AR. Other tools do those well. We don't.

## Why this is worth building

Customer success at a vertical AI company is a high-leverage activity. One CSM with the right tools can keep a portfolio of thirty customers happy and renewing. Without the right tools, the same CSM keeps eight customers semi-happy and spends most of their week context-switching between systems.

The difference between those two outcomes is the difference between a sustainable post-sales motion and a never-ending fire drill.

DeliveryOps is the bet that a thoughtfully-designed system of record + a Claude agent + the right integrations beats a Notion template + a Slack channel + good intentions. If we're right, every CSM at Kognitos gets to do the part of the job they were hired for — talking to customers, solving problems, finding patterns — instead of the part nobody was ever hired for: typing the same context into seven different tools.

## The bigger picture

If DeliveryOps works internally, it's the prototype for what we eventually offer to *every* Kognitos customer running their own automations. They'd run a customer-success function on top of *their* customers, with their own data, their own brand voice, their own integrations. Same architecture, different tenant.

That's beyond Phase 3 — not on the roadmap yet, but worth knowing it's the destination. We're building DeliveryOps the way we'd build it if we were going to sell it to ourselves first, then to everyone like us.

## A note on the legacy

There's a working Python prototype called Curator that does ~70% of what Phase 1 ships in TypeScript. It lives under `legacy/` as a read-only port-from reference. It runs an APScheduler loop, polls Gmail, uses marker-pdf for OCR, and stores everything in JSON files on disk and Google Drive.

Curator works. It's been running in production for the kognitos.com Slack workspace. The decision to rewrite isn't because Curator is broken — it's because Curator can't grow into the end state described above. The Python service would have to be rewritten anyway to:

- Run on Vercel (no long-running processes)
- Replace native binaries with Claude vision (deployability)
- Move from Drive-as-source-of-truth to Postgres-as-source-of-truth (queryability)
- Add multi-tenant RLS for the Phase 3 external version (architecture)
- Speak the brand voice in every outbound (consistency)

Doing all of those at once *is* the rewrite. We took the chance to also pick a stack the rest of the company can build on — Next.js, TypeScript, Lattice — instead of a Python FastAPI stack only one engineer maintains.

Curator's brain (tools, prompts, profile schema, ingestion logic, dashboard HTML) is the curriculum the new app learned from. Once Phase 2 lands and the pilot customer is fully migrated, the Curator repo gets archived.

---

## Reading list, in order

If you've read this and want to go deeper:

1. [`README.md`](../README.md) — what the app is, how to run it locally in five minutes.
2. [`docs/CREDENTIALS.md`](./CREDENTIALS.md) — every API key, token, and OAuth setup you'll need, with click-by-click dashboard instructions.
3. [`.cursor/plans/curator_full_vercel_rewrite_4412b274.plan.md`](../.cursor/plans/curator_full_vercel_rewrite_4412b274.plan.md) — the full architecture diagram, the technical decisions, and every Phase 0/1/2/3 todo with rationale.
4. [`.cursor/rules/brand-voice.mdc`](../.cursor/rules/brand-voice.mdc) — the brand voice rules that govern every customer-facing string.
5. [`legacy/README.md`](../legacy/README.md) — what's in the port-from reference and what to do with it.

When you're ready to write code: open [`lib/agent/`](../lib/agent/) and [`app/customers/`](../app/customers/). That's the heart.
