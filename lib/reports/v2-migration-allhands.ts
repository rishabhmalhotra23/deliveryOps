// V2 Migration — All Hands report data.
//
// CURATED SNAPSHOT (signed off 2026-06-29). These figures are a point-in-time
// pull from the migration tracker (the 75-process Excel) + Linear (label "v2
// Migration Blockers", live) + Monday (Customers board for renewals/health).
// This is deliberately NOT yet a live pull — the live wiring (Linear sync,
// renewal/ARR fields, a home for the tracker) is follow-on work. To refresh
// weekly, update the constants below.
//
// Keep colours as literal hexes: these encode migration stages and are the
// same in light/dark mode by design.

export const REPORT_DATE_LABEL = "Week of June 29, 2026";
export const LINEAR_ISSUE = (id: string) => `https://linear.app/kognitos/issue/${id}`;
export const LINEAR_BLOCKER_LABEL =
  "https://linear.app/kognitos/issue-label/v2%20migration%20blockers";

export interface SnapshotMetric {
  value: string;
  label: string;
  sub: string;
  hero?: boolean;
}
export const SNAPSHOT: SnapshotMetric[] = [
  { value: "58", label: "Live in production", sub: "55 on V1 · 3 on V2" },
  { value: "24", label: "In active development", sub: "16 migrations · 7 net-new · 1 custom" },
  { value: "102", label: "Live or in progress", sub: "total delivered footprint", hero: true },
  { value: "9", label: "Enhancements delivered", sub: "on existing live processes" },
  { value: "20", label: "Queued", sub: "on hold or backlog" },
];

export interface FunnelStage { label: string; count: number; color: string; }
export const MIGRATE_FUNNEL: FunnelStage[] = [
  { label: "Complete", count: 1, color: "#1D9E75" },
  { label: "Customer UAT", count: 7, color: "#5BC4A0" },
  { label: "Parity testing", count: 11, color: "#378ADD" },
  { label: "In build", count: 13, color: "#EF9F27" },
  { label: "Blocked", count: 13, color: "#E24B4A" },
];
export const MIGRATE_FINISH_HEADLINE = "19 at or near the finish line (complete, parity testing, or customer UAT)";

export const ESTATE_SPLIT: FunnelStage[] = [
  { label: "Migrate to V2", count: 45, color: "#185FA5" },
  { label: "Retire with V1", count: 24, color: "#888780" },
  { label: "Already on V2", count: 4, color: "#1D9E75" },
  { label: "Custom / off-platform", count: 2, color: "#534AB7" },
];

export const RETIRE_BREAKDOWN: { label: string; count: number }[] = [
  { label: "Lower priority or enhancement-only, not slated for rebuild", count: 14 },
  { label: "Account churned, dropped, or under commercial review", count: 6 },
  { label: "Retired, no recent activity", count: 4 },
];

export const ESTATE_INTRO =
  "V1 is being decommissioned, so every live V1 process follows one of two paths: rebuilt on V2, or retired alongside V1. We migrate processes in active use and worth retaining, and retire those tied to departing accounts, no longer running, or not warranting a rebuild.";
export const ESTATE_FINISH_NOTE =
  "Mitie narrowed to PCard only this week, so Invoice Registration Log and WIP moved to retire; Pepsi Fuzzy Matching also dropped from scope. JBI AP and JBI Merch stay in the blocked column even though their Linear tickets cleared, because the Epicor book upgrade is not yet visible in production to verify.";
export const ESTATE_OPEN_DECISION =
  "Open decision: the lower-priority processes need a final migrate-or-retire call once the V1 end-of-life date is confirmed. Any still in active use move into migration scope and raise the count above 45.";
export const ESTATE_SOURCE_NOTE =
  "These 75 processes are tracked in the migration tracker. The delivery board represents the same live V1 footprint as 55 cards because it groups sub-processes; the teams are consolidating to a single source.";

// What's next — v1-parity runway as of June 29 (interim dates Jun 16–26 have passed).
export const PARITY_HEADLINE =
  "Every migration must reach v1 parity by July 3, the program deadline, this Friday. The interim dates through June 26 have passed: as of June 29, of those 29 items, 1 is complete, 7 are in customer UAT and 10 in parity testing (on track), while 5 are still in build and 6 are engineering-blocked. The remaining dated work lands July 1 and July 3. Items flagged ⚠ are engineering-blocked and must clear to hold the date.";

export interface ParitySeg { t: string; c?: string; }
export const PARITY_PASTDUE: { label: string; count: number; lines: ParitySeg[][]; blocked: string } = {
  label: "Past due · in flight",
  count: 29,
  lines: [
    [{ t: "1 complete", c: "#1D9E75" }, { t: " · 7 customer UAT · 10 parity testing" }],
    [{ t: "5 in build · " }, { t: "6 engineering-blocked ⚠", c: "#B91C1C" }],
  ],
  blocked: "Blocked: JBI QSR, JBI SBUX, Wipro ITC, Scan Health Report; JBI Merch, JBI AP (tickets cleared, prod-verify pending).",
};

