# Implementation prompt — V2 Migration + Delivery redesign

Copy everything below the line into Claude Code, from the repo root
(`/Users/rishabh_standard/Documents/GitHub/deliveryOps`).

Place the mockup at `docs/mockups/2026-09-03-v2-delivery-redesign.html` first.

---

You are implementing an approved design against the DeliveryOps codebase.

## The design

`docs/mockups/2026-09-03-v2-delivery-redesign.html` — a single self-contained,
fully interactive HTML mockup. **Open it and click through every surface before
writing code.** It is the source of truth for layout, interaction and copy. It
uses the repo's own tokens from `app/globals.css` (`--brand-yellow #F2FF70`,
`--brand-night #171717`, `--surface-1 #262626`, `--surface-2 #1F1F1F`,
`--foreground-muted #A3A3A3`, `--status-good/warn/bad`) and PP Neue Montreal +
IBM Plex Mono. Dark is primary; a light theme is included and must work.

The mockup has four panels in its top chrome: the merged **Delivery** workspace,
plus the **Process detail**, **Activity feed** and **Roster picker** components
in isolation. Only the Delivery workspace ships as a page; the other three are
component specs.

## The single biggest structural change

**V2 Migration is no longer its own page.** It becomes a second section inside
Delivery — two underline tabs, "Active work" and "V2 migration", over the same
`processes` rows. Keep `/v2-migration` as a route that redirects to
`/delivery?section=v2` so existing links and bookmarks survive. Remove the
"V2 Migration" entry from `PRIMARY_NAV` in `app/_components/app-shell.tsx`.

## What replaces the drawer

`app/_components/process-drawer.tsx` is retired. Build one shared
`ProcessDetail` component that mounts two ways, switchable from a toolbar
toggle (persisted per user):

- **Split panel** — a 420px sticky column beside the list, no scrim, selecting a
  row swaps the panel in place. This is the default.
- **Centre overlay** — the same component, 880px, centred over a dimmed list.

Both keep the drawer's per-field auto-save (`PATCH /api/processes/[id]`, one
field per request, optimistic, no Save button) and its yellow save flash. Both
add: an editable process name in the header, prev/next navigation through the
current filtered+sorted list with an "n of m" counter, a `/processes/[id]`
permalink, Archive and Mark reviewed in the footer, and a per-field `+` that
promotes that field to a table column and board card field.

**Row click no longer opens the panel** — cells are editable in place, so the
panel is opened deliberately from a ⤢ button in each row's sticky actions cell.

## The table is the primary editing surface

Most edits must never require the panel.

- 16 available columns; 15 shown by default (Process, Customer, Migration
  stage, Lifecycle, FDE, TAM, Partner, Health, Platform, Progress, ARR, Effort,
  Kickoff, Go-live, Linear, Last touched). A "Fields" menu toggles them; in
  Board view the same menu controls which fields render as chips on cards.
- **Every cell edits inline.** Text inputs for name and dates, selects for
  customer/stage/lifecycle/phase/owner/TAM/partner/platform/health, numerics for
  progress/ARR/effort. Stage and Health render as coloured chip-selects. Each
  change fires the same PATCH the panel uses — table and panel must never
  diverge, and every other surface reads the same row.
- **Column widths are draggable** from the header divider, capped at the
  scrollport width minus 140px, stored **per variant** (`w:` wide / `n:` narrow)
  so a wide-table drag can never break the narrow split-panel set. A "Reset
  column widths" item lives at the bottom of the Fields menu.
- **Columns reorder** by dragging the header label; **sort** by clicking it
  (asc → desc → off).
- Process + its checkbox are sticky left; the actions cell is sticky right. The
  header is sticky top — the table card owns a real vertical scrollport
  (`max-height: calc(100vh - 200px); overflow:auto`), which is what makes the
  sticky header resolve. Row boxes must be sized from their real track total,
  not a literal, or the sticky cells tear out of the card on deep scroll.
- Multi-select with real checkboxes, shift-click for a range.

## Filters

