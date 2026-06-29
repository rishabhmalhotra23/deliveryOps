# Delivery and V2 Migration — Company All Hands

**Week of June 29, 2026.** Migration tracker, Monday, and Linear (live).

## Delivery snapshot

| Metric | Value | Detail |
| --- | --- | --- |
| Live in production | **58** | 55 on V1 · 3 on V2 |
| In active development | **24** | 16 migrations · 7 net-new · 1 custom |
| Live or in progress | **102** | total delivered footprint |
| Enhancements delivered | **9** | on existing live processes |
| Queued | **20** | on hold or backlog |

## The V1 estate: migrate or retire

V1 is being decommissioned, so every live V1 process follows one of two paths: rebuilt on V2, or retired alongside V1. We migrate processes in active use and worth retaining, and retire those tied to departing accounts, no longer running, or not warranting a rebuild.

Of **75 processes tracked**: **45 migrate to V2**, **24 retire with V1**, **4 are already on V2**, and **2 are custom / off-platform**.

**Migrate to V2 (45)** — 19 at or near the finish line (complete, parity testing, or customer UAT):

| Stage | Count |
| --- | --- |
| Complete | 1 |
| Customer UAT | 7 |
| Parity testing | 11 |
| In build | 13 |
| Blocked | 13 |

Mitie narrowed to PCard only this week, so Invoice Registration Log and WIP moved to retire; Pepsi Fuzzy Matching also dropped from scope. JBI AP and JBI Merch stay in the blocked column even though their Linear tickets cleared, because the Epicor book upgrade is not yet visible in production to verify.

**Retire with V1 (24):** 14 lower priority or enhancement-only and not slated for rebuild, 6 on accounts churned, dropped, or under commercial review, 4 retired with no recent activity.

> **Open decision:** the lower-priority processes need a final migrate-or-retire call once the V1 end-of-life date is confirmed. Any still in active use move into migration scope and raise the count above 45.

The 75 processes are tracked in the migration tracker. The delivery board represents the same live V1 footprint as 55 cards because it groups sub-processes; the teams are consolidating to a single source.

## Path to v1 parity — all 45 by July 3

Every migration must reach v1 parity by July 3, the program deadline (this Friday). The interim dates through June 26 have passed: as of June 29, of those 29 items, 1 is complete, 7 are in customer UAT and 10 in parity testing (on track), while 5 are still in build and 6 are engineering-blocked. The remaining dated work lands July 1 and July 3. Items flagged ⚠ are engineering-blocked and must clear to hold the date.

| Cohort | Count | Items |
| --- | --- | --- |
| Past due · in flight | 29 | 1 complete, 7 customer UAT, 10 parity testing, 5 in build, 6 blocked ⚠ (JBI QSR, JBI SBUX, Wipro ITC, Scan Health Report; JBI Merch, JBI AP pending prod-verify) |
| Jul 1 | 6 | Scan Health Enrollment, Wipro Collection Acct, Wipro GP Vendor, Wipro BRS ⚠, Wipro DSPF SEZ, Wipro Tax Vouching |
| Jul 3 · deadline | 10 | Century × 2, iHeartRadio Affidavits, Pepsi ServiceNow, Conectiv ⚠, Kort Payments × 4 ⚠, Mitie PCard ⚠ |

Sharpest spots: Kort Payments, whose four processes are all engineering-blocked on browser automation and awaiting IP whitelisting from the customer against a Jul 10 renewal, and Wipro FSS, a large parity-testing cluster plus new large-file blockers against a Jun 30 renewal. Scan Health's download blocker ([KOG-11762](https://linear.app/kognitos/issue/KOG-11762)) and Wipro BRS ([OC-1364](https://linear.app/kognitos/issue/OC-1364)) both cleared this week.

## Net-new V2 development (not migration)

Greenfield V2 processes in active build. Further V2 builds are queued in the Projects pipeline, on-hold, and backlog. Updates summarized from Monday (active Projects board).

| Process | Owner | Phase | Latest update |
| --- | --- | --- | --- |
| Norco · Warranty | Karthik N. | M3 · UAT | On track; built on V2, awaiting customer support for QA. |
| Century · Accounting Ops | Rishabh M. | M3 · UAT | Off track; build complete but browser-automation connection drops (KOG-11840) and a fuzzy-matching dependency (ENG-4302) is open; customer charge-code access pending before UAT. |
| JBI · Receiving Process | Arushi B. | M2 · Dev | On track; development wrapping up, moving into testing. |
| JBI · Compass Quote Update | Arushi B. | M2 · Dev | Advanced from discovery; building against the live system, validating MFA. |
| JBI · Material Allocation Import | Arushi B. | Waiting for customer | Third-party access pending; SQL-DB approach under feasibility review. |
| TTX · Property Tax Outline | Ayush G. | M2 · Dev | New greenfield V2 build this cycle. |
| Charleston CSD · Workflow POV | Karthik N. | Waiting for customer | Skeleton built; awaiting customer data for end-to-end testing. |

