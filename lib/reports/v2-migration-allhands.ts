// V2 Migration — All Hands report data.
//
// CURATED SNAPSHOT (signed off 2026-06-22). These figures are a point-in-time
// pull from Monday (delivery + Customers boards) + Linear (label "v2 Migration
// Blockers") + the migration tracker sheet, hand-assembled for the All Hands
// update. This is deliberately NOT yet a live pull — the live wiring (Linear
// sync, renewal/ARR fields, a home for the 74-process tracker) is follow-on
// work. To refresh weekly, update the constants below.
//
// Keep colours as literal hexes: these encode migration stages and are the
// same in light/dark mode by design.

export const REPORT_DATE_LABEL = "Week of June 22, 2026";
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
  { label: "Parity testing", count: 9, color: "#378ADD" },
  { label: "In build", count: 27, color: "#EF9F27" },
  { label: "Blocked", count: 10, color: "#E24B4A" },
];
export const MIGRATE_FINISH_HEADLINE = "10 at or near the finish line (complete or in parity testing)";

export const ESTATE_SPLIT: FunnelStage[] = [
  { label: "Migrate to V2", count: 47, color: "#185FA5" },
  { label: "Retire with V1", count: 21, color: "#888780" },
  { label: "Already on V2", count: 4, color: "#1D9E75" },
  { label: "Custom / off-platform", count: 2, color: "#534AB7" },
];

export const RETIRE_BREAKDOWN: { label: string; count: number }[] = [
  { label: "Lower priority, not slated for rebuild", count: 12 },
  { label: "Account churned or under commercial review", count: 6 },
  { label: "Retired, no recent activity", count: 3 },
];

export const ESTATE_INTRO =
  "V1 is being decommissioned, so every live V1 process follows one of two paths: rebuilt on V2, or retired alongside V1. We migrate processes in active use and worth retaining, and retire those tied to departing accounts, no longer running, or not warranting a rebuild.";
export const ESTATE_FINISH_NOTE =
  "Conectiv and Norco Parts Reconciliation moved into active build this week, so there is no longer a not-started or UAT item. Blocked is 10 in the tracker; JBI Merch and JBI AP are already cleared in Linear and will move as the tracker catches up.";

// What's next — v1-parity target dates (from the migration tracker).
export interface ParityDay { day: string; date: string; count: number; items: { name: string; blocked?: boolean }[]; }
export const PARITY_HEADLINE =
  "Every migration must reach v1 parity by July 3, the program deadline. One is already complete, 28 are dated this week (Jun 23–26), and the remaining 18 land by July 3. Items flagged ⚠ are engineering-blocked and must clear to hold the date; several blockers already cleared in Linear this week.";
export const PARITY_TIMELINE: ParityDay[] = [
  { day: "Tue", date: "Jun 23", count: 7, items: [
    { name: "JBI · QSR" }, { name: "JBI · SBUX" }, { name: "Plunkett · Create Payments" },
    { name: "Plunkett · Claim RA" }, { name: "TTX · Brake AR" },
    { name: "Wipro · ITC", blocked: true }, { name: "Wipro · LCC", blocked: true } ] },
  { day: "Wed", date: "Jun 24", count: 6, items: [
    { name: "JBI · Design Mtg" }, { name: "JBI · PIR v2" }, { name: "Plunkett · Sales Order" },
    { name: "Plunkett · Vendor Bill" }, { name: "Wipro · DSPF SEZ" }, { name: "Wipro · Tax Vouching" } ] },
  { day: "Thu", date: "Jun 25", count: 7, items: [
    { name: "Ciena · PO" }, { name: "TTX · AP", blocked: true }, { name: "TTX · COA", blocked: true },
    { name: "TTX · Goods Receipt", blocked: true }, { name: "Wipro · Collection Acct" },
    { name: "Wipro · GP Vendor" }, { name: "Wipro · BRS", blocked: true } ] },
  { day: "Fri", date: "Jun 26", count: 8, items: [
    { name: "iHeartRadio · Affidavits" }, { name: "JBI · Managing Onsite" }, { name: "JBI · AP", blocked: true },
    { name: "Norco · AR" }, { name: "Norco · Parts Recon" }, { name: "Norco · Safety Audit" },
    { name: "Norco · Solar Winds" }, { name: "Pepsi · ServiceNow" } ] },
  { day: "Jul 3", date: "· deadline", count: 18, items: [
    { name: "Kort Payments × 4" }, { name: "Mitie × 3" }, { name: "Century × 2" }, { name: "Conectiv" },
    { name: "Scan Health × 2", blocked: true }, { name: "JBI Merch", blocked: true }, { name: "Wipro FSS extraction × 5" } ] },
];
export const PARITY_FOOTNOTE =
  "TTX Lease is already complete. The six without an interim date (JBI Merch and five Wipro FSS extraction flows) and Scan Health's two slipped processes all roll into the July 3 deadline; Scan Health is held by its blocker (KOG-11762). Wipro FSS is the sharpest spot: seven targets across Jun 23–25, three engineering-blocked, against a Jun 30 renewal.";
