// V2 Migration — All Hands weekly snapshots.
//
// Each entry in WEEKS is one week's complete report. To publish a new week,
// append a new V2Week object (latest first) — the page renders a date selector
// from this registry and exports any selected week as PNG.
//
// Data sources per week: migration tracker (75-process Excel), Linear label
// "v2 Migration Blockers" (verbatim ticket titles), Monday Projects /
// Customers / Deliverables boards. Colours are literal hexes by design: they
// encode migration stages and are identical in light/dark mode.

export const LINEAR_ISSUE = (id: string) => `https://linear.app/kognitos/issue/${id}`;
export const LINEAR_BLOCKER_LABEL =
  "https://linear.app/kognitos/issue-label/v2%20migration%20blockers";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotMetric { value: string; label: string; sub: string; hero?: boolean; }

export interface DevRow { process: string; owner: string; phase: string; update: string; tone?: "off" | "new"; }

export interface RenewalRow {
  account: string;
  renewal: string;
  renewalTone?: "good" | "risk";
  health: string;
  healthTone: "strong" | "watch" | "risk";
  readiness: string;
}

export interface JourneyData {
  goalLabel: string;
  procMax: number;            // top of the process axis (migration scope)
  ticketMax: number;          // top of the ticket axis (total tickets)
  dates: string[];            // x-axis labels, 6 columns
  milestones: { text: string; good?: boolean }[]; // one per column
  finish: (number | null)[];  // at-or-near-finish per column (null = no data)
  blocked: (number | null)[]; // blocked processes per column
  ticketsCreated: number[];   // cumulative created per column
  ticketsOpen: number[];      // still open per column
  finalLabels: { finish: string; toGo: string; blocked: string; created: string; open: string; resolvedGap: string };
}

export interface BoardChip { name: string; note?: string; mover?: "up" | "down"; }
export interface BoardRow { stage: string; count: number; color: string; chips?: BoardChip[]; summary?: string; }

export interface PushCard { title: string; color: string; body: string; }
export interface PlatformIssue { id: string; title: string; sev: string; sevTone: "urgent" | "high"; state: string; note?: string; }

export interface TicketRow { id: string; title: string; state: string; tone: "prog" | "open"; }
export interface TicketGroup { theme: string; rows: TicketRow[]; }

export interface DecisionCard { title: string; body: string; decide: string; verb?: string; }

export interface V2Week {
  key: string;        // used in filenames, e.g. "2026-07-06"
  dateLabel: string;  // "Week of July 6, 2026"
  lede: string;
  snapshot: SnapshotMetric[];
  snapshotNote: string;
  netNewDelta: string;
  netNew: DevRow[];
  renewalsDelta: string;
  renewalBanner: { title: string; sub: string; stats: { value: string; label: string }[] } | null;
  renewals: RenewalRow[];
  renewalsFootnote: string;
  migrationIntro: string;
  journey: JourneyData;
  boardDelta: string;
  board: BoardRow[];
  boardFootnote: string;
  pushTitle: string;
  push: PushCard[];
  platformIssuesTitle: string;
  platformIssues: PlatformIssue[];
  ticketsDelta: string;
  ticketGroups: TicketGroup[];
  ticketsFootnote: string;
  decisions: DecisionCard[];
  sources: string;
}

// ── Week of July 6, 2026 ──────────────────────────────────────────────────────