## Renewals this quarter, and migration readiness

Approximately **$667K ARR** is up for renewal this quarter across four active accounts. Migration progress de-risks the renewal where it lands. Renewal health is the account-level field from the Monday Customers board, distinct from per-process migration readiness.

| Account | Renewal | Renewal health | Migration readiness |
| --- | --- | --- | --- |
| JBI | Jun 22 | Strong | On track; many flows in parity or customer UAT. AP and Merch tickets cleared in Linear, pending prod-verify of the Epicor upgrade. |
| Kort Payments | Jul 10 | Strong | Behind; all four processes still on V1, engineering-blocked on browser automation and awaiting IP whitelisting from the Kort team. |
| Wipro FSS | Jun 30 | Strong | At risk operationally; large estate, parity-testing cluster plus new large-file blockers; tightest spot against the renewal date. |
| Pepsi | Jun 30 | Moderate | In progress; ServiceNow rebuild in build, targeted for the Jul 3 deadline. |

**Accounts being dropped or under commercial review:**

| Account | Renewal | Renewal health | Status / decision |
| --- | --- | --- | --- |
| Ozark River | Jun 30 | Strong | Drop account; no migration, all V1 processes will be deactivated. |
| Builders Firstsource | Jul 30 | Critical | Drop account. |
| CSA Transport | Jul 30 | Evaluating | Partner-managed but no active work; drop account. |
| Halemeyer | Jun 30 | Strong | Drop account; no migration. |
| Bradley & Beams | Oct 30 | Strong | Potential drop; no migration. Customer on leave; will revisit if they accept V2 pricing, otherwise a small non-ICP account with no growth — drop. |
| Airborne | Nov 30 | Strong | In commercial discussion; RAG POC complete, customer happy, proposal ready. Old V1 processes won't be migrated (no longer used); final confirmation pending. |

## Not migrating: decisions and rationale

Processes we have decided not to rebuild on V2, with the reason. Source: migration tracker and Monday.

| Account / Process | Decision | Rationale |
| --- | --- | --- |
| Mitie · Invoice Reg. Log, WIP | Retire | Scope narrowed to PCard only (confirmed by customer); other two not migrating |
| ET Global | Not migrating | POV landed but customer stopped using the solution; account churned |
| Halemeyer · Bill Pay (+ enhancements) | Not migrating | Low ARR; account being dropped, under commercial review |
| Salesbricks | Not migrating | Low ARR; account being dropped, under commercial review |
| Ozark River · 2 processes | Not migrating | Processes being dropped |
| Pepsi · Fuzzy Matching | Not migrating | Not required as a standalone process |
| Bradley & Beams · tax recon, eng. letters | Defer / potential drop | Customer on leave; will discuss V2 pricing, otherwise small non-ICP account — drop |
| Wipro FSS · WTSL, GBL Zcop | Retire | No usage since 2024 / mid-2025 |
| Airborne · Invoice Processing | Retire | No recent V1 usage; RAG POC complete, in commercial discussion, final confirmation pending |
| JBI · Project Initiation Request (v1) | Retire | Superseded by the v2 rebuild |

## Migration blockers (live)

