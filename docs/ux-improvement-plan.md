# DeliveryOps: UX gaps and improvement plan

Status: proposal for review. Nothing here is built yet. We tackle items one at a time after aligning on the plan. Audit is grounded in the page code and structure, not yet in a live visual pass.

---

## Part 1: Customer taxonomy and zones (decide this first)

### The problem
The category set has grown organically and now overlaps. We have At Risk, Upcoming Renewals, Strategic Growth, Secondary Priority (alias Active), Partner Managed, POV, To Drop, Past, Churned, and Dropped. Three of those (To Drop, Dropped, Churned, plus the catch-all Past) describe variations of "ending" and are easy to confuse. There is no state for an account we are actively reviewing for fit, which is exactly what the six accounts below are.

### Proposed model: four zones, each holding a few categories
Keep a single category per customer. Group categories into four named zones for display. This clarifies the muddle without a data-model change, and it gives the Customers page a scannable structure.

| Zone | Categories | Meaning |
|------|-----------|---------|
| Focus | Strategic Growth, Upcoming Renewals, At Risk, Secondary Priority, Partner Managed | The active book we are working. |
| Pipeline | POV | Proving value, not yet a committed customer. |
| Evaluation (new) | Evaluation | Under strategic review. Decision pending: keep, drop, or let lapse at renewal. Driven by the AI-in-Finance focus. |
| Closed | To Drop, Dropped, Churned, Past | No longer active, or on the way out. |

### The states that confuse, defined cleanly
- At Risk: relationship health risk. We want to save them. The risk is churn we do not want.
- Evaluation (new): we are deciding whether the account fits our focus. Outcome could be keep or exit. The risk is our choice, not their health.
- To Drop: decision already made to drop. Contract still live, exit happens at renewal.
- Dropped: we ended it. Voluntary on our side. Closed.
- Churned: they left or lapsed. Their decision or natural end. Closed.
- Past: legacy ambiguous bucket from Monday's combined "Churned/Dropped" label. Goal is to retire it by disambiguating each account into Dropped or Churned.

So the lifecycle of an exit reads: Evaluation (deciding) then To Drop (decided, not yet gone) then Dropped or Churned (gone).

### Where the six accounts go
Dish, Airborne, Ozark River, Halemeyer, Bradley & Beams, Hwyhawl move to Evaluation. They are under review for fit against the AI-in-Finance focus, not yet decided.

### Recommendation
1. Add "Evaluation" as a category value, with its own tone (a cool review tone, distinct from the warm To Drop and the gray Churned).
2. Add the four-zone grouping to the Customers page: zone headers with counts, collapsible, so the page becomes Focus / Pipeline / Evaluation / Closed instead of one long sorted list.
3. Retire "Past" over time by prompting disambiguation into Dropped or Churned during normal edits. Do not mass-migrate; let it drain.
4. Set the six accounts to Evaluation via `custom_category` (manual override). I will show the exact before-and-after for each before touching production.

Open question for you: should an account ever be in two zones at once (for example Evaluation and Upcoming Renewals because its renewal is near)? My default is no, one category wins, and Evaluation should outrank an imminent renewal in the precedence rules since the strategic decision comes first. Confirm and I will set precedence accordingly.

---

## Part 2: UX gaps, prioritized

### Tier 1, highest leverage

1. Customers has no search, filter, or sort. It is the main navigation surface and currently a flat alphabetical list inside each group. Add type-ahead search, zone and category filter chips, and sort by ARR or renewal urgency. This pairs directly with the zone work above.

2. Perceived load. Every page is force-dynamic and blocks on several parallel Supabase and Salesforce calls, so you see a blank gap then the whole page at once. Wrap heavy sections in Suspense with skeletons so the shell paints immediately. This is the biggest felt-speed win and beats any animation. (Felt-slow is an inference; TTFB not yet measured.)

3. Dashboard empty state. The dashboard is six to nine conditional sections that vanish when empty, so a quiet day looks bare or broken. Add a deliberate "all caught up" state.

### Tier 2

4. Inline AE and partner edits save to production on change, with no confirm and no undo. On real customer records that is a footgun. Add an undo toast.

5. Analytics and Reports are long single columns (2000px plus) with no in-page navigation. Add a sticky jump-to-section bar or make sections collapsible.

6. Customer detail crams eight tabs into a wrapping row and stacks everything under Overview. Consolidate tabs and consider a denser Overview.

7. Motion consistency. The reveal and count-up motion now lives only on the dashboard. Delivery and Analytics use the same StatBlock but stay static. Extend the same vocabulary so the app does not feel half-animated. (This is the "tie it together" goal from earlier.)

### Deliberately not doing

- Mobile-first polish. This reads as an internal desktop tool. Unless FDEs actually use it on phones, mobile is low ROI. Confirm usage before we invest. (Usage is a guess.)
- A customize-dashboard settings panel with section toggles. Adds config surface for a small team. A good default order beats a preferences screen.

---

## Part 3: Suggested sequence

Phase 0: agree taxonomy and zones (Part 1). Set the six accounts to Evaluation.

Phase 1: Customers search, filter, sort, and zone grouping. One surface, highest daily payoff. Mock first, then build.

Phase 2: Skeleton and streaming load states across the data-heavy pages.

Phase 3: Dashboard empty state, then the undo toast for inline edits.

Phase 4: Long-page navigation for Analytics and Reports, motion consistency, tab cleanup on customer detail.

Each phase ships independently. Within each, I show a mockup for approval before editing code, per the project rule.

---

## Open questions
1. Can an account be in two zones at once, or does one category always win? (My default: one wins, Evaluation outranks imminent renewal.)
2. Do FDEs use this on mobile at all?
3. Is there a real felt-slowness today, or do pages load fast enough that skeletons are cosmetic? This changes Phase 2's priority.