const WEEK_2026_07_06: V2Week = {
  key: "2026-07-06",
  dateLabel: "Week of July 6, 2026",
  lede:
    "The strongest week of the migration program: JBI renewed at $162K, five blocked migrations cleared, and 25 of 46 are at or near the finish line. Eighteen blocker tickets closed since Jun 29, two new V2 builds kicked off, and a systematic browser-automation gap review (13 tickets) was filed Jul 6 from validation testing.",

  snapshot: [
    { value: "66", label: "Live in production", sub: "61 V1 · 3 V2 · 2 other" },
    { value: "15", label: "In active development", sub: "6 migrations · 9 net-new" },
    { value: "95", label: "Live or in progress", sub: "total delivered footprint", hero: true },
    { value: "9", label: "Enhancements delivered", sub: "on existing live processes" },
    { value: "14", label: "Queued", sub: "4 on hold · 10 backlog" },
  ],
  snapshotNote:
    "Monday boards, live Jul 6. Prior reports carried a Jun 22 pull; counts rebaselined from the live boards. Migration rebuilds are tracked in the migration tracker below; the Projects board carries board-tracked migrations and net-new builds.",

  netNewDelta: "vs Jun 29: two new kickoffs (Conectiv SONY, JBI Material Allocation Export)",
  netNew: [
    { process: "Norco · Warranty", owner: "Karthik N.", phase: "M3 · UAT", update: "On track; awaiting customer QA support." },
    { process: "Century · Accounting Ops", owner: "Rishabh M.", phase: "M3 · UAT", update: "Off track — browser automation; retest of landed fixes surfaced gaps, filed as a 13-ticket review (ENG-4444) on Jul 6. UAT continues as fixes land.", tone: "off" },
    { process: "JBI · Receiving Process", owner: "Arushi B.", phase: "M2 · Dev", update: "On track; development wrapping up, moving into testing." },
    { process: "JBI · Compass Quote Update", owner: "Arushi B.", phase: "M2 · Dev", update: "Building against the live system; validating MFA." },
    { process: "JBI · Material Allocation Import", owner: "Arushi B.", phase: "Waiting", update: "Third-party access pending." },
    { process: "TTX · Property Tax Outline", owner: "Ayush G.", phase: "M2 · Dev", update: "Greenfield V2 build in progress." },
    { process: "Charleston CSD · Workflow POV", owner: "Karthik N.", phase: "Waiting", update: "Skeleton built; awaiting customer data." },
    { process: "Conectiv · SONY Billing", owner: "Ayush G.", phase: "M1 · Discovery", update: "New — kicked off Jul 6.", tone: "new" },
    { process: "JBI · Material Allocation Export", owner: "Arushi B.", phase: "Pre-kickoff", update: "New — queued behind Import.", tone: "new" },
  ],

  renewalsDelta: "vs Jun 29: JBI renewed at $162K",
  renewalBanner: {
    title: "JBI renewed at $162K",
    sub: "Renewal closed this week",
    stats: [
      { value: "9", label: "NPS" },
      { value: "6", label: "projects delivered" },
      { value: "4", label: "at/near parity" },
      { value: "3", label: "net-new in build" },
    ],
  },
  renewals: [
    { account: "JBI", renewal: "Renewed · $162K", renewalTone: "good", health: "Strong", healthTone: "strong", readiness: "Epicor cleared; Merch + Design + QSR enter customer UAT this week." },
    { account: "Kort Payments", renewal: "Jul 10", renewalTone: "risk", health: "Watch · Strong", healthTone: "watch", readiness: "All four processes blocked on browser automation; fixes in validation now." },
    { account: "Wipro FSS", renewal: "Jun 30 · passed", health: "Strong", healthTone: "strong", readiness: "Outcome not yet recorded on Monday; largest parity cluster, validated vs V1 runs." },
    { account: "Pepsi", renewal: "Jun 30 · passed", health: "At Risk · Moderate", healthTone: "risk", readiness: "Outcome not yet recorded; ServiceNow rebuild in parity testing." },
  ],
  renewalsFootnote:
    "~$667K ARR renews this quarter across the four active accounts; JBI closed-won. Dropped, churned, and under-review accounts were covered in the June 29 report; those decisions stand and no renewals are pursued there. Not-migrating decisions also unchanged (10 processes).",

  migrationIntro:
    "Of 75 tracked V1 processes: 46 migrate to V2, 24 retire with V1, 3 are already on V2, and 2 are custom / off-platform. Everything below is the migration program.",

  journey: {
    goalLabel: "Goal: all 46 migrations at V1 parity",
    procMax: 46,
    ticketMax: 68,
    dates: ["Jun 1", "Jun 8", "Jun 15", "Jun 22", "Jun 29", "Jul 6"],
    milestones: [
      { text: "kickoff" },
      { text: "pipeline built" },
      { text: "migrated · parity begins" },
      { text: "first snapshot" },
      { text: "inflow peaks" },
      { text: "browser gap review filed" },
    ],
    finish: [null, null, 0, 11, 19, 25],
    blocked: [null, null, null, 8, 13, 9],
    ticketsCreated: [2, 3, 4, 16, 40, 68],
    ticketsOpen: [2, 3, 4, 12, 24, 33],
    finalLabels: { finish: "25", toGo: "21 to go", blocked: "9", created: "68 created", open: "33 still open", resolvedGap: "35 resolved" },
  },

  boardDelta: "vs Jun 29: blocked 13 → 9 · customer UAT 7 → 11 · complete 1 → 3",
  board: [
    {
      stage: "Complete", count: 3, color: "#1D9E75",
      chips: [
        { name: "TTX Lease Invoicing" },
        { name: "Norco Packslip Sorting" },
        { name: "JBI SBUX", note: "parked on V2, may reactivate", mover: "up" },
      ],
    },
    {
      stage: "Customer UAT", count: 11, color: "#5BC4A0",
      chips: [
        { name: "JBI Merch PO", note: "starts this week", mover: "up" },
        { name: "JBI Design Meeting", mover: "up" },
        { name: "Plunkett Vendor Bill", mover: "up" },
        { name: "Plunkett ×3", note: "paused, customer NetSuite issue" },
        { name: "Norco Parts Recon" },
        { name: "TTX AP", note: "needs collections" },
        { name: "TTX Brake Inspection" },
        { name: "TTX COA + Goods Receipt", note: "need native email" },
      ],
    },
    {
      stage: "Parity testing", count: 11, color: "#378ADD",
      chips: [
        { name: "Wipro Indirect Tax", mover: "up" },
        { name: "Wipro FSS ×6", note: "validated vs V1 runs Jul 1" },
        { name: "Pepsi ServiceNow", mover: "up" },
        { name: "Scan Health Enrollment", note: "via workaround", mover: "up" },
        { name: "JBI PIR v2", note: "next UAT batch" },
        { name: "Norco Solar Winds" },
      ],
    },
    {
      stage: "In build", count: 12, color: "#EF9F27",
      chips: [
        { name: "JBI AP", note: "enhancement scope, UAT last", mover: "up" },
        { name: "Wipro BRS", note: "prod-verify pending", mover: "up" },
        { name: "JBI Onsite Date Change", note: "migrated Jul 1" },
        { name: "Century BOL" },
        { name: "Century Carrier Booking" },
        { name: "Norco AR" },
        { name: "Norco Safety Culture" },
        { name: "Wipro Collection Acct" },
        { name: "Wipro GP Vendor" },
        { name: "Wipro DSPF SEZ" },
        { name: "Wipro Tax Vouching" },
        { name: "iHeart Affidavits" },
      ],
    },
    {
      stage: "Blocked", count: 9, color: "#E24B4A",
      chips: [
        { name: "Kort Payments ×4", note: "browser automation — gap review filed Jul 6" },
        { name: "JBI QSR", note: "IDP timeouts, UAT starts anyway" },
        { name: "Conectiv", note: "400MB / 1M-row files" },
        { name: "Mitie PCard", note: "UK instance + credentials" },
        { name: "Scan Health Report", note: "subprocess / parallel" },
        { name: "Ciena PO", note: "new — customer hesitant, IDP build experience first", mover: "down" },
      ],
    },
  ],
  boardFootnote:
    "Scope 45 → 46: Norco Packslip reclassified as a completed migration. Migrate-or-retire call on lower-priority items pends the V1 end-of-life date. The 75 are tracked in the migration tracker; delivery boards group sub-processes, so counts differ.",

  pushTitle: "This week's push · field team (SE · FDE · CSM)",
  push: [
    { title: "Move UAT to live", color: "#0F6E56", body: "11 in customer UAT. JBI starts Merch, Design, QSR (max 5 workstreams per customer). Plunkett pends their NetSuite fix. TTX needs collections + native email." },
    { title: "Start customer UAT from parity", color: "#185FA5", body: "11 in parity. JBI PIR v2 queued next; Wipro cluster validated vs V1 runs, scale answer feeds the subprocess benchmark." },
    { title: "Unblock engineering", color: "#A32D2D", body: "Kort browser validation vs the Jul 10 renewal is most time-critical; the Jul 6 browser gap review (ENG-4444, 13 tickets) needs prioritization. UK instance gates Mitie. Ciena waits on Assets / Collections." },
    { title: "Keep builds and live processes healthy", color: "#534AB7", body: "9 net-new V2 builds active; support live V1 and V2 production processes — open platform issues below." },
  ],
  platformIssuesTitle: "Live platform issues needing attention (outside the migration label)",
  platformIssues: [
    { id: "KOG-11831", title: "V1 | SCAN Health | Daily report generation fails with internal error", sev: "Urgent", sevTone: "urgent", state: "In Review" },
    { id: "KOG-11848", title: "Conectiv | V1 | SharePoint download files error", sev: "Urgent", sevTone: "urgent", state: "In Review" },
    { id: "ENG-4426", title: "V1 | GPEH skipping Gemini extraction on enrollment forms — wrong field values for Indium Tech", sev: "High", sevTone: "high", state: "Validation" },
    { id: "KOG-11801", title: "Prod V1 | Wipro | DynamoDB lock causes brain context loss and run failure", sev: "High", sevTone: "high", state: "In Review" },
    { id: "OC-1412", title: "OOMKills on browser pool pod/s - prod", sev: "High", sevTone: "high", state: "Todo", note: "same infra behind Kort / Century browser work" },
    { id: "KOG-11857", title: "V2 | Pepsico | Credits exhausted - org id - 1", sev: "High", sevTone: "high", state: "Todo", note: "quick ops fix, filed today" },
  ],

  ticketsDelta: "vs Jun 29: open 24 → 33. Jul 6 alone: 13-ticket browser-automation gap review filed from validation testing, 3 further issues reported, and 6 tickets closed. Open ticket = still blocked.",
  ticketGroups: [
    {
      theme: "Browser automation — gap review filed Jul 6 (ENG-4444)",
      rows: [
        { id: "KOG-11840", title: "Century - Browser Connection being dropped", state: "In review", tone: "prog" },
        { id: "KOG-11838", title: "Century - Can't see Browser action/video when there's an exception", state: "In progress", tone: "prog" },
        { id: "ENG-4444", title: "Gaps/Feedback for v2 Browser automation", state: "Triage", tone: "open" },
        { id: "ENG-4445", title: "Add browser JavaScript evaluation for page-context actions", state: "Triage", tone: "open" },
        { id: "ENG-4446", title: "Add DOM-presence waiting with selector timeouts", state: "Triage", tone: "open" },
        { id: "ENG-4447", title: "Add atomic input clearing and fill for inline editors", state: "Triage", tone: "open" },
        { id: "ENG-4448", title: "Standardize browser procedure return shapes and surface schemas", state: "Triage", tone: "open" },
        { id: "ENG-4449", title: "Make browser teardown failures non-fatal or safely swallowed", state: "Triage", tone: "open" },
        { id: "ENG-4450", title: "Add network response waiting for XHR-backed browser flows", state: "Triage", tone: "open" },
        { id: "ENG-4451", title: "Add semantic ag-Grid verbs for content-addressed editing", state: "Triage", tone: "open" },
        { id: "ENG-4452", title: "Document selector visibility behavior changes and add visible-match fallback", state: "Triage", tone: "open" },
        { id: "ENG-4453", title: "Make browser book version binding and upgrades visible in UX", state: "Triage", tone: "open" },
        { id: "ENG-4454", title: "Honor transport error contracts or add recovery for browser invoker failures", state: "Triage", tone: "open" },
        { id: "ENG-4456", title: "Fix `save_automation` reporting success when edits are not persisted", state: "Triage", tone: "open" },
      ],
    },
    {
      theme: "IDP and Excel at scale",
      rows: [
        { id: "KOG-11824", title: "JBI - Parallel IDP extraction getting timeouts", state: "In progress", tone: "prog" },
        { id: "KOG-11859", title: "JBI - Document Processing service unresponsive in Prod, Astral didn't try to auto-resolve or retry", state: "In review", tone: "prog" },
        { id: "KOG-11815", title: "Gaps in v2 for executing large IDP processes", state: "Backlog", tone: "open" },
        { id: "ENG-4375", title: "Increase file upload limit for Connectiv V2 migration", state: "Todo", tone: "open" },
        { id: "ENG-4429", title: "Increase BDK Excel pod memory for Connectiv V2 migration", state: "Todo", tone: "open" },
      ],
    },
    {
      theme: "Subprocess, parallel, V1 Python",
      rows: [
        { id: "ENG-3827", title: "PO digitization: decide Python migration strategy per stage (1, 4, 5)", state: "Backlog", tone: "open" },
        { id: "OC-1357", title: "Mitie V2 Migration — PCard Python BCI procedures need V2 equivalent", state: "Triage", tone: "open" },
      ],
    },
    {
      theme: "Connections and environments",
      rows: [
        { id: "KOG-11851", title: "Epicor connection is consistently failing", state: "Todo", tone: "open" },
        { id: "KOG-11849", title: "Epicor VPN Tunnel for Norco", state: "Todo", tone: "open" },
        { id: "ENG-4369", title: "JBI SFTP Server Connection", state: "Triage", tone: "open" },
        { id: "OC-1359", title: "Mitie V2 Migration — PCard Coupa API credentials and HTTP chain", state: "Triage", tone: "open" },
        { id: "OC-1360", title: "Mitie V2 Migration — PCard Maximo API credential setup", state: "Triage", tone: "open" },
        { id: "KOG-11842", title: "Mitie - UK instance of v2 for v1 process migration", state: "Backlog", tone: "open" },
      ],
    },
    {
      theme: "Collections and fuzzy matching",
      rows: [
        { id: "ENG-4431", title: "PostGres DB for Century for V2 Fuzzy match", state: "Todo", tone: "open" },
        { id: "ENG-4442", title: "[jarvis] fuzzy_match predicate in collection filter expressions (SPy surface)", state: "In review", tone: "prog" },
      ],
    },
    {
      theme: "Build and run reliability",
      rows: [
        { id: "ENG-4441", title: "JBI - Quill2 unable to execute the command, error message pop-up in UI", state: "Backlog", tone: "open" },
        { id: "ENG-4455", title: "Improve run observability for paused and failed automation diagnosis", state: "Triage", tone: "open" },
        { id: "MAN-3769", title: "WIPRO LCC automation build fails at the limited tool iterations error", state: "Triage", tone: "open" },
        { id: "KOG-11853", title: "V2 | TTX | Flaky save button in add inputs", state: "Backlog", tone: "open" },
      ],
    },
  ],
  ticketsFootnote:
    "Closed since Jun 29 (18): Wipro ITC large-file errors · Conectiv 50MB rejection · iHeart prompt limit · IDP one-hour limit · fuzzy matching for collections (ENG-4302; SPy follow-up ENG-4442 in review) · collections prod timeline (OC-1370) · JBI run-output preview (KOG-11832) · Quill2 stuck-run (ENG-4297) · SPy run ID (ENG-4440) · Pepsico Quill2 callouts (ENG-4436), among others. The Jul 6 browser review (ENG-4444) converts validation findings into 12 actionable tickets.",

  decisions: [
    {
      title: "1 · Subprocess and parallel execution",
      body: "Building sequential and benchmarking runtime against V1. HTTP-draft workaround exists, not in use. Alternative: parallelize inside Books — parallel IDP shipped, parallel file processing next candidate.",
      decide: "Prioritize native subprocess based on how many processes stall or run materially slower than V1.",
    },
    {
      title: "2 · V1 Python and integration code",
      body: "Full rebuild in SPy is viable for BCI procedures; Coupa and Maximo can run over direct HTTP calls for testing.",
      decide: "Keep as-is through go-live and handover, or package as a product feature.",
    },
    {
      title: "3 · UK instance for Mitie",
      body: "Mitie's V1 processes run in the UK instance; V2 has none. Testing proceeds on app.us-1.",
      decide: "Stand up a UK V2 instance or approve an alternative region — gates the account.",
    },
  ],

  sources:
    "Sources: migration tracker (75 processes, Jul 6) · Linear label v2 Migration Blockers (live Jul 6: 68 tickets, 33 open) and open Urgent/High production issues · Monday Projects, Customers, and Deliverables boards (live Jul 6). JBI renewal per Delivery; the Monday Customers row predates the renewal and is pending update. Journey milestones per program records; ticket history from Linear creation and completion dates.",
};

// Latest first. Append new weeks at the top.
export const WEEKS: V2Week[] = [WEEK_2026_07_06];