export const ESTATE_OPEN_DECISION =
  "Open decision: the 12 lower-priority processes need a final migrate-or-retire call once the V1 end-of-life date is confirmed. Any still in active use move into migration scope and raise the count above 47.";
export const ESTATE_SOURCE_NOTE =
  "These 74 processes are tracked in the migration tracker. The delivery board represents the same live V1 footprint as 55 cards because it groups sub-processes; the teams are consolidating to a single source.";

export interface DevRow { process: string; owner: string; phase: string; update: string; }
export const NET_NEW: DevRow[] = [
  { process: "Norco · Warranty", owner: "Karthik N.", phase: "M3 · UAT", update: "Built on V2; awaiting customer support for QA." },
  { process: "Century · Accounting Ops", owner: "Rishabh M.", phase: "M2 · Dev", update: "Build effectively complete; blocked this week by a browser-automation issue, plus customer-side charge-code access before UAT." },
  { process: "JBI · Receiving Process", owner: "Arushi B.", phase: "M2 · Dev", update: "Development wrapping up; moving into testing." },
  { process: "Dish · Lease Terminations", owner: "Arushi B.", phase: "M2 · Dev", update: "Access and SSO resolved; data extraction progressing, build nearing completion." },
  { process: "JBI · Compass Quote Update", owner: "Arushi B.", phase: "M1 · Discovery", update: "System access secured; testing against the live system and validating MFA." },
  { process: "JBI · Material Allocation Import", owner: "Arushi B.", phase: "M1 · Discovery", update: "In discovery; third-party access pending; open feasibility call on a SQL-DB approach (desktop automation not on roadmap)." },
  { process: "Charleston CSD · Workflow POV", owner: "Karthik N.", phase: "Waiting for customer", update: "Skeleton process built; awaiting customer data for end-to-end testing." },
];
export const NET_NEW_NOTE = "Greenfield V2 processes in active build this week. 20 further V2 builds are queued. Updates summarized from Monday.";

export type Tone = "strong" | "watch" | "risk";
export interface RenewalRow { account: string; renewal: string; arr: string; health: string; tone: Tone; readiness: string; }
export const RENEWALS_ACTIVE: RenewalRow[] = [
  { account: "JBI", renewal: "Jun 22", arr: "$384K", health: "Strong", tone: "strong", readiness: "On track; several processes in parity or build, AP and Merch unblocked this week." },
  { account: "Kort Payments", renewal: "Jul 10", arr: "$141K", health: "Watch", tone: "watch", readiness: "Behind; still on V1 and in development, with a browser-automation dependency." },
  { account: "Wipro FSS", renewal: "Jun 30", arr: "$110K", health: "Strong", tone: "strong", readiness: "At risk; large estate in build, three build and large-file blockers opened this week." },
  { account: "Pepsi", renewal: "Jun 30", arr: "$32K", health: "At risk", tone: "risk", readiness: "In progress; ServiceNow migration underway, customer health at risk." },
];
export const RENEWALS_HEADLINE = "Approximately $667K ARR up for renewal this quarter across four active accounts. Migration progress de-risks the renewal where it lands.";

export interface DropRow { account: string; renewal: string; arr: string; status: string; decision: string; }
export const RENEWALS_DROPPING: DropRow[] = [
  { account: "Ozark River", renewal: "Jun 30", arr: "$23K", status: "Processes being dropped", decision: "Confirm whether to pursue renewal" },
  { account: "Builders Firstsource", renewal: "Jul 30", arr: "$16K", status: "Account dropped; renewal health critical", decision: "Likely lapse; confirm" },
  { account: "CSA Transport", renewal: "Jul 30", arr: "$10K", status: "Process cancelled; evaluating", decision: "Pursue or let lapse" },
  { account: "Halemeyer", renewal: "Jun 30", arr: "$4K", status: "Under commercial review", decision: "Pursue or let lapse" },
];

export interface NotMigratingRow { item: string; decision: string; rationale: string; }
export const NOT_MIGRATING: NotMigratingRow[] = [
  { item: "ET Global", decision: "Not migrating", rationale: "POV did not convert; account churned" },
  { item: "Halemeyer · Bill Pay (+ enhancements)", decision: "Not migrating", rationale: "~$4K ARR; continued support under review" },
  { item: "Salesbricks", decision: "Not migrating", rationale: "Low ARR; account under commercial review" },
  { item: "Ozark River · 2 processes", decision: "Not migrating", rationale: "Processes being dropped" },
  { item: "Bradley & Beams · tax recon, eng. letters", decision: "Defer / self-serve", rationale: "Small account; if retained, customer maintains post-migration" },
  { item: "Wipro FSS · WTSL, GBL Zcop", decision: "Retire", rationale: "No usage since 2024 / mid-2025" },
  { item: "Airborne · Invoice Processing", decision: "Retire", rationale: "No runs since November 2025" },
  { item: "JBI · Project Initiation Request (v1)", decision: "Retire", rationale: "Superseded by the v2 rebuild" },
];

