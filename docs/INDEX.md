# DeliveryOps docs index

A map of every doc so a new session (or engineer) knows what to read.

| Doc | What it is | Updated |
|---|---|---|
| [MONDAY-DECOMMISSION-LOG.md](./MONDAY-DECOMMISSION-LOG.md) | Running cross-session tracker for retiring Monday: real current state, phase checklist, decisions made, session log. **Read this first if you are working the decommission.** | 2026-07-30 |
| [DELIVERYOPS-CONSOLIDATION-PLAN.md](./DELIVERYOPS-CONSOLIDATION-PLAN.md) | Current plan: retire Monday, build the native process table, drive adoption, then agents. What already exists, the blockers, phased plan, open decisions. Start here. | 2026-07-22 |
| [STATUS.md](./STATUS.md) | Current-state snapshot: what is live, what the 2026-07-22 audit found, what is still blocked. | 2026-07-22 |
| [VISION.md](./VISION.md) | Long-form why: one customer, one source of truth, one agent. The doc to send a stakeholder. | 2026-05-26 |
| [../README.md](../README.md) | Product plus wiring overview and the route table. | 2026-05-26 |
| [RUNBOOK.md](./RUNBOOK.md) | Operational runbook. | 2026-05-21 |
| [GOOGLE_SETUP_PLAN.md](./GOOGLE_SETUP_PLAN.md) | Google Workspace OAuth setup (Gmail/Drive/Calendar scopes). | 2026-05-21 |
| [CREDENTIALS.md](./CREDENTIALS.md) | Integration credentials and scopes. | 2026-05-26 |
| [supabase-schema-full.sql](./supabase-schema-full.sql) | Full schema dump, migrations 0001 to 0019. | 2026-05-26 |
| [ux-improvement-plan.md](./ux-improvement-plan.md) | UX improvement notes. | 2026-06-11 |
| `../monday-backup/` | Legacy ad-hoc Monday snapshot: 492-board inventory plus 6 boards. Missing column definitions, updates and relation links, so status labels cannot be decoded from it. Superseded by the dated backups. Gitignored (real customer data). | 2026-07-22 |
| `../monday-backup-<date>/` | Full-fidelity Monday archive produced by `scripts/monday-full-backup.ts`. Read its `SUMMARY.md` and `_manifest.json` first. Gitignored (real customer data). | per run |

Repo entry point for Claude: [../CLAUDE.md](../CLAUDE.md).
