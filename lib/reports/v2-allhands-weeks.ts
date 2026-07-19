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

// Created-in-window velocity: are new tickets trending down, and are they
// blockers or lower-severity? One row per look-back window.
export interface TicketTrendRow {
  window: string;      // "Last 7 days"
  created: number;     // tickets created in the window
  // null = severity not tracked over this span (labeling began mid-June),
  // rendered as "n/t" rather than 0 so we never imply zero blockers.
  hardBlocker: number | null;
  workaround: number | null;
  bug: number | null;
  resolved: number;    // of those created, how many are already closed-done
  open: number;        // of those created, how many still open
}
export interface TicketTrend {
  intro: string;
  // Standing backlog: tickets open right now, by class (classified today).
  openNow?: { hardBlocker: number; workaround: number; bug: number; total: number; asOf: string };
  rows: TicketTrendRow[];
  note: string;
}

export interface DecisionCard { title: string; body: string; decide: string; verb?: string; }

// Live ticket health from a single Linear label (added Jul 20). Distinct from
// ticketTrend, which needs the Supabase classifier; labelHealth needs only the
// live Linear label, so it can be refreshed from Linear alone.
export interface LabelHealthFlow { window: string; filed: number; closed: number; }
export interface LabelHealth {
  label: string;       // "v2 Migration Blockers"
  asOf: string;        // "live Jul 20"
  openNow: number;
  prevOpen?: number;   // prior comparison point, e.g. 34
  prevLabel?: string;  // e.g. "Jun 29"
  urgentHigh: number;
  filed7: number;
  closed7: number;
  flow: LabelHealthFlow[];
  note: string;
}

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
  ticketTrend?: TicketTrend;   // created-in-window velocity (optional; added Jul 13)
  labelHealth?: LabelHealth;   // live single-label health (optional; added Jul 20)
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