export interface BlockerRow { id: string; item: string; status: string; theme?: string; tone?: "done" | "prog" | "open"; }
export const BLOCKERS_RESOLVED: BlockerRow[] = [
  { id: "KOG-11810", item: "JBI AP — Epicor AP services", status: "Done Jun 22" },
  { id: "INT-1476", item: "JBI Merch — Epicor decimal fix", status: "Done Jun 18" },
  { id: "ENG-4183", item: "Draft run stuck", status: "Done Jun 15" },
  { id: "ENG-4215", item: "Quill2 stuck on Excel", status: "Done Jun 15" },
];
export const BLOCKERS_RESOLVED_NOTE = "Closed since the last update. JBI Merch and JBI AP migrations are now unblocked.";
export const BLOCKERS_OPEN: BlockerRow[] = [
  { id: "KOG-11815", item: "Large-IDP processing gaps (JBI)", theme: "Scale & large files", status: "Backlog", tone: "open" },
  { id: "OC-1366", item: "Wipro ITC — large-file errors", theme: "Scale & large files", status: "Triage", tone: "open" },
  { id: "KOG-11820", item: "JBI — input too long in UI", theme: "Scale & large files", status: "Backlog", tone: "open" },
  { id: "OC-1349", item: "Wipro — Quill2 stuck on run", theme: "Scale & large files", status: "Triage", tone: "open" },
  { id: "OC-1365", item: "Wipro LCC — build iteration error", theme: "Complex-process build", status: "Triage", tone: "open" },
  { id: "OC-1364", item: "Wipro BRS — build error", theme: "Complex-process build", status: "Triage", tone: "open" },
  { id: "KOG-11762", item: "Run item download (Scan Health)", theme: "Platform & integrations", status: "In Progress · SLA breached", tone: "prog" },
  { id: "ENG-4201", item: "Native email send", theme: "Platform & integrations", status: "Triage", tone: "open" },
  { id: "KOG-11812", item: "Century — browser pod connection", theme: "Platform & integrations", status: "Backlog", tone: "open" },
];

export interface DecisionPoint { title: string; context: string; workaround: string; decide: string; refs: string[]; }
export const DECISIONS: DecisionPoint[] = [
  {
    title: "1 · Subprocess and parallel execution",
    context: "Complex and high-volume processes (Wipro FSS, batch runs) need subprocess calls and parallel execution, which V2 does not yet support natively.",
    workaround: "Interim workaround: invoke a second draft over HTTP to emulate a subprocess or parallel branch; we should validate whether this reliably unblocks current work.",
    decide: "Adopt the HTTP workaround as the interim standard, or prioritize native subprocess and parallel support now.",
    refs: [],
  },
  {
    title: "2 · IDP at scale: formats and fields",
    context: "Several processes need a distinct prompt per document type or format (Ciena PO, 200–300 formats; JBI AP), and some extract 400+ fields (Scan Health). Authoring and maintaining prompt libraries at this scale is unproven.",
    workaround: "Today: works for small prompt sets; effort grows with every new format.",
    decide: "Agree an approach for authoring and maintaining large prompt sets and high-field extractions (templates, tooling, or product investment).",
    refs: ["KOG-11815", "ENG-4139"],
  },
  {
    title: "3 · Large-file throughput and reliability",
    context: "Large PDFs and Excel files (25MB+, up to 100–150MB and 120 pages) cause timeouts and transient errors; processing is sequential with no per-file isolation.",
    workaround: "Open: KOG-11815, OC-1366, OC-1364, OC-1365.",
    decide: "Prioritize large-file and parallel-IDP engineering, or constrain which processes migrate until it is resolved.",
    refs: ["KOG-11815", "OC-1366", "OC-1364", "OC-1365"],
  },
  {
    title: "4 · Integration gaps: email and department box",
    context: "Department box is now unblocked via Collections. Native email send is not available.",
    workaround: "Interim workaround: a personal mailbox for testing, then a customer mailbox or a dedicated automation email account in production.",
    decide: "Standardize the dedicated-mailbox approach, or prioritize native email.",
    refs: ["ENG-4201"],
  },
];

export const SOURCES_NOTE =
  "Sources: Monday delivery boards and Customers board (pulled June 22) · migration tracker (74 processes) · Linear label v2 Migration Blockers (live, June 22). Figures current as of June 22, 2026. Reported footprint of 102 = 58 live + 24 in active development + 20 queued. The migration scope of 47 is confirmed against a V1 end-of-life date still to be set.";
