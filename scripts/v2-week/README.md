# Weekly V2 migration report — build script (OBSOLETE)

> **Obsolete as of 2026-08-07 — do not run `npm run build:v2-week`.**
>
> This script generated `lib/reports/weeks/<week>.generated.ts`, typed against
> `lib/reports/v2-allhands-weeks.ts`. That registry file no longer exists, and
> neither does the hand-maintained All-Hands report it fed:
> `/reports/v2-migration` was rebuilt to read `processes` and `linear_tickets`
> live from Supabase (`lib/reports/allhands-loader.ts`), so there is no weekly
> Excel-upload step any more and nothing consumes this script's output. Running
> it now writes a file that imports a deleted module and won't typecheck.
>
> The rest of this README is kept for one reason: `parse-tracker.mjs`'s
> stage-from-dates rules (documented below) are the only written record of how
> the migration-tracker Excel was interpreted, and they're still a useful
> reference if that spreadsheet ever needs reconciling against `processes`.

The original workflow was "upload the Excel + skim," not hand-typing numbers:

```
npm install                       # once — adds xlsx
npm run build:v2-week -- --xlsx "v2-migration-data/V2 Migration List.xlsx" --week 2026-07-13
```

## Where each number comes from

| Section | Source | Auto? |
|---|---|---|
| Estate split, stage board, journey finish/blocked | **migration tracker Excel** (`Working Sheet`) | ✅ on upload |
| Open backlog, velocity windows, ticket groups | **`linear_tickets`** Supabase table (already synced + Claude-classified) | ✅ live |
| Snapshot, net-new, push, decisions, platform issues, journey history/labels | **`v2-week-narrative.json`** | ✍️ hand-edited |

Reads Supabase with the app's own env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`). If that read fails, it falls back to `narrative.ticketFallback` so the run still completes.

## Stage is derived from DATES, not the status column

The status field lags — a process marked "engg pending" can already have a customer-handover date this week. Stage precedence: Completed → Blocked (has a blocker, no handover) → Starting UAT this week (handover in the next 7 days) → In customer UAT (handover past / validation / "Customer pending") → Parity testing (parity date reached). Near-finish = everything except Blocked.

## Keep the Excel clean — the script is only as good as it

- **Blockers column is the source of truth for "Blocked."** A process only shows blocked if its blocker text is in that cell. Example: Mitie PCard is blocked on the v2 UK instance, but that isn't written in the Excel yet, so the script leaves it in Parity. Add it to the cell.
- **"Starting UAT this week" is date-strict** (handover within 7 days of the report date). Processes that handed over the prior week read as already in UAT. That is why the current run shows 11 starting this week (9 Wipro on Jul 15 + JBI Merch + Onsite) rather than 13 — Wipro GP Vendor and DSPF handed over Jul 10. Widen the window in `parse-tracker.mjs` (`WEND`) if you want the whole cluster grouped together.
- Each row's `Date - parity test complete / Customer handover / Customer validation complete` drive the stage; keep them current.

The script writes `<week>.audit.json` next to the output listing every process, its dates, and the stage it was placed in — check it if a count looks off.

## Not yet automated (phase 2)

Monday-sourced bits (the snapshot's active/queued cells and the net-new table) are hand-maintained in the narrative JSON. They can be auto-pulled from the existing `lib/reports/weekly-loader.ts` (Monday → Supabase) in a follow-up.
