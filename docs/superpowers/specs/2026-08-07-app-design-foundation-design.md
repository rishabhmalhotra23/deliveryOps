# DeliveryOps app design — Stage A: foundation

Date: 2026-08-07
Status: approved by Rishabh (visual direction + IA), ready for implementation planning

## Why

DeliveryOps has grown organically to 8 primary nav entries with real duplication (two V2-migration
implementations, two chat surfaces, two overlapping metrics pages) and an inconsistent visual
treatment (glassmorphism in most places, no real dark mode, motion only on the dashboard). Rishabh
asked for a full design/frontend pass — nav structure, per-page content, and visual language — before
reviewing the whole platform's data.

This is too large for one spec. Per the brainstorming decomposition rule, it splits into:

- **Stage A (this spec):** lock the visual language and the nav/IA, prove the visual language on
  three representative pages, and fix a live data-accuracy problem in the weekly All-Hands report that
  surfaced during the IA discussion (unrelated to visuals, but time-sensitive — it's presented weekly).
- **Stage B (separate spec, after Stage A ships):** roll the proven visual language across the
  remaining pages, in priority order.

## Visual language

**Direction chosen: "Bold Brand-Forward."** Dark-mode-primary, high contrast, the Kognitos brand
yellow (`--brand-yellow: #F2FF70`) used as a real signal color rather than a hairline accent. Validated
against three UI patterns during brainstorming (stat tiles, a dense table, a tabbed detail view) — see
`.superpowers/brainstorm/49358-1786097241/content/visual-direction*.html` for the working mockups.

Confirmed with Rishabh: **dark is the default**, but a light-mode toggle is kept (not dark-only) —
ergonomics concern for 8-hour daily use.

### Tokens (dark, primary)

| Token | Value | Use |
|---|---|---|
| `--background` | `#171717` (existing `--brand-night`) | Page canvas |
| `--surface-1` | `#262626` (existing `--brand-night-soft`) | Cards, stat tiles |
| `--surface-2` | `#1F1F1F` (new) | Table rows, nested surfaces inside a card |
| `--foreground` | `#FAFAFA` (existing `--brand-seasalt`) | Primary text |
| `--foreground-muted` | `#A3A3A3` (existing `--brand-metal`) | Secondary text, labels |
| `--foreground-body` | `#D4D4D4` (new) | Table body text — one step brighter than muted, one step dimmer than primary |
| `--accent` | `#F2FF70` (existing `--brand-yellow`) | Rare: active tab underline, one highlighted stat, badges that mean "this is the signal to notice" |
| `--status-good` | `#4ADE80` (new) | On track / healthy |
| `--status-warn` | `#FB923C` (existing, reused) | At risk |
| `--status-bad` | `#F87171` (new) | Off track / blocked |

Light mode keeps today's existing tokens (`--brand-canvas` background, white cards, same accent/status
colors) — it already exists in `app/globals.css` and doesn't need new design work, just needs to stay
selectable via the theme toggle instead of being the default.

### Typography, spacing, motion

- No font change. Keep `--font-display` (Neue Machina/Inter Tight) and `--font-body` (Neue
  Montreal/Inter) — already distinctive, not the problem.
- Card radius: 10–14px (matches validated mockups). Table rows: 8px, sit on `--surface-2` inside a
  `--surface-1` container, 1px gap between rows (no visible border — separation comes from the surface
  step, not a line).
- Status is always color **+ a small dot/label**, never color alone (accessibility — already the
  existing convention in `HEALTH_PILL_CLS`, keep it).
- Motion (reveal-on-mount, count-up numbers) currently only exists on `/dashboard`. Extend the same
  vocabulary to every page that shows `StatBlock`-style tiles, as part of Stage B — no new motion
  language needed, just consistent application.

### Charts (Analytics/Trends)

Flagged as real, separate work, not covered by the token table above: Recharts palettes need a dark
variant (axis lines, gridlines, tooltip backgrounds, series colors against `#171717` instead of white).
Scoped into Stage B when the Dashboard/Trends tab is built.

## Information architecture

**6 primary nav entries, down from 8.** Two genuine redundancies removed as *merges*, not deletions —
nothing users currently rely on disappears:

| Entry | Change |
|---|---|
| **Dashboard** | Gains a second tab: **Overview** (today's dashboard — pending approvals, quiet customers, what changed) and **Trends** (today's `/analytics` — ARR/NPS/workload charts, drilldowns). One page, one shared loader. Kills the "two loaders can disagree" class of bug (same failure mode as the `fiscal_year` and `v2_progress` bugs found and fixed 2026-08-07). **Analytics drops off the nav**, folded in here. |
| **Customers** | Unchanged. Zones (Focus/Pipeline/Evaluation/Closed) and search/filter/sort already shipped. |
| **Delivery** | Unchanged. The process work board (Active/Delivered/Archive, Q-on-Q). |
| **V2 Migration** | Unchanged — stays the live, always-current tracker (`loadV2MigrationOverview`, real `processes` data). Distinct purpose from the weekly report below: this is for checking status *any day*, the report is the *meeting snapshot*. |
| **Reports** | Unchanged as a nav entry — catalog of periodic snapshot artifacts. Both live reports under it get a data-accuracy fix (see below) plus the new visual language in Stage B. |
| **Agent** | Merges **Operations** (portfolio-wide bulk-edit chat) and **Chat** (per-customer chat) into one surface. Opens in portfolio-wide mode by default; the existing customer-picker (already in `/chat`) narrows scope when a customer is picked — one continuum instead of two destinations. **Operations and Chat drop off the nav**, folded into this one entry. |