// ── Week of July 13, 2026 ──────────────────────────────────────────────────────
// Fresh this week: estate (migration tracker), the blocker-ticket burnup, the
// created-in-window velocity table, open-ticket groups, and sources — from the
// Jul 13 tracker + live Linear. Delivery snapshot, net-new, renewals, and the
// stage board are carried from the Jul 6 Monday pull (not re-pulled this session).
const WEEK_2026_07_13: V2Week = {
  key: "2026-07-13",
  dateLabel: "Week of July 13, 2026",
  lede:
    "We've moved most of the estate to the doorstep of done: 38 of 46 migrations are at or near the finish line, the entire Wipro FSS cluster enters customer UAT this week, and blocker inflow has finally caught up with burn-down. What's left is a short, known list — a handful of engineering blockers (browser automation, Mitie's UK instance, a few connections) between here and finishing the migration.",

  snapshot: [
    { value: "66", label: "Live in production", sub: "61 V1 · 3 V2 · 2 other" },
    { value: "12", label: "In active development", sub: "5 migrations · 7 net-new" },
    { value: "94", label: "Live or in progress", sub: "total delivered footprint", hero: true },
    { value: "9", label: "Enhancements delivered", sub: "on existing live processes" },
    { value: "16", label: "Queued", sub: "4 on hold · 12 backlog" },
  ],
  snapshotNote:
    "Two sources. Live-in-production, footprint, and enhancements are the delivery portfolio estate (migration tracker + delivered history) — stable week to week, not a Monday-refreshable count. In-active-development (12) and queued (16) are the live Monday Projects board, Jul 13. The migration program's own stage board is below.",

  netNewDelta: "Live Monday pull, Jul 13. vs Jul 6: TTX Property Tax advanced to UAT; JBI Receiving moved to Waiting (VPN access); Conectiv SONY in discovery.",
  netNew: [
    { process: "Norco · Warranty", owner: "Karthik N.", phase: "M3 · UAT", update: "Completed in V2; waiting on customer QA support." },
    { process: "Century · Accounting Ops", owner: "Rishabh M.", phase: "M3 · UAT", update: "Browser-automation fixes landed; dev complete but unstable in live end-to-end — testing before customer UAT.", tone: "off" },
    { process: "TTX · Property Tax Outline", owner: "Ayush G.", phase: "M3 · UAT", update: "UAT + parity testing started; go-live on customer sign-off." },
    { process: "JBI · Compass Quote Update", owner: "Arushi B.", phase: "M2 · Dev", update: "Building against the live system; awaiting VPN access." },
    { process: "JBI · Receiving Process", owner: "Arushi B.", phase: "Waiting", update: "Awaiting VPN setup." },
    { process: "JBI · Material Allocation Import", owner: "Arushi B.", phase: "Waiting", update: "Awaiting VPN setup / third-party access." },
    { process: "Charleston CSD · Workflow POV", owner: "Karthik N.", phase: "Waiting", update: "Skeleton built; awaiting customer data for end-to-end." },
    { process: "Conectiv · SONY Billing", owner: "Ayush G.", phase: "M1 · Discovery", update: "Discovery call 1 done; call 2 held Jul 10." },
    { process: "JBI · Material Allocation Export", owner: "Arushi B.", phase: "Pre-kickoff", update: "Queued behind Import; no update posted yet." },
  ],

  renewalsDelta:
    "Carried from Jul 6 — Monday not re-pulled this session. JBI renewal ($162K) closed the week of Jul 6; Kort's Jul 10 date has now passed and needs a status update.",
  renewalBanner: null,
  renewals: [], // hidden this week per Rishabh — renewals section not shown Jul 13
  renewalsFootnote: WEEK_2026_07_06.renewalsFootnote,

  migrationIntro:
    "Of 75 tracked V1 processes: 46 migrate to V2, 24 retire with V1, 3 are already on V2, and 2 are custom / off-platform. Unchanged from Jul 6. Everything below is the migration program.",

  journey: {
    goalLabel: "Goal: all 46 migrations at V1 parity",
    procMax: 46,
    ticketMax: 95,
    dates: ["Jun 1", "Jun 8", "Jun 15", "Jun 22", "Jun 29", "Jul 6", "Jul 13"],
    milestones: [
      { text: "kickoff" },
      { text: "pipeline built" },
      { text: "migrated · parity begins" },
      { text: "first snapshot" },
      { text: "inflow peaks" },
      { text: "browser gap review" },
      { text: "Wipro cluster → UAT", good: true },
    ],
    finish: [null, null, 0, 11, 19, 25, 38],
    blocked: [null, null, null, 8, 13, 9, 8],
    ticketsCreated: [4, 5, 7, 25, 45, 72, 90],
    ticketsOpen: [4, 5, 5, 19, 27, 35, 34],
    finalLabels: { finish: "38", toGo: "8 to go", blocked: "8", created: "90 created", open: "34 still open", resolvedGap: "56 resolved" },
  },

  boardDelta: "Staged from tracker handover / parity / validation dates (Jul 13), not just the status field. 38 of 46 at or near finish, up from 25 — 13 start customer UAT this week (the full Wipro FSS cluster plus JBI Merch and Onsite). Mitie PCard moved to blocked (needs v2 UK instance); blocked now 8.",
  board: [
    {
      stage: "Complete", count: 3, color: "#1D9E75",
      chips: [
        { name: "JBI SBUX", note: "parked on V2" },
        { name: "Norco Packslip Sorting" },
        { name: "TTX Lease Invoicing" },
      ],
    },
    {
      stage: "In customer UAT", count: 17, color: "#5BC4A0",
      chips: [
        { name: "JBI ×3", note: "QSR, Design Mtg, PIR v2", mover: "up" },
        { name: "TTX ×4", note: "AP, brake AR, COA, goods receipt" },
        { name: "Plunkett ×4" },
        { name: "Scan Health ×2", note: "enrollment + report" },
        { name: "Ciena PO", note: "handed over Jul 13", mover: "up" },
        { name: "Pepsi ServiceNow", mover: "up" },
        { name: "Norco Parts Recon" },
        { name: "iHeart Affidavits", mover: "up" },
      ],
    },
    {
      stage: "Starting customer UAT this week", count: 13, color: "#0E8C6A",
      chips: [
        { name: "Wipro FSS ×11", note: "full cluster to customer UAT — handover Jul 10–15", mover: "up" },
        { name: "JBI Merch PO", note: "Jul 14", mover: "up" },
        { name: "JBI Onsite Date Change", note: "Jul 17", mover: "up" },
      ],
    },
    {
      stage: "Parity testing", count: 5, color: "#378ADD",
      chips: [
        { name: "JBI AP", note: "enhancement scope" },
        { name: "Norco Solar Winds" },
        { name: "Norco Safety Culture" },
        { name: "Norco AR", note: "parity Jul 17" },
        { name: "Wipro Indirect Tax" },
      ],
    },
    {
      stage: "Blocked", count: 8, color: "#E24B4A",
      chips: [
        { name: "Kort Payments ×4", note: "browser automation — IP whitelisting" },
        { name: "Century BOL + Carrier Booking", note: "collections fuzzy match" },
        { name: "Conectiv POV", note: "parallel processing / large files" },
        { name: "Mitie PCard", note: "needs v2 UK instance" },
      ],
    },
  ],
  boardFootnote:
    "Stage is derived from the tracker's parity-test, customer-handover and validation dates — not just the status field, which lags: several processes still marked 'engg pending' or 'parity' have customer-handover dates this week. Blocked = open engineering blocker with no customer date yet (Mitie PCard needs a v2 UK instance). Earlier weeks were staged from Monday status, so part of the 25 → 38 step up is this fuller date-based measure. These 46 are the migration program (46 of 75 tracked V1 processes).",

  pushTitle: WEEK_2026_07_06.pushTitle,
  push: WEEK_2026_07_06.push,
  platformIssuesTitle: "Live production issues needing attention · V1 + platform (outside the migration label)",
  platformIssues: [
    { id: "KOG-11848", title: "Conectiv · V1 — SharePoint download renames files, breaks downstream segregation", sev: "Urgent", sevTone: "urgent", state: "In Review" },
    { id: "ENG-4426", title: "Indium · V1 — GPEH skips Gemini extraction, wrong enrollment field values", sev: "High", sevTone: "high", state: "Validation" },
    { id: "KOG-11801", title: "Wipro · V1 — DynamoDB lock loses brain context on large PDFs, run fails", sev: "High", sevTone: "high", state: "In Review", note: "fix PR open — lock lease 60s → 180s" },
    { id: "RL-2161", title: "Pepsico · V1 — ServiceNow tagging process crashing", sev: "High", sevTone: "high", state: "Information Required" },
    { id: "OC-1412", title: "Platform — OOMKills on browser-pool pods in prod", sev: "High", sevTone: "high", state: "Todo", note: "same infra behind Kort / Century browser work" },
  ],

  ticketsDelta:
    "vs Jul 6: cumulative blockers 72 → 90 (+18 created) and 17 closed this week, so open held at 34. Open = still blocked. New inflow is dominated by the browser-automation family (ENG-4444…) and a new Quill2 build-experience cluster (ENG-4480, 4494–4498).",

  ticketTrend: {
    intro:
      "Two views of the tracked v2 Linear set (v2 Migration Blockers label, Voyager v2 feedback, ux-quality, and migration-labelled Integrations / On-Call items): the open backlog right now, and how new tickets have flowed in. Severity labeling (hard blocker / workaround / bug) began mid-June — the blocker label jumped 7 → 25 the week of Jun 15 — so the 90-day inflow split shows as not tracked, not zero.",
    openNow: { hardBlocker: 26, workaround: 23, bug: 78, total: 127, asOf: "Still open, from the migration-tracked Linear tickets of the last 90 days. This is the current backlog, not the recent inflow below." },
    rows: [
      { window: "Last 7 days", created: 21, hardBlocker: 10, workaround: 4, bug: 7, resolved: 5, open: 16 },
      { window: "Last 15 days", created: 54, hardBlocker: 22, workaround: 8, bug: 16, resolved: 13, open: 34 },
      { window: "Last 30 days · since tracking began", created: 101, hardBlocker: 26, workaround: 11, bug: 45, resolved: 39, open: 45 },
      { window: "Last 90 days", created: 227, hardBlocker: null, workaround: null, bug: null, resolved: 69, open: 127 },
    ],
    note:
      "Open now = tickets still open regardless of when filed (current backlog, classified today); the windows are new tickets by created date (inflow). Not tracked ≠ zero: severity wasn't labeled before mid-June, so no inflow class split over 90 days. Created / resolved / open use creation and completion dates and are reliable across the span. Bug is inflated because ux-quality and Voyager feedback map to Bug by the tracker's convention; cancelled / duplicate excluded from class columns.",
  },

  ticketGroups: [
    {
      theme: "Browser automation — production-readiness gaps (ENG-4444 family)",
      rows: [
        { id: "KOG-11838", title: "Century — can't see browser action/video when there's an exception", state: "In review", tone: "prog" },
        { id: "ENG-4444", title: "v2 Browser Book: production-readiness gaps (missing primitives, resilience)", state: "Triage", tone: "open" },
        { id: "ENG-4445", title: "Add browser JavaScript evaluation (page-context execution)", state: "Triage", tone: "open" },
        { id: "ENG-4446", title: "Add DOM-presence waiting with selector timeouts", state: "Triage", tone: "open" },
        { id: "ENG-4448", title: "Standardize browser procedure return shapes and output schemas", state: "Triage", tone: "open" },
        { id: "ENG-4449", title: "Make browser teardown failures non-fatal and non-masking", state: "Triage", tone: "open" },
        { id: "ENG-4450", title: "Add network response waiting for XHR-backed browser flows", state: "Triage", tone: "open" },
        { id: "ENG-4452", title: "Prefer visible candidate on multi/hidden selector matches", state: "Triage", tone: "open" },
        { id: "ENG-4454", title: "Honor transport-error contract or add browser session recovery", state: "Triage", tone: "open" },
      ],
    },
    {
      theme: "Quill2 build & run reliability",
      rows: [
        { id: "KOG-11862", title: "V2 | Pepsico | run stuck — taking too long, sometimes unrecoverable", state: "Backlog", tone: "open" },
        { id: "ENG-4441", title: "JBI — Quill2 unable to execute the command, error pop-up in UI", state: "Backlog", tone: "open" },
        { id: "ENG-4480", title: "Quill2 build experience: agent stability across long build sessions", state: "Triage", tone: "open" },
        { id: "ENG-4494", title: "Quill2 agent behavior: regressions, unauthorized changes, memory loss", state: "Triage", tone: "open" },
        { id: "ENG-4495", title: "SPy codegen robustness: language traps that fail silently", state: "Triage", tone: "open" },
        { id: "ENG-4498", title: "Quill2 gives garbled English in responses", state: "Triage", tone: "open" },
        { id: "ENG-4455", title: "Improve run observability for paused and failed automation diagnosis", state: "Triage", tone: "open" },
        { id: "MAN-3769", title: "Wipro LCC automation build fails at the limited-tool-iterations error", state: "Triage", tone: "open" },
      ],
    },
    {
      theme: "IDP & Excel at scale",
      rows: [
        { id: "KOG-11815", title: "Gaps in v2 for executing large IDP processes", state: "In progress", tone: "prog" },
        { id: "KOG-11859", title: "JBI — Document Processing service unresponsive in prod; no auto-retry", state: "Todo", tone: "open" },
        { id: "KOG-11865", title: "V2 | TTX | IDP failure — unable to extract correct data from upload", state: "Backlog", tone: "open" },
        { id: "ENG-4429", title: "Increase BDK Excel pod memory for Conectiv V2 migration", state: "Todo", tone: "open" },
        { id: "ENG-4496", title: "IDP reliability and determinism in Quill2 builds", state: "Triage", tone: "open" },
        { id: "ENG-4497", title: "Excel book and API surface friction in Quill2 builds", state: "Triage", tone: "open" },
      ],
    },
    {
      theme: "Connections & environments",
      rows: [
        { id: "ENG-4369", title: "JBI SFTP server connection", state: "Validation", tone: "prog" },
        { id: "INT-1509", title: "[Epicor Book] support BAQ parameter passing for parameterized BAQs", state: "Triage", tone: "open" },
        { id: "INT-1511", title: "JBI | V2 — Epicor is not discovering BAQs", state: "Triage", tone: "open" },
        { id: "KOG-11842", title: "Mitie — UK instance of v2 for v1 process migration", state: "Backlog", tone: "open" },
      ],
    },
    {
      theme: "Grid, inputs & product feedback",
      rows: [
        { id: "ENG-4461", title: "V2 | TTX | Quill repeatedly posting the same message to the thread", state: "Validation", tone: "prog" },
        { id: "INT-1510", title: "TTX | V2 — autoforwarding being blocked", state: "Validation", tone: "prog" },
        { id: "ENG-4447", title: "Add atomic input clear-and-fill for inline and standard inputs", state: "Todo", tone: "open" },
        { id: "ENG-4451", title: "Add semantic, content-addressed grid and element verbs", state: "Triage", tone: "open" },
        { id: "ENG-4500", title: "V2 feedback — live automations: requirement of parallel runs", state: "Triage", tone: "open" },
        { id: "ENG-3626", title: "V2 feedback — guidance: TSG learning only applied to first exception", state: "Triage", tone: "open" },
        { id: "ENG-3711", title: "V2 feedback — drafts: exception not raised when required field missing", state: "Triage", tone: "open" },
      ],
    },
  ],
  ticketsFootnote:
    "Closed since Jul 6 (17 on the blocker label): ENG-3827 PO Python strategy · ENG-4297 Quill2 stuck-run · ENG-4302 collections fuzzy match · OC-1370 collections prod timeline · KOG-11832 JBI run-output preview · KOG-11840 Century browser connection · ENG-4375 Conectiv file-upload limit · ENG-4440 SPy run ID · ENG-4436 Pepsico Quill2 callouts · ENG-4442 fuzzy_match predicate · ENG-4476 · KOG-11864 · INT-1507 · MAN-3775 · OC-1419 / 1423 / 1426. The velocity table above is the tracked-set view; this open list is the v2 Migration Blockers label only (34 open).",

  decisions: WEEK_2026_07_06.decisions,

  sources:
    "Sources: migration tracker (75 processes / 46 migrating, refreshed Jul 13) drives the estate and the stage board; the live Monday Projects board (Jul 13) drives net-new development and the active-development / queued counts; Linear (live Jul 13) drives the blocker burnup (90 created / 34 open) and the velocity table. Severity labeling on the blocker set began mid-June, so the 90-day class split is shown as not tracked. Live-production and footprint totals are the delivery portfolio estate (tracker + delivered history), stable week to week. Push lanes and the platform-issues list are carried from Jul 6. Blocker burnup is on a single Linear-derived basis (creation / completion dates), so prior weeks differ slightly from earlier decks.",
};

