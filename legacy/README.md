# `legacy/` — Curator port-from reference

**DO NOT DEPLOY — port-from reference only. DeliveryOps supersedes this Python service.**

This directory is a curated, read-only snapshot of the original Curator Python prototype. It exists so DeliveryOps engineers can port logic (tools, prompts, profile schema, ingestion pipeline, listeners, schedulers, slidebot) into the TypeScript / Next.js / Supabase stack with full fidelity. Nothing here is wired into the build, nothing here is deployable, and nothing here is the source of truth — DeliveryOps is.

Original repo: <https://github.com/rishabhmalhotra23/post-sales-customer-curator> (archived once Phase 1 lands).

## What's in here

| Path | Source | Purpose |
| --- | --- | --- |
| `brain/` | `curator/brain/` | Agent loop, tools, prompts, memory — port to `lib/agent/` |
| `storage/` | `curator/storage/` | Profile + internal profile schemas, events, rules, Gmail, Drive, conversations, OAuth, cache sync — port to `lib/supabase/` and `lib/integrations/google/` |
| `listeners/` | `curator/listeners/` | Slack + email listeners — port to `app/api/slack/events/` and `app/api/gmail/push/` |
| `ingestion/` | `curator/ingestion/` | Document pipeline, classifier, converters — port to `lib/ingestion/` (Claude vision replaces marker-pdf / pandoc / tesseract) |
| `scheduler/` | `curator/scheduler/` | APScheduler executor + task store — port to Vercel Cron + Inngest functions |
| `approvals/` | `curator/approvals/` | Email + action approval flows — port to Slack interactive routes |
| `slidebot/` | `curator/slidebot/` | Weekly update, metrics collector, deck generator — port to Phase 2 monthly digest + Phase 3 QBR generator |
| `web/static/index.html` | `curator/web/static/index.html` | The 2,500-line dashboard — UI **spec** to replicate in Lattice components, not to copy verbatim |
| `cursor-rules/` | `.cursor/rules/python-backend.mdc`, `design-system.mdc` | Original Cursor rules — context only; the active rules live in `.cursor/rules/` at repo root |

## Rules of engagement

1. **Never import from `legacy/` in production code.** TypeScript code under `app/`, `lib/`, `inngest/` must not reference this directory at runtime, build time, or test time.
2. **Never modify `legacy/` files** to "improve" them. If you need a change, port the function to TypeScript and edit it there.
3. **Cite when porting.** When you write a TS port, include a short comment pointing back to the Python source (e.g. `// port of curator/brain/tools.py:get_profile`).
4. **Schema parity matters.** `legacy/storage/profile.py::PROFILE_SCHEMA` and `::INTERNAL_PROFILE_SCHEMA` are the canonical shapes the Supabase tables mirror. If you change one, change the other.
5. **The dashboard HTML is a spec, not a target.** Replicate the information architecture and interaction patterns in Lattice components — do not copy the 2,500-line file into Next.js.

## Phase-out

Once Phase 2 ships and the pilot customer is fully migrated, this directory will be deleted in a single commit and the upstream Python repo archived. Until then, treat it as the canonical reference for "what does Curator currently do?".
