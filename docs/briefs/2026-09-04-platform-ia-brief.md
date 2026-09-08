# Implementation prompt — Platform IA revamp (5 destinations)

Copy everything below the line into Claude Code, from the repo root
(`/Users/rishabh_standard/Documents/GitHub/deliveryOps`).

Place the mockup at `docs/mockups/2026-09-04-platform-ia.html` first
(source: `2026-09-04-platform-ia.html` in the design project).

Ship this as **five separate PRs in order**. Do not combine them. Stop after
each and wait for review.

---

You are implementing an approved information-architecture revamp of DeliveryOps.

## The design

`docs/mockups/2026-09-04-platform-ia.html` — one self-contained interactive
mockup. **Open it and click through both modes before writing any code.**

- **IA proposal** mode is the argument: the four calls, the map, where every
  existing surface goes, the route map and this phasing plan. Read it; it
  answers most "why" questions you will have.
- **Screens** mode is the specification: click every sidebar item and every
  sub-tab, and click a customer row in Customers → Book to reach the 360.

It uses the repo's own tokens from `app/globals.css` (`--brand-yellow #F2FF70`,
`--brand-night #171717`, `--surface-1 #262626`, `--surface-2 #1F1F1F`,
`--foreground-muted #A3A3A3`, `--status-good/warn/bad`) plus PP Neue Montreal
and IBM Plex Mono. Dark is primary; light must work everywhere.

Companion spec already in flight: `docs/mockups/2026-09-03-v2-delivery-redesign.html`
and its prompt (`CLAUDE-CODE-PROMPT.md`) own the Delivery workspace internals —
table, board, process detail, roster picker, configure. **This prompt does not
redesign Delivery's internals.** Where the two overlap, that prompt wins.

## The shape of the change

Seven primary nav entries plus three tools become **five destinations plus an
admin drawer**:

| Destination | Route | Sub-tabs |
|---|---|---|
| Today | `/today` | Needs you, Changed overnight, My accounts |
| Customers | `/customers` | Book, Renewals, Sentiment, Escalations |
| Delivery | `/delivery` | Processes, Programmes, Go-lives, Value |
| Reports | `/reports` | All-hands weekly, Delivery review, Trends, Exports |
| Agent | `/agent` | Chat, Approvals, Tasks, Suggested edits |
| Admin (drawer off the avatar) | `/admin/*` | Integrations, Sync, Data health, Roster, Dev console |

Three structural moves carry the whole thing:

1. **NPS is not a destination.** It becomes Customers → Sentiment. Campaigns,
   the response table and score history move over intact; the score also renders
   on the customer record. Nothing is deleted.
2. **Operations + Chat become Agent.** This is the merge Stage A explicitly
   deferred (see `CLAUDE.md`). The data already exists — `pending_approvals`
   has the revision history, `tasks` has the scheduler. What was missing was the
   design; it is now in the mockup.
3. **Dashboard becomes Today.** Same position in the nav, different job: it
   assigns work instead of summarising it. Dashboard → Trends moves to
   Reports → Trends.

## Hard rules

- **`/nps/respond/[token]` does not move, does not change, and does not gain
  auth.** It is the public customer-facing survey route. If a redirect, a route
  group move, or a middleware change touches it, you have broken NPS
  collection. Verify it explicitly in every PR.
- **Every old URL keeps working.** Each move ships with a redirect in the same
  PR. The full route map is in the mockup's "Routes and phasing" section:
  `/dashboard` → `/today`, `/dashboard?tab=trends` → `/reports/trends`,
  `/nps` and `/nps/campaigns/[id]` → `/customers/sentiment`,
  `/v2-migration` → `/delivery?programme=v2`, `/operations` → `/agent/approvals`,
  `/chat` → `/agent`, `/dev/*` → `/admin/*`.
- **No new source of truth.** Every screen in the mockup reads existing tables.
  Reports read the same loaders the pages read. If a screen seems to need a new
  metric, it does not — find the existing column or stop and ask.
- **Slack and email never write a field.** They append to `events`, and at most
  create a row that a human accepts in Agent → Suggested edits, which writes
  with provenance.
- Production data. Verify against dev/staging Supabase; never run bulk or
  destructive operations against production.