Chips read "Stage · any" / "Stage · Engg pending". Each has an × that removes
the filter entirely. A dashed "+ Filter" adds any of: Stage, FDE, Customer,
Health, Partner, Platform, Lifecycle, Phase, TAM. Option lists are derived from
data actually present, so there are no dead values. Below the toolbar, active
filters appear as removable chips with a "Clear all". Which filters are pinned
persists per user.

## Bulk actions

A floating centred bar appears on selection: Change owner, Change stage, Change
health, Add note, Archive. Owner opens the **roster picker** (type-ahead, alias
matching, "add to roster"); stage and health open option lists; note opens a
composer; archive is immediate with Undo. All of them go through
`PATCH /api/processes` with `{ids, patch}` and render the partial-failure shape
`{updated, failed}` honestly — do not claim success for rows that failed.

## Board

- V2 section: lanes by migration stage. Delivery section: the four existing
  lanes (Pipeline / Building / Validating / Stuck).
- **Drag and drop.** On drop the card moves immediately and, when the target
  lane needs a second field, a popover opens **on the dropped card** asking for
  just that field, with "Save move" and "Undo". Stuck requires `blocked_on`;
  Validating requires a UAT owner. Undo reverts the lane.
- A live "Drop to move here" placeholder and a pulsing border on the hovered
  lane.
- Lanes collapse to a 52px vertical strip; each lane has a `+` that creates a
  process directly into it; a toolbar Sort control orders every lane.

## Activity feed

Replaces `processes.notes` / `processes.blockers` as the editing surface.
Append-only, attributed, timestamped, newest first. The composer has a
Note/Blocker switch beside the send button — posting a blocker also flags the
record. Notes are deletable (soft). Field-change history is real but noisy, so
it sits **collapsed** below the feed, not interleaved. In the table, a row with
an open blocker shows a red "⚑ … · blocker note" line under the process name
that opens the record's thread.

## Roster picker

One control for FDE, TAM and Partner. Types ahead against `roster_entries`,
matches known aliases silently and shows why ("matched 'karthik n'"), and the
only path to a new value is an explicit "Add to roster" that creates a real
entry. Person avatars are circular, partner orgs are square.

## Configure

A gear in the toolbar opens one place for vocabularies, replacing "+ add new" in
every field. Four tabs:

- **Migration stages** and **Lifecycle states** — list current values, add new
  ones; a new value appears immediately in every dropdown and as a board lane.
- **Roster** — the canonical people/partner list.
- **Colours** — per-value colour assignment for Migration stage, Health and
  Lifecycle from an 8-hue palette, with Reset. Colours follow the value
  everywhere: table chips, board chips, lane dots.

## Colour and theme rules — do not regress these

Every one of these was a real bug caught in review:

- Chip colours come from **theme-aware hue tokens** (`--st-<hue>-fg/bg/bd`),
  never hardcoded RGB triples. Light values mirror the `.tone-*` classes already
  in `app/globals.css` (deep ink on a pale fill); dark values are pale ink on a
  tint. Same for the open-row highlight (`--row-open-bg`).
- Brand yellow has two roles: `--yellow` is a **fill** and always carries
  `#171717` text on top; `--yellow-ink` is anything that must be **read** and
  darkens to `#5F6B00` in light mode. Never use `--yellow` as a foreground.
- Every value-driven colour (health especially) must branch on the value. A
  hardcoded success palette on a health chip labels an at-risk process green.

## Layout rules — do not regress these

- Never animate `transform` on table rows: with `fill:both` the resolved
  identity matrix makes each row a containing block and any `position:fixed`
  popover inside it resolves against the row instead of the viewport. Animate
  opacity only.
- Any keyframe on a centred fixed element must include the centring in the
  keyframe (`translate(-50%, …)`), or it clobbers the inline transform.
- Toolbar control groups wrap; toggles are `flex-shrink:0`. A control must never
  silently chop its own label.
- One document-level handler dismisses every popover on outside click and on
  Escape; wrappers holding a trigger plus its menu are exempt.

## Motion