export interface ParityCohort { label: string; count: number; deadline?: boolean; items: { name: string; blocked?: boolean }[]; }
export const PARITY_UPCOMING: ParityCohort[] = [
  { label: "Jul 1", count: 6, items: [
    { name: "Scan Health · Enrollment" }, { name: "Wipro · Collection Acct" }, { name: "Wipro · GP Vendor" },
    { name: "Wipro · BRS", blocked: true }, { name: "Wipro · DSPF SEZ" }, { name: "Wipro · Tax Vouching" } ] },
  { label: "Jul 3 · deadline", count: 10, deadline: true, items: [
    { name: "Century × 2" }, { name: "iHeartRadio · Affidavits" }, { name: "Pepsi · ServiceNow" },
    { name: "Conectiv", blocked: true }, { name: "Kort Payments × 4", blocked: true }, { name: "Mitie · PCard", blocked: true } ] },
];
export const PARITY_FOOTNOTE =
  "Sharpest spots: Kort Payments, whose four processes are all engineering-blocked on browser automation and awaiting IP whitelisting from the customer against a Jul 10 renewal, and Wipro FSS, a large parity-testing cluster plus new large-file blockers against a Jun 30 renewal. Wipro BRS (OC-1364) cleared this week; Scan Health's download blocker (KOG-11762) is still in review, not yet closed.";

export interface DevRow { process: string; owner: string; phase: string; update: string; }
export const NET_NEW: DevRow[] = [
  { process: "Norco · Warranty", owner: "Karthik N.", phase: "M3 · UAT", update: "On track; built on V2, awaiting customer support for QA." },
  { process: "Century · Accounting Ops", owner: "Rishabh M.", phase: "M3 · UAT", update: "Off track; development is complete and UAT is stuck due to a browser-automation connection drop (KOG-11840) and slowness issues. Tickets are in progress. Once resolved we'll continue with UAT." },
  { process: "JBI · Receiving Process", owner: "Arushi B.", phase: "M2 · Dev", update: "On track; development wrapping up, moving into testing." },
  { process: "JBI · Compass Quote Update", owner: "Arushi B.", phase: "M2 · Dev", update: "Advanced from discovery; building against the live system, validating MFA." },
  { process: "JBI · Material Allocation Import", owner: "Arushi B.", phase: "Waiting for customer", update: "Third-party access pending; SQL-DB approach under feasibility review." },
  { process: "TTX · Property Tax Outline", owner: "Ayush G.", phase: "M2 · Dev", update: "New greenfield V2 build this cycle." },
  { process: "Charleston CSD · Workflow POV", owner: "Karthik N.", phase: "Waiting for customer", update: "Skeleton built; awaiting customer data for end-to-end testing." },
];
export const NET_NEW_NOTE = "Greenfield V2 processes in active build. Further V2 builds are queued in the Projects pipeline, on-hold, and backlog. Updates summarized from Monday (active Projects board).";

export type Tone = "strong" | "watch" | "risk";
export interface RenewalRow { account: string; renewal: string; health: string; tone: Tone; readiness: string; }
export const RENEWALS_ACTIVE: RenewalRow[] = [
  { account: "JBI", renewal: "Jun 22", health: "Strong", tone: "strong", readiness: "On track; many flows in parity or customer UAT. AP and Merch tickets cleared in Linear, pending prod-verify of the Epicor upgrade." },
  { account: "Kort Payments", renewal: "Jul 10", health: "Strong", tone: "strong", readiness: "Behind; all four processes still on V1, engineering-blocked on browser automation and awaiting IP whitelisting from the Kort team." },
  { account: "Wipro FSS", renewal: "Jun 30", health: "Strong", tone: "strong", readiness: "At risk operationally; large estate, parity-testing cluster plus new large-file blockers; tightest spot against the renewal date." },
  { account: "Pepsi", renewal: "Jun 30", health: "Moderate", tone: "watch", readiness: "In progress; ServiceNow rebuild in build, targeted for the Jul 3 deadline." },
];
export const RENEWALS_HEADLINE = "Approximately $667K ARR is up for renewal this quarter across four active accounts. Migration progress de-risks the renewal where it lands. Renewal health is the account-level field from the Monday Customers board, distinct from per-process migration readiness.";