// ── Week of July 20, 2026 ──────────────────────────────────────────────────────
// Live sources this week: migration tracker Working Sheet (estate, stage board,
// journey endpoints), live Monday Projects board (snapshot dev/queued + net-new),
// and live Linear via the v2 Migration Blockers label (open list, ticket-health
// tiles) plus a live open Urgent/High sweep for platform issues. Delivery-portfolio
// tiles (live-in-prod, footprint, enhancements) and decisions are carried.
const WEEK_2026_07_20: V2Week = {
  key: "2026-07-20",
  dateLabel: "Week of July 20, 2026",
  lede:
    "The blocker list keeps shrinking: open v2 Migration Blockers fell to 19, with 17 closed in the last 7 days against 8 filed, and the collections fuzzy-match dependency is now done, clearing Century into parity. 39 of 45 migrations are at or near the finish line, and the full Wipro FSS cluster plus iHeart start customer UAT this week. What's left is short and mostly known: IDP at scale, a Quill2 build-stability cluster, Kort's customer whitelisting, and Mitie's commercial sign-off.",

  snapshot: [
    { value: "66", label: "Live in production", sub: "61 V1 · 3 V2 · 2 other" },
    { value: "7", label: "In active development", sub: "net-new V2 builds" },
    { value: "94", label: "Live or in progress", sub: "total delivered footprint", hero: true },
    { value: "9", label: "Enhancements delivered", sub: "on existing live processes" },
    { value: "16", label: "Queued", sub: "4 on hold · 10 backlog · 2 upcoming" },
  ],
  snapshotNote:
    "In-active-development counts the seven net-new V2 builds on the live Monday Projects board (Jul 20); queued (16) is the same board. Every live V1 process is migrating, so the 45-process migration program is the stage board below rather than a separate count here. Live-in-production, footprint, and enhancements are the delivery-portfolio estate, stable week to week.",

  netNewDelta:
    "Live Monday pull, Jul 20. Phases steady vs Jul 13; the three JBI builds wait on VPN / customer access and Conectiv SONY is in discovery.",
  netNew: [
    { process: "Norco · Warranty", owner: "Karthik N.", phase: "M3 · UAT", update: "Completed in V2; waiting on customer QA support." },
    { process: "Century · Accounting Ops", owner: "Rishabh M.", phase: "M3 · UAT", update: "Browser-automation fixes landed; stabilizing live end-to-end before customer UAT.", tone: "off" },
    { process: "TTX · Property Tax Outline", owner: "Ayush G.", phase: "M3 · UAT", update: "UAT + parity testing; go-live on customer sign-off." },
    { process: "JBI · Compass Quote Update", owner: "Arushi B.", phase: "M2 · Dev", update: "Building against the live system; awaiting VPN access." },
    { process: "JBI · Receiving Process", owner: "Arushi B.", phase: "Waiting", update: "Awaiting VPN setup." },
    { process: "JBI · Material Allocation Import", owner: "Arushi B.", phase: "Waiting", update: "Awaiting VPN setup / third-party access." },
    { process: "Charleston CSD · Workflow POV", owner: "Karthik N.", phase: "Waiting", update: "Skeleton built; awaiting customer data for end-to-end." },
    { process: "Conectiv · SONY Billing", owner: "Ayush G.", phase: "M1 · Discovery", update: "Discovery ongoing." },
    { process: "JBI · Material Allocation Export", owner: "Arushi B.", phase: "Pre-kickoff", update: "Queued behind Import.", tone: "new" },
  ],

  renewalsDelta:
    "Carried from Jul 6 — Monday renewals not re-pulled. JBI renewed ($162K) the week of Jul 6; Kort's Jul 10 date has passed and needs a status update.",
  renewalBanner: null,
  renewals: [], // hidden per Rishabh — renewals section not shown since Jul 13
  renewalsFootnote: WEEK_2026_07_13.renewalsFootnote,

  migrationIntro:
    "Of 75 tracked V1 processes: 45 migrate to V2, 25 retire with V1, 3 are already on V2, and 2 are custom / off-platform. One process moved from migrate to retire since Jul 13 (46 → 45). Everything below is the migration program.",

  journey: {
    goalLabel: "Goal: all 45 migrations at V1 parity",
    procMax: 45,
    ticketMax: 100,
    dates: ["Jun 1", "Jun 8", "Jun 15", "Jun 22", "Jun 29", "Jul 6", "Jul 13", "Jul 20"],
    milestones: [
      { text: "kickoff" },
      { text: "pipeline built" },
      { text: "migrated · parity begins" },
      { text: "first snapshot" },
      { text: "inflow peaks" },
      { text: "browser gap review" },
      { text: "Wipro cluster → UAT", good: true },
      { text: "Century cleared · blockers fall", good: true },
    ],
    finish: [null, null, 0, 11, 19, 25, 38, 39],
    blocked: [null, null, null, 8, 13, 9, 8, 6],
    ticketsCreated: [4, 5, 7, 25, 45, 72, 90, 98],
    ticketsOpen: [4, 5, 5, 19, 27, 35, 34, 19],
    finalLabels: { finish: "39", toGo: "6 to go", blocked: "6", created: "≈98 created", open: "19 open", resolvedGap: "79 resolved" },
  },

  boardDelta:
    "Fresh from the Jul 20 tracker, with field corrections. vs Jul 13: near-finish 38 → 39 and blocked 8 → 6 as the collections fuzzy-match dependency closed and Century moved into parity; scope 46 → 45 (one process moved to retire); the full Wipro FSS cluster plus iHeart start customer UAT this week. Mitie PCard stays blocked — now on a commercial decision and live API access, not the UK instance.",
  board: [
    {
      stage: "Complete", count: 3, color: "#1D9E75",
      chips: [
        { name: "JBI SBUX", note: "parked on V2" },
        { name: "Norco Packslip Sorting" },
        { name: "TTX Lease Invoicing" },
      ],
    },
    {
      stage: "In customer UAT", count: 17, color: "#5BC4A0",
      chips: [
        { name: "JBI ×5" },
        { name: "Plunkett ×4" },
        { name: "TTX ×4" },
        { name: "Ciena PO" },
        { name: "Norco Parts Recon" },
        { name: "Pepsi ServiceNow" },
        { name: "Scan Health Enrollment" },
      ],
    },
    {
      stage: "Starting customer UAT this week", count: 12, color: "#0E8C6A",
      chips: [
        { name: "Wipro FSS ×11", note: "handover Jul 10–15", mover: "up" },
        { name: "iHeart Affidavits", mover: "up" },
      ],
    },
    {
      stage: "Parity testing", count: 7, color: "#378ADD",
      chips: [
        { name: "Century ×2", note: "fuzzy-match done; parity dates this week", mover: "up" },
        { name: "JBI AP", note: "final enhancement scope in review this week; UAT after sign-off" },
        { name: "Norco ×3" },
        { name: "Wipro Indirect Tax" },
      ],
    },
    {
      stage: "Blocked", count: 6, color: "#E24B4A",
      chips: [
        { name: "Kort Payments ×4", note: "customer IP whitelisting" },
        { name: "Conectiv POV", note: "large files; dedicated engineer being assigned" },
        { name: "Mitie PCard", note: "internal testing on mock data; awaiting commercial + live API / whitelisting" },
      ],
    },
  ],
  boardFootnote:
    "Stage reflects the tracker's parity-test, customer-handover and validation dates plus field corrections this week: Century cleared once the collections fuzzy-match landed, and Mitie PCard is held for a commercial decision and live API access (internal testing on mock data, no UAT date). Blocked = an open dependency with no customer date yet. These 45 are the migration program (45 of 75 tracked V1 processes).",

  pushTitle: "This week's push · field team (SE · FDE · CSM)",
  push: [
    { title: "Move UAT to live", color: "#0F6E56", body: "Wipro FSS ×11 and iHeart enter customer UAT this week; drive sign-offs (max 5 workstreams per customer). Plunkett pends their NetSuite fix; TTX needs collections + native email." },
    { title: "Start customer UAT from parity", color: "#185FA5", body: "Century cleared into parity (parity dates this week); Norco ×3 and Wipro Indirect Tax follow. JBI AP starts UAT once its final enhancement scope is signed off this week." },
    { title: "Waiting on engineering", color: "#A32D2D", body: "Conectiv large-file / parallel processing is the live engineering blocker (a dedicated engineer is being assigned); IDP-at-scale and the Quill2 build-stability cluster dominate ticket inflow. Kort (×4) and Mitie are customer / commercial holds, not engineering: Kort needs IP whitelisting from the customer, Mitie awaits a commercial decision and live API access." },
    { title: "Keep builds and live processes healthy", color: "#534AB7", body: "Seven net-new V2 builds active; support live V1 and V2 production — open platform issues below." },
  ],
  platformIssuesTitle: "Live production issues needing attention · V1 + platform (outside the migration label)",
  platformIssues: [
    { id: "MAN-3794", title: "Century · V1 — Carrier Booking subprocess returns a 503 in the UI", sev: "Urgent", sevTone: "urgent", state: "Triage" },
    { id: "KOG-11848", title: "Conectiv · V1 — SharePoint download files error", sev: "Urgent", sevTone: "urgent", state: "In Review" },
    { id: "KOG-11801", title: "Wipro · V1 — DynamoDB lock loses brain context on large PDFs, run fails", sev: "High", sevTone: "high", state: "In Review", note: "fix PR open — lock lease 60s → 180s" },
    { id: "OC-1412", title: "Platform — OOMKills on browser-pool pods in prod", sev: "High", sevTone: "high", state: "Todo", note: "same infra behind Kort / Century browser work" },
    { id: "MAN-3802", title: "TTX · V2 — \"Generation was lost\" error", sev: "High", sevTone: "high", state: "Todo" },
    { id: "KOG-11870", title: "V2 — \"Something went wrong\" when clicking the location tag icon", sev: "High", sevTone: "high", state: "In Review", note: "customer-reported" },
  ],

  ticketsDelta:
    "Live Linear, Jul 20. Open fell to 19 (from 34 on Jun 29): 17 closed in the last 7 days against 8 filed. 2 Urgent, 11 High. This list is the blocker label only; broader product feedback and ux-quality are not re-pulled here.",
  labelHealth: {
    label: "v2 Migration Blockers",
    asOf: "Jul 20",
    openNow: 19,
    prevOpen: 34,
    prevLabel: "Jun 29",
    urgentHigh: 13,
    filed7: 8,
    closed7: 17,
    flow: [
      { window: "Last 7 days", filed: 8, closed: 17 },
      { window: "Last 15 days", filed: 30, closed: 40 },
      { window: "Last 30 days", filed: 67, closed: 64 },
    ],
    note:
      "Open = still open on the v2 Migration Blockers label (triage / backlog / unstarted / started). 68 of 87 non-archived tickets on the label are now closed. Filed and closed use Linear creation and completion dates.",
  },
  ticketGroups: [
    {
      theme: "Quill2 build & drafts UX",
      rows: [
        { id: "KOG-11874", title: "JBI — Run Assistant can't add a mechanism to email on a business exception", state: "In Progress", tone: "prog" },
        { id: "MAN-3769", title: "Wipro LCC automation build fails at the limited-tool-iterations error", state: "In Progress", tone: "prog" },
        { id: "ENG-3711", title: "V2 feedback — drafts: exception not raised when a required field is missing", state: "Information Required", tone: "open" },
        { id: "ENG-4337", title: "Support managing triggers from Quill2", state: "Backlog", tone: "open" },
        { id: "ENG-4480", title: "Quill2 build experience: agent stability across long build sessions", state: "Backlog", tone: "open" },
        { id: "ENG-4494", title: "Quill2 agent behavior: regressions, unauthorized changes, memory loss", state: "Backlog", tone: "open" },
        { id: "ENG-4495", title: "SPy codegen robustness: language traps that fail silently", state: "Backlog", tone: "open" },
        { id: "ENG-4496", title: "IDP reliability and determinism in Quill2 builds", state: "Backlog", tone: "open" },
        { id: "ENG-4497", title: "Excel book and API surface friction in Quill2 builds", state: "Backlog", tone: "open" },
      ],
    },
    {
      theme: "IDP & Excel at scale",
      rows: [
        { id: "ENG-4429", title: "Increase BDK Excel pod memory for Conectiv V2 migration", state: "Validation", tone: "prog" },
        { id: "KOG-11815", title: "Gaps in v2 for executing large IDP processes", state: "In Progress", tone: "prog" },
        { id: "KOG-11859", title: "JBI — Document Processing service unresponsive in prod; no auto-retry", state: "Todo", tone: "open" },
        { id: "KOG-11865", title: "V2 | TTX | IDP failure — can't extract correct data from uploaded invoices", state: "Backlog", tone: "open" },
        { id: "KOG-11879", title: "JBI — timeout for IDP", state: "Backlog", tone: "open" },
      ],
    },
    {
      theme: "Connections & environments",
      rows: [
        { id: "INT-1521", title: "SFTP connection failing with no indicator why", state: "Validation", tone: "prog" },
        { id: "INT-1511", title: "JBI | V2 — Epicor is not discovering BAQs", state: "Information Required", tone: "open" },
        { id: "ENG-4604", title: "Singular Collection is down", state: "Triage", tone: "open" },
        { id: "KOG-11842", title: "Mitie — UK instance of v2 for v1 process migration", state: "Backlog", tone: "open" },
      ],
    },
    {
      theme: "Live automations & runtime",
      rows: [
        { id: "ENG-4476", title: "Live automations — Urgent: the expand button for outputs has disappeared", state: "In Progress", tone: "prog" },
      ],
    },
  ],
  ticketsFootnote:
    "The 19 open are grouped by theme above with verbatim Linear titles; the ticket-health tiles summarize the same label. Closed on the label in the last 30 days: 64.",

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
      title: "3 · Mitie PCard — commercial and access",
      body: "Internal testing is proceeding on mock data for Maximo and Coupa. Live rollout is gated on a commercial discussion and customer API access / whitelisting; no UAT date yet.",
      decide: "Prioritize the commercial conversation to unlock live API access, or hold at mock-data validation until commercials close.",
    },
  ],

  sources:
    "Sources: migration tracker Working Sheet (75 processes / 45 migrating, Jul 20) drives the estate and journey endpoints; the live Monday Projects board (Jul 20) drives net-new and the queued count; live Linear (Jul 20) drives the open v2 Migration Blockers list (19 open of 87 non-archived), the ticket-health tiles, and the refreshed platform-issues list. Stage placements apply field corrections: Century cleared by the completed collections fuzzy-match, Mitie held on a commercial decision and live API access. Live-in-production, footprint, and enhancements are the delivery-portfolio estate. Decisions are hand-maintained. The journey blocker burn-up is on the live label basis, so the cumulative-created endpoint (≈98) is approximate; 19 open is exact.",
};

// Latest first. Append new weeks at the top.
export const WEEKS: V2Week[] = [WEEK_2026_07_20, WEEK_2026_07_13, WEEK_2026_07_06];