- Follow `CLAUDE.md`: `npm run build`, type-check and `vitest run` before each
  push; stage only changed files, never `git add -A`; pin locales
  (`toLocaleString("en-US")`) because a husky pre-commit hook runs vitest;
  confirm the Vercel deployment reaches READY after each push.

---

# PR 00 — Measure before building Today

Half a day. No UI. **Do this first and report the numbers before PR 04 is
designed into existence.**

Write `scripts/audit-queue-volume.ts` in the house style of
`scripts/audit-data-health.ts`. It prints, for the last 30 days:

- open `pending_approvals` per day (mean, max)
- `processes` where `blocked_on is not null` or last human touch > 30 days
- renewals inside 90 days from `sf_opportunities`
- `events` per night, and how many are of a kind a human would act on

**Why it gates PR 04:** if Today would hold 40 items a day it needs ranking
rules and a "snooze" model. If it holds one, Today is a card on Customers, not a
destination, and PR 04 shrinks accordingly. Do not guess this.

Output: numbers appended to `docs/STATUS.md`. No app changes.

---

# PR 01 — Nav, routes and redirects

One PR. Low risk. **No visual change to any page body** — that is what makes it
reviewable in one sitting.

- `app/_components/app-shell.tsx`: `PRIMARY_NAV` drops to the five entries above.
  `SECONDARY_NAV` ("Tools") is deleted from the sidebar; its items move into a
  menu on the existing `UserPill` avatar, matching the mockup's Admin drawer.
  Keep the `layoutId="nav-active-pill"` motion and the sync dots as they are.
- Route groups: create `app/(app)/today/`, `app/(app)/agent/`,
  `app/(app)/admin/`. Move `app/chat` under `/agent` and `app/(app)/operations`
  under `/agent/approvals`; move `app/dev/*` under `/admin/*`.
- Redirects for every row in the route map. Use `next.config.ts` redirects for
  static paths and a `page.tsx` `redirect()` where a query param has to be
  translated (`/dashboard?tab=trends`, `/v2-migration`).
- Sub-tab navigation is a query param, not a route segment
  (`/customers?tab=renewals`), so a tab is linkable and the page keeps one
  loader. Match the existing `dashboard-tabs.tsx` pattern.
- The mockup's sidebar shows a count pill per destination. Wire only the two that
  are free: Today (open approvals) and Customers (account count). Leave the rest
  empty rather than inventing a number.

Verify: every URL in the route map resolves; `/nps/respond/[token]` still loads
unauthenticated; `middleware.ts` untouched; no page body changed.

---

# PR 02 — Customers: zones, Sentiment, and the 360

Two PRs' worth of work; split as 02a and 02b if it gets large. Medium risk —
Customer 360 is the most-visited page in the app. Highest daily payoff here.

## 02a — Book of business

`app/(app)/customers/_components/customers-browser.tsx`:

- Four collapsible **zones** with headers and counts: Focus, Pipeline,
  Evaluation, Closed. Category → zone mapping is in `docs/ux-improvement-plan.md`
  Part 1; implement it as a single map in `lib/customers/`, not inline.
- Add the **Evaluation** category value with its own cool review tone, distinct
  from To drop (warm) and Churned (gray).
- Type-ahead search, zone/category/owner/health filter chips, sort by ARR or
  renewal urgency. This is the Tier-1 gap in the UX plan.
- Row columns per the mockup: customer + owner, category chip, ARR, health dot,
  last NPS, processes with a stuck count, renewal date coloured by urgency.
- One category always wins; Evaluation outranks an imminent renewal in the
  precedence rules.
- Inline AE/partner edits get an **undo toast** (Tier-2 item, cheap here).

## 02b — Customer 360

`app/(app)/customers/[key]/`:

- **Eight tabs collapse to five**: Overview, Delivery, Signals, Files, Settings.
  Documents → Files; Activity and Events → Overview's timeline; NPS responses →
  Signals; Profile and Rules → Settings.
- Overview per the mockup, in this order: hero with category/health/migration
  chips → six-stat rail (ARR, renewal, NPS, processes, runs 30d, open items) →
  **Open items** card (blockers and escalations, red-bordered, first because it
  is the only part that asks for something) → Processes (the same `processes`
  rows as Delivery, filtered by customer, same inline edits, same PATCH) →
  Activity (one merged timeline: Slack, email, tickets, runs).