export interface DropRow { account: string; renewal: string; health: string; tone: Tone; note: string; }
export const RENEWALS_DROPPING: DropRow[] = [
  { account: "Ozark River", renewal: "Jun 30", health: "Strong", tone: "strong", note: "Drop account; no migration, all V1 processes will be deactivated." },
  { account: "Builders Firstsource", renewal: "Jul 30", health: "Critical", tone: "risk", note: "Drop account." },
  { account: "CSA Transport", renewal: "Jul 30", health: "Evaluating", tone: "watch", note: "Partner-managed but no active work; drop account." },
  { account: "Halemeyer", renewal: "Jun 30", health: "Strong", tone: "strong", note: "Drop account; no migration." },
  { account: "Bradley & Beams", renewal: "Oct 30", health: "Strong", tone: "strong", note: "Potential drop; no migration. Customer on leave; will revisit if they accept V2 pricing, otherwise a small non-ICP account with no growth — drop." },
  { account: "Airborne", renewal: "Nov 30", health: "Strong", tone: "strong", note: "In commercial discussion; RAG POC complete, customer happy, proposal ready. Old V1 processes won't be migrated (no longer used); final confirmation pending." },
];

export interface NotMigratingRow { item: string; decision: string; rationale: string; }
export const NOT_MIGRATING: NotMigratingRow[] = [
  { item: "Mitie · Invoice Reg. Log, WIP", decision: "Retire", rationale: "Scope narrowed to PCard only (confirmed by customer); other two not migrating" },
  { item: "ET Global", decision: "Not migrating", rationale: "POV landed but customer stopped using the solution; account churned" },
  { item: "Halemeyer · Bill Pay (+ enhancements)", decision: "Not migrating", rationale: "Low ARR; account being dropped, under commercial review" },
  { item: "Salesbricks", decision: "Not migrating", rationale: "Low ARR; account being dropped, under commercial review" },
  { item: "Ozark River · 2 processes", decision: "Not migrating", rationale: "Processes being dropped" },
  { item: "Pepsi · Fuzzy Matching", decision: "Not migrating", rationale: "Not required as a standalone process" },
  { item: "Bradley & Beams · tax recon, eng. letters", decision: "Defer / potential drop", rationale: "Customer on leave; will discuss V2 pricing, otherwise small non-ICP account — drop" },
  { item: "Wipro FSS · WTSL, GBL Zcop", decision: "Retire", rationale: "No usage since 2024 / mid-2025" },
  { item: "Airborne · Invoice Processing", decision: "Retire", rationale: "No recent V1 usage; RAG POC complete, in commercial discussion, final confirmation pending" },
  { item: "JBI · Project Initiation Request (v1)", decision: "Retire", rationale: "Superseded by the v2 rebuild" },
];

export interface BlockerRow { id: string; item: string; status: string; theme?: string; tone?: "done" | "prog" | "open"; }
export const BLOCKERS_RESOLVED: BlockerRow[] = [
  { id: "OC-1364", item: "Wipro BRS — build error", status: "Done Jun 26" },
  { id: "KOG-11812", item: "Century — browser pod connection", status: "Done Jun 25" },
  { id: "KOG-11820", item: "JBI — input too long in UI", status: "Done Jun 25" },
];
export const BLOCKERS_RESOLVED_NOTE = "Closed this week, each unblocking a named migration.";
export const BLOCKERS_RESOLVED_FOOTNOTE =
  "JBI AP (KOG-11810) and JBI Merch (INT-1476) closed earlier but stay listed as blocked until the Epicor book upgrade is visible in production to verify.";