Tracked under the Linear label [v2 Migration Blockers](https://linear.app/kognitos/issue-label/v2%20migration%20blockers).

**Resolved since last update (4)** — each unblocking a named migration:

| Ticket | Item | Status |
| --- | --- | --- |
| [KOG-11762](https://linear.app/kognitos/issue/KOG-11762) | Scan Health — run-item download | Done Jun 25 |
| [OC-1364](https://linear.app/kognitos/issue/OC-1364) | Wipro BRS — build error | Done Jun 26 |
| [KOG-11812](https://linear.app/kognitos/issue/KOG-11812) | Century — browser pod connection | Done Jun 25 |
| [KOG-11820](https://linear.app/kognitos/issue/KOG-11820) | JBI — input too long in UI | Done Jun 25 |

JBI AP ([KOG-11810](https://linear.app/kognitos/issue/KOG-11810)) and JBI Merch ([INT-1476](https://linear.app/kognitos/issue/INT-1476)) closed earlier but stay listed as blocked until the Epicor book upgrade is visible in production to verify.

**Open — migration-critical (14):**

| Ticket | Item | Theme | Status |
| --- | --- | --- | --- |
| [KOG-11815](https://linear.app/kognitos/issue/KOG-11815) | Large-IDP processing gaps (JBI) | Scale & large files | Backlog |
| [KOG-11824](https://linear.app/kognitos/issue/KOG-11824) | JBI — parallel-IDP timeouts | Scale & large files | Backlog · P1 |
| [INT-1482](https://linear.app/kognitos/issue/INT-1482) | Wipro ITC — large-file transient errors | Scale & large files | Validation |
| [OC-1365](https://linear.app/kognitos/issue/OC-1365) | Wipro LCC — build iteration error | Complex-process build | Triage |
| [ENG-4297](https://linear.app/kognitos/issue/ENG-4297) | Wipro — Quill2 stuck on run | Complex-process build | Validation |
| [KOG-11844](https://linear.app/kognitos/issue/KOG-11844) | Conectiv — chat thread 500 errors | Platform & integrations | Backlog · P1 |
| [KOG-11845](https://linear.app/kognitos/issue/KOG-11845) | Conectiv — file upload over 50MB | Platform & integrations | Backlog · P1 |
| [KOG-11840](https://linear.app/kognitos/issue/KOG-11840) | Century — browser connection dropped | Platform & integrations | In Review |
| [ENG-4201](https://linear.app/kognitos/issue/ENG-4201) | Native email send | Platform & integrations | Backlog |
| [OC-1391](https://linear.app/kognitos/issue/OC-1391) | JBI — SFTP server connection | Account integrations | Triage |
| [OC-1395](https://linear.app/kognitos/issue/OC-1395) | iHeart — prompt too long | Account integrations | Triage |
| [OC-1359](https://linear.app/kognitos/issue/OC-1359) +2 | Mitie PCard — Coupa, Maximo, BCI | Account integrations | Triage |

## Key decision points

**1 · Subprocess and parallel execution.** Complex and high-volume processes (Wipro FSS, JBI batch IDP, Scan Health) need subprocess calls and parallel execution. V2 now supports parallel IDP extraction; broader subprocess calls and parallel execution are not yet native. Interim workaround: invoke a second draft over HTTP to emulate a subprocess or parallel branch; we should validate whether this reliably unblocks current work. **Decide:** adopt the HTTP workaround as the interim standard, or prioritize native support now.

**2 · IDP at scale: formats and fields.** Several processes need a distinct prompt per document type or format (Ciena PO, 200–300 formats; JBI AP), and some extract 400+ fields (Scan Health). Maintaining prompt libraries at this scale is unproven. The Assets / Collections feature lands this week. **Next:** assess how Assets / Collections changes the IDP build, maintain, and scale experience, then scope which gaps remain for migration. Reference: [KOG-11815](https://linear.app/kognitos/issue/KOG-11815) (v2 IDP gaps), [KOG-11824](https://linear.app/kognitos/issue/KOG-11824) (parallel-IDP timeouts), [ENG-4139](https://linear.app/kognitos/issue/ENG-4139) (IDP one-hour limit, in review).

**3 · Large-file throughput and reliability.** Large PDFs and Excel files (25MB+, up to 100–150MB and 120 pages) cause timeouts and transient errors; processing is sequential with no per-file isolation. Conectiv also hits a hard 50MB upload limit. Now supported: parallel IDP extraction; we are exploring extending it to parallel-file, then parallel-page extraction inside the Book, as an alternative to subprocess calls. Open: [KOG-11815](https://linear.app/kognitos/issue/KOG-11815), [INT-1482](https://linear.app/kognitos/issue/INT-1482), [KOG-11824](https://linear.app/kognitos/issue/KOG-11824), [KOG-11845](https://linear.app/kognitos/issue/KOG-11845). **Decide:** confirm the more scalable approach (parallel-file / parallel-page vs subprocess) from the testing now underway; tickets pending.

**4 · Integration gaps: email and platform connectors.** Department box is unblocked via Collections. The email approach is decided. Account-specific connectors (JBI SFTP, Conectiv chat) are the remaining gaps. **Decided:** a dedicated automation email account in production (a personal mailbox for testing). Remaining connector work is ticketed and in progress, no further decision needed for now. Reference: [ENG-4201](https://linear.app/kognitos/issue/ENG-4201) (native email), [OC-1391](https://linear.app/kognitos/issue/OC-1391) (JBI SFTP).

---

*Sources: migration tracker (75 processes), Linear label [v2 Migration Blockers](https://linear.app/kognitos/issue-label/v2%20migration%20blockers) (live, June 29), Monday Customers board (renewals and health, June 29). Migrate/retire split and parity dates are from the migration tracker as of June 29, 2026. Delivery footprint of 102 = 58 live + 24 in active development + 20 queued is carried from the June 22 Monday delivery-board pull. The migration scope of 45 is confirmed against a V1 end-of-life date still to be set.*
