# DeliveryOps docs index

A map of every doc so a new session (or engineer) knows what to read.

| Doc | What it is | Updated |
|---|---|---|
| [MONDAY-DECOMMISSION-LOG.md](./MONDAY-DECOMMISSION-LOG.md) | Running cross-session tracker for retiring Monday: real current state, phase checklist, decisions made, session log. **Read this first if you are working the decommission.** | 2026-08-03 |
| [PROCESSES-SCHEMA-PROPOSAL.md](./PROCESSES-SCHEMA-PROPOSAL.md) | The native `processes` schema: DDL, the Monday-to-native derivation mapping with row counts, the 146-row import plan, and the companion `process_suggestions` / `nps_responses` / customer-field specs. Shipped as migration 0021. | 2026-08-03 |
| [mockups/platform-vision.html](./mockups/platform-vision.html) | **The approved IA.** Five-view walkthrough of the whole platform: the one-liner, the platform map, how a process moves through the three views, the two user journeys, and the decision list. Open in a browser. | 2026-08-03 |
| [mockups/ia-step-1.5.html](./mockups/ia-step-1.5.html) | Detail and evidence behind the IA: the two IA options with the data that decided them, field-by-field homes for migration 0021, the process edit drawer, the Active board, the customer 360. | 2026-08-03 |
| [DELIVERYOPS-CONSOLIDATION-PLAN.md](./DELIVERYOPS-CONSOLIDATION-PLAN.md) | Original plan: retire Monday, build the native process table, drive adoption, then agents. Historical — the Monday-for-reporting retirement it describes is done; see STATUS.md for current state. | 2026-07-22 |
| [STATUS.md](./STATUS.md) | Current-state snapshot: what is live (two native reports, Monday retired for reporting), what's still open, what's next. **Start here for current state.** | 2026-08-10 |
| [VISION.md](./VISION.md) | Long-form why: one customer, one source of truth, one agent. The doc to send a stakeholder. | 2026-05-26 |
| [../README.md](../README.md) | Product plus wiring overview and the route table. | 2026-05-26 |
| [RUNBOOK.md](./RUNBOOK.md) | Operational runbook. | 2026-05-21 |
| [GOOGLE_SETUP_PLAN.md](./GOOGLE_SETUP_PLAN.md) | Google Workspace OAuth setup (Gmail/Drive/Calendar scopes). | 2026-05-21 |
| [CREDENTIALS.md](./CREDENTIALS.md) | Integration credentials and scopes. | 2026-05-26 |
| [supabase-schema-full.sql](./supabase-schema-full.sql) | Full schema dump, migrations 0001 to 0019. **Stale**: does not include 0020 or 0021. Regenerate before trusting it. | 2026-05-26 |
| [ux-improvement-plan.md](./ux-improvement-plan.md) | UX improvement notes. | 2026-06-11 |
| `../monday-backup/` | Legacy ad-hoc Monday snapshot: 492-board inventory plus 6 boards. Missing column definitions, updates and relation links, so status labels cannot be decoded from it. Superseded by the dated backups. Gitignored (real customer data). | 2026-07-22 |
| `../monday-backup-<date>/` | Full-fidelity Monday archive produced by `scripts/monday-full-backup.ts`. Read its `SUMMARY.md` and `_manifest.json` first. Gitignored (real customer data). | per run |

Repo entry point for Claude: [../CLAUDE.md](../CLAUDE.md).