Net change to `app/_components/app-shell.tsx`'s `PRIMARY_NAV`: 8 entries → 6
(`Dashboard, Customers, Delivery, V2 Migration, Reports, Agent`).

### Explicitly out of scope for Stage A/B (noted so they don't get silently relitigated)

- Whether `/v2-migration` eventually retires once the V1→V2 migration program itself completes — a
  future lifecycle question, not a design decision to make now.
- The `/dev/*` secondary nav (Tools section) — internal debug tooling, not part of the product IA.

## Weekly All-Hands report — data-accuracy fix (time-sensitive, decoupled from Stage A/B)

Discovered while confirming the IA: `/reports/v2-migration` — the report Rishabh presents from every
week — reads a hand-maintained file (`lib/reports/v2-allhands-weeks.ts`, a `WEEKS` registry someone
edits by hand each week) instead of live data. A *third*, separate hand-curated file
(`lib/reports/v2-migrations.ts`) feeds `/reports/weekly`'s own V2 tile. Both predate the 2026-08-06
native `processes` model and were never migrated off it — the same "report labeled live that isn't"
problem the Monday-decommission docs flagged in July but didn't fix for these two files.

**Fix, done ahead of Stage A/B and in the current visual style** (this is a correctness fix, not a
design change — no reason to make Rishabh wait for the visual rollout to get accurate numbers at next
week's All-Hands):

- Rebuild `/reports/v2-migration`'s content to read `loadV2MigrationOverview()` (the same live
  `processes`-backed source `/v2-migration` already uses correctly) instead of `v2-allhands-weeks.ts`.
  Keep its identity, URL, and PNG/print export — Rishabh presents from this page weekly; nothing about
  *what it is* changes, only where its numbers come from.
  - Some of the old report's content (week-over-week movement deltas, narrative journey copy) has no
    direct equivalent in the live `processes` model, which is a snapshot, not a week-keyed history.
    Flagged for a design conversation (Rishabh: "we can discuss the new report's look") — likely
    resolved by computing deltas against the *previous* time this page was rendered/exported rather
    than a hand-written weekly diff, but that's a Stage B design question, not blocking the data fix.
- Rewire `/reports/weekly`'s V2 tile off `lib/reports/v2-migrations.ts` onto the same live source, for
  consistency (this report already reads live `processes` data for everything else, per the 2026-08-07
  session — only its V2 tile was missed because it was already Monday-independent before that session
  started, so the earlier Monday-decommission pass never touched it).
- Delete `lib/reports/v2-allhands-weeks.ts` and `lib/reports/v2-migrations.ts` once both consumers are
  rewired and verified.
- Verification: same pattern as the Monday cutover — run both rebuilt reports against production,
  confirm the numbers make sense against what `/v2-migration` shows for the same processes, before
  calling it done. No UI/visual change in this fix, so no mockup needed for it specifically.

## Stage A proof pages

Before rolling the new visual language everywhere, build it on three pages chosen to cover the app's
three distinct UI patterns:

1. **Dashboard** (stat tiles + card grid + the new Overview/Trends tab merge) — also where the IA
   merge lands, so it has to be touched regardless.
2. **Delivery** (dense table + kanban-style board) — highest information density in the app, the
   hardest test of the dark palette's row/status legibility.
3. **Customers/[key]** (customer 360 — tabs, sticky rail, hero) — the most structurally complex single
   page, and the one every FDE opens most often per the consolidation plan's own framing ("make the
   customer page the daily surface").

Each gets a quick mockup check (reusing the visual-companion pattern from this session) before
implementation, even though the palette itself is already approved — layout-level surprises are still
possible at full page scale versus a cropped preview.

## Stage B (separate spec, written after Stage A ships)

Remaining pages get the proven visual language applied, in this priority order (subject to
re-sequencing once Stage A is actually built and Rishabh has opinions from using it):

1. Customers (list page)
2. V2 Migration
3. Reports catalog + the two report pages' visual refresh (data already fixed in the section above)
4. Agent (post-merge Operations+Chat)
5. Charts/Trends tab specifically (Recharts dark palette — flagged above as its own scoped task)

Also carries forward two items already identified as real, still-open UX gaps (from
`docs/ux-improvement-plan.md`, confirmed not yet built): Suspense/skeleton loading states (every page
is currently `force-dynamic` with no streaming), and a deliberate "all caught up" empty state for
Dashboard on a quiet day. Both fit naturally into Stage B once pages are being touched anyway.

## Explicitly not doing

- Mobile-first redesign — this is confirmed multi-user among FDEs but still a desktop-first internal
  tool; no signal mobile usage is real. Revisit if that changes.
- A user-configurable dashboard/settings panel — a good default layout beats a preferences screen for
  a team this size.
- Rewriting `lib/delivery/taxonomy.ts`'s legacy-string-vocabulary translation layer (added 2026-08-07 to
  retire Monday without touching the UI) — Stage B pages read `processes` natively already
  (`lib/processes/loader.ts`) or will be rewired to as part of their own page work, not as a prerequisite
  refactor.