Rows fade in staggered; board cards rise on mount and lift on hover; lanes
animate their collapse; drop targets pulse; progress bars ease to new widths;
saved cells flash yellow; menus, dialogs and the toast rise in; the bulk bar
slides up centred; the split panel slides in from the right. Nothing bounces.

## Backend it sits on (Workstream A)

Assume these exist; if a migration is missing, write it in the house style of
`supabase/migrations/0021_processes_native.sql`, additive only, starting at the
next free number:

- soft delete — `deleted_at/deleted_by/deleted_reason`, `archiveProcess()` /
  `restoreProcess()`, `DELETE /api/processes/[id]`, `POST …/restore`. **Every
  one of the 8 files that queries `processes` directly outside `lib/processes/*`
  needs `.is("deleted_at", null)` in the same PR** — `lib/cache/integrations.ts`,
  `lib/dashboard/stats-drilldown.ts` (×2), `lib/delivery/loader.ts`,
  `lib/analytics/loader.ts`, `lib/reports/delivery-review-loader.ts`,
  `lib/reports/allhands-loader.ts` — or an archived row silently reappears in a
  dashboard stat or report.
- `process_notes` table + `lib/processes/notes.ts`, mirroring the latest note
  back into `processes.notes` / `.blockers` for legacy readers.
- `bulkUpdateProcesses` / `bulkArchiveProcesses` looping the single-row
  functions, partial-failure response, `PATCH /api/processes`.
- `loadV2MigrationOverview()` extended with a per-customer rollup
  `{customer_id, customer_display_name, migrated, total}[]`.
- `roster_entries` + `roster_aliases`, additive FK columns on `processes`
  alongside the text columns kept as a denormalized display mirror,
  `resolveOrCreateRosterEntry` in `updateProcess`, `mergeRosterEntries`,
  `GET/POST /api/roster`.
- `process_linear_tickets` join, `GET /api/linear-tickets/search?q=`,
  `POST/DELETE /api/processes/[id]/tickets`.

Cross-cutting rule: every new structured field mirrors back into the text column
it replaces, so nothing outside `lib/processes/*` needs to change.

## Explicitly out of scope

The `process_suggestions` inbound-automation system in
`docs/mockups/ia-step-1.5.html`. Editing is always a deliberate human action in
this pass.

## Not designed yet — do not invent

Saved views, row grouping, timeline/capacity, dependencies, phase templates,
notifications, automation rules, reporting parity. If the implementation feels
like it needs one of these, stop and ask.

## Files you will touch

- `app/(app)/delivery/delivery-client.tsx` — becomes the merged workspace
- `app/(app)/v2-migration/page.tsx` — redirect to `/delivery?section=v2`
- `app/_components/process-drawer.tsx` — delete, replaced by `process-detail.tsx`
- new: `app/_components/process-table.tsx`, `process-board.tsx`,
  `activity-feed.tsx`, `roster-picker.tsx`, `configure-dialog.tsx`,
  `bulk-action-bar.tsx`
- `app/_components/app-shell.tsx` — drop the V2 Migration nav item
- `lib/processes/store.ts`, `lib/processes/loader.ts`, `lib/supabase/types.ts`

## Verify before you push

1. `npm run build`, type-check, `vitest run` after each PR.
2. Against dev/staging Supabase only — never run destructive or bulk operations
   against production data. Create a process; bulk-archive two rows and confirm
   they disappear from Delivery, the dashboard and both reports alike; restore
   one; attach and detach a ticket; add and merge a roster entry and confirm
   `fde_owner` (text) and `fde_owner_id` stay in sync; post a note and confirm
   the legacy `notes` field still updates.
3. Toggle light mode and re-check every chip, the open row, and both `+`
   buttons — this is where the design regressed most often.
4. Widen the browser to 1440 and narrow it to ~900: the table must scroll rather
   than clip, sticky columns must hold at every scroll position, and the split
   panel must not squeeze the list below its floor.
5. Confirm the V2 rollup numbers match the All-Hands report row for row — the
   project's established gate for this data.
6. Confirm the Vercel deployment reaches READY after each push.