export const BLOCKERS_OPEN: BlockerRow[] = [
  { id: "KOG-11815", item: "Large-IDP processing gaps (JBI)", theme: "Scale & large files", status: "Backlog", tone: "open" },
  { id: "KOG-11824", item: "JBI — parallel-IDP timeouts", theme: "Scale & large files", status: "Backlog · P1", tone: "open" },
  { id: "INT-1482", item: "Wipro ITC — large-file transient errors", theme: "Scale & large files", status: "Validation", tone: "prog" },
  { id: "OC-1365", item: "Wipro LCC — build iteration error", theme: "Complex-process build", status: "Triage", tone: "open" },
  { id: "ENG-4297", item: "Wipro — Quill2 stuck on run", theme: "Complex-process build", status: "Validation", tone: "prog" },
  { id: "ENG-3827", item: "Ciena PO — Python migration strategy decision", theme: "Complex-process build", status: "Backlog", tone: "open" },
  { id: "MAN-3712", item: "MCP agent-build feedback (internal tooling, non-customer)", theme: "Complex-process build", status: "Validation", tone: "prog" },
  { id: "KOG-11844", item: "Conectiv — chat thread 500 errors", theme: "Platform & integrations", status: "Backlog · P1", tone: "open" },
  { id: "KOG-11845", item: "Conectiv — file upload over 50MB", theme: "Platform & integrations", status: "Backlog · P1", tone: "open" },
  { id: "KOG-11840", item: "Century — browser connection dropped", theme: "Platform & integrations", status: "In Review", tone: "prog" },
  { id: "ENG-4201", item: "Native email send", theme: "Platform & integrations", status: "Backlog", tone: "open" },
  { id: "ENG-4302", item: "Century — fuzzy matching for collections (due Jul 1)", theme: "Platform & integrations", status: "In Review", tone: "prog" },
  { id: "KOG-11828", item: "TTX — V2 internal error on draft", theme: "Platform & integrations", status: "In Review", tone: "prog" },
  { id: "OC-1370", item: "TTX — Collections prod availability timeline", theme: "Platform & integrations", status: "Triage", tone: "open" },
  { id: "OC-1391", item: "JBI — SFTP server connection", theme: "Account integrations", status: "Triage", tone: "open" },
  { id: "OC-1395", item: "iHeart — prompt too long", theme: "Account integrations", status: "Triage", tone: "open" },
  { id: "OC-1359", item: "Mitie PCard — Coupa, Maximo, BCI (+2)", theme: "Account integrations", status: "Triage", tone: "open" },
  { id: "KOG-11842", item: "Mitie — needs UK instance of V2", theme: "Account integrations", status: "Backlog", tone: "open" },
  { id: "KOG-11832", item: "JBI — can't preview run output", theme: "UI & run experience", status: "In Progress", tone: "prog" },
  { id: "KOG-11762", item: "Scan Health — can't download all run items", theme: "UI & run experience", status: "In Review", tone: "prog" },
  { id: "KOG-11838", item: "Century — no browser action/video on exception", theme: "UI & run experience", status: "Backlog", tone: "open" },
];

export interface DecisionPoint { title: string; context: string; workaround: string; decide: string; verb?: string; refs: string[]; }
export const DECISIONS: DecisionPoint[] = [
  {
    title: "1 · Subprocess and parallel execution",
    context: "Complex and high-volume processes (Wipro FSS, JBI batch IDP, Scan Health) need subprocess calls and parallel execution. V2 now supports parallel IDP extraction; broader subprocess calls and parallel execution are not yet native.",
    workaround: "Interim workaround: invoke a second draft over HTTP to emulate a subprocess or parallel branch; we should validate whether this reliably unblocks current work.",
    decide: "adopt the HTTP workaround as the interim standard, or prioritize native subprocess and parallel support now.",
    refs: [],
  },
  {
    title: "2 · IDP at scale: formats and fields",
    context: "Several processes need a distinct prompt per document type or format (Ciena PO, 200–300 formats; JBI AP), and some extract 400+ fields (Scan Health). Authoring and maintaining prompt libraries at this scale is unproven.",
    workaround: "Today: works for small prompt sets; effort grows with every new format. The Assets / Collections feature lands this week.",
    decide: "assess how Assets / Collections changes the IDP build, maintain, and scale experience, then scope which gaps remain for migration.",
    verb: "Next",
    refs: ["KOG-11815", "KOG-11824", "ENG-4139"],
  },
  {
    title: "3 · Large-file throughput and reliability",
    context: "Large PDFs and Excel files (25MB+, up to 100–150MB and 120 pages) cause timeouts and transient errors; processing is sequential with no per-file isolation. Conectiv also hits a hard 50MB upload limit.",
    workaround: "Now supported: parallel IDP extraction. Exploring extending it to parallel-file, then parallel-page extraction inside the Book, as an alternative to subprocess calls.",
    decide: "confirm the more scalable approach (parallel-file / parallel-page vs subprocess) from the testing now underway; tickets pending.",
    refs: ["KOG-11815", "INT-1482", "KOG-11824", "KOG-11845"],
  },
  {
    title: "4 · Integration gaps: email and platform connectors",
    context: "Department box is unblocked via Collections. The email approach is decided. Account-specific connectors (JBI SFTP, Conectiv chat) are the remaining gaps.",
    workaround: "Decided: a dedicated automation email account in production (a personal mailbox for testing). Remaining connector gaps have tickets in progress.",
    decide: "email resolved via the dedicated-mailbox standard; remaining connector work is ticketed and in progress, no further decision needed for now.",
    verb: "Status",
    refs: ["ENG-4201", "OC-1391"],
  },
];

export const SOURCES_NOTE =
  "Sources: migration tracker (75 processes) · Linear label v2 Migration Blockers (live, June 29) · Monday Customers board (renewals and health, June 29). Migrate/retire split and parity dates are from the migration tracker as of June 29, 2026. Delivery footprint of 102 = 58 live + 24 in active development + 20 queued is carried from the June 22 Monday delivery-board pull. The migration scope of 45 is confirmed against a V1 end-of-life date still to be set.";