- Right rail cards: Commercials, Contacts, Rules, Field provenance. **Every rail
  row names its source.** Salesforce-sourced rows are read-only; the
  human-owned fields are editable in place and listed in
  `deliveryops_protected_fields`. Provenance is the feature, not a tooltip.
- Wrap the heavy sections in `Suspense` with skeletons so the shell paints
  immediately.

## 02c — Sentiment (NPS moves in)

- `app/(app)/nps/*` becomes `app/(app)/customers/` + `?tab=sentiment`. The
  client, `new-campaign-modal`, `all-responses-table` and `score-history` move
  as-is; only their route and chrome change.
- Layout per the mockup: portfolio score with quarter bars and
  promoter/passive/detractor split, response list where every row links to the
  customer record, campaigns in the right rail.
- The last NPS score renders on the customer record and in the Book row.
- `/nps` and `/nps/campaigns/[id]` redirect. **`/nps/respond/[token]` stays
  exactly where it is.**

---

# PR 03 — The Agent merge

One PR. Medium-high risk: this is the merge that was deferred once for backend
and persistence reasons, so expect the divergence to be real.

- `/agent` route group with four tabs: Chat, Approvals, Tasks, Suggested edits.
- **Chat**: the existing `app/chat` surface, unchanged in behaviour, plus a
  thread list per the mockup (customer, last message, tools used, when). Say
  plainly in the UI that `internal_profiles` has no tool surface — that
  isolation is structural (service-role only, enforced by RLS) and worth
  showing.
- **Approvals**: the full `pending_approvals` queue with kind, customer, what it
  will do, revision count, age. Approve / revise in place / reject with a
  reason. **Same rows as Today's queue** — one loader, two surfaces. Nothing
  auto-sends, ever.
- **Tasks**: the `tasks` scheduler — schedule, customer, action, next run,
  state; create, pause, cancel. Note in the UI that new scheduled work rides
  `run-tasks` rather than a third Vercel cron (Hobby caps at 2).
- **Suggested edits**: ship the list behind a flag if the accept path is not
  ready. The write must stamp source, message and accepting human, and support
  undo. Rejection is a logged first-class outcome.
- `/operations` → `/agent/approvals`, `/chat` → `/agent`.

---

# PR 04 — Today, plus empty and loading states

One PR, built last, scoped by PR 00's numbers.

- `/today` with three tabs: Needs you, Changed overnight, My accounts.
- **Needs you** is one ranked queue assembled from four existing sources:
  `pending_approvals`, `processes` blocked or stale 30d+, renewals inside 90
  days, and stale-field counts. Each card carries a kind chip, a one-line body
  with the specific fact, a primary and a secondary action, the customer and an
  age. Cards act in place; nothing navigates away to be useful.
- **Empty state is a designed screen, not a fallback**: "All caught up", with
  what was checked and two ways out. The mockup has a "preview empty state"
  toggle in the queue header — build that state, not the toggle.
- **Changed overnight** is a read-only `events` stream. It must not offer
  actions; that is what keeps the queue meaningful.
- **My accounts** ships with an owner filter. Turn on per-FDE row scoping via
  `customer_users` later, when the team is bigger than five.
- Add `Suspense` skeletons across the data-heavy pages in this PR — Today is
  where felt-speed matters most, and the gap is already documented.
- `/dashboard` → `/today`.

---

## Not designed — do not invent

Notifications, email digests beyond the existing blocked one, automation rules,
saved views on Customers, mobile layouts, a QBR generator, customer-facing
surfaces of any kind. If the implementation feels like it needs one, stop and
ask.

## Verify before each push

1. `npm run build`, type-check, `vitest run`.
2. Every route in the map resolves, including the query-param translations.
3. `/nps/respond/[token]` loads unauthenticated, every single PR.
4. Toggle light mode and re-check chips, zone headers, health dots and the 360
   rail — light mode is where this design regresses first.
5. 1440 and ~900 wide: tables scroll rather than clip; the 360 rail drops below
   the main column instead of squeezing it.
6. Confirm the All-hands report numbers still match Delivery row for row — the
   project's standing gate for this data.
7. Confirm the Vercel deployment reaches READY.
