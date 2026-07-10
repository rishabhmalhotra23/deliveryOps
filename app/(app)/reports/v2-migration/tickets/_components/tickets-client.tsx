"use client";

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { TicketsBundle } from "@/lib/tickets/loader";
import {
  CLASSIFICATION_LABELS,
  DOMAIN_LABELS,
  type TicketClassification,
  type TicketDomain,
  type TicketRow,
  type TeamAsk,
  type AskPriorityTier,
} from "@/lib/tickets/types";

const MUTED = "text-[color:var(--muted-foreground)]";

// ── Small pieces (mirrors the All Hands report's tone-pill pattern) ───────────

const TONE_PILL: Record<string, string> = {
  risk: "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  watch: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  prog: "bg-blue-500/12 text-blue-700 dark:text-blue-400 border-blue-500/25",
  neutral: "bg-[var(--brand-seasalt)] text-[color:var(--foreground)] border-[var(--brand-metal-line)]",
};

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${TONE_PILL[tone] ?? TONE_PILL.neutral}`}>
      {children}
    </span>
  );
}

const CLASSIFICATION_TONE: Record<TicketClassification | "unclassified", string> = {
  hard_blocker: "risk",
  workaround_exists: "watch",
  transient_retry: "prog",
  just_a_bug: "neutral",
  unclassified: "neutral",
};

function classificationTone(c: TicketClassification | null): string {
  return CLASSIFICATION_TONE[c ?? "unclassified"];
}
function classificationLabel(c: TicketClassification | null): string {
  return c ? CLASSIFICATION_LABELS[c] : "Unclassified";
}

function priorityTone(p: string | null): string {
  const t = (p ?? "").toLowerCase();
  if (t === "urgent") return "risk";
  if (t === "high") return "watch";
  if (t === "medium") return "prog";
  return "neutral";
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-[color:var(--foreground)] flex items-center gap-2 mb-1">
      <span style={{ color: "#A8B400" }}>✴</span>{children}
    </h2>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ── Export (mirrors the weekly report's html-to-image pattern) ────────────────
function ExportButtons({ reportRef }: { reportRef: RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  async function downloadPng() {
    setState("loading");
    try {
      const el = reportRef.current;
      if (!el) throw new Error("No report element");
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: window.getComputedStyle(document.documentElement).getPropertyValue("--background").trim() || "#ffffff",
        style: { maxWidth: "none" },
        filter: (node) => !(node instanceof HTMLImageElement && !node.src.startsWith(window.location.origin)),
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `deliveryops-open-tickets-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setState("done");
    } catch (err) {
      console.error("[export-png]", err);
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 3000);
    }
  }
  const label = state === "loading" ? "Rendering…" : state === "done" ? "Saved ✓" : state === "error" ? "Failed — try Print" : "Download PNG";
  return (
    <div className="flex items-center gap-2 print:hidden">
      <button onClick={downloadPng} disabled={state === "loading"}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 transition-colors">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {label}
      </button>
      <button onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print / PDF
      </button>
    </div>
  );
}

function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function refresh() {
    setState("loading");
    try {
      const res = await fetch("/api/tickets/refresh", { method: "POST" });
      if (!res.ok && res.status !== 207) throw new Error(`refresh failed (${res.status})`);
      router.refresh();
      setState("idle");
    } catch (err) {
      console.error("[tickets-refresh]", err);
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }
  return (
    <button onClick={refresh} disabled={state === "loading"}
      className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 transition-colors print:hidden">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      {state === "loading" ? "Refreshing…" : state === "error" ? "Failed — retry" : "Refresh from Linear"}
    </button>
  );
}

// ── Delta cards ────────────────────────────────────────────────────────────────
function DeltaCards({ bundle }: { bundle: TicketsBundle }) {
  const d = bundle.delta;
  const cards = [
    { label: "New this week", value: d.new_count, sub: `since ${fmtDate(d.since)}`, hero: true },
    { label: "New hard blockers", value: d.new_hard_blocker, sub: "critical, no workaround" },
    { label: "New bugs", value: d.new_just_a_bug, sub: "just a bug — not blocking" },
    { label: "Newly closed", value: d.newly_closed, sub: "resolved this week" },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={c.hero ? "rounded-xl p-4" : "glass-card rounded-xl p-4"}
          style={c.hero ? { background: "var(--brand-night)" } : undefined}>
          <div className="text-3xl font-bold leading-none" style={{ color: c.hero ? "var(--brand-yellow)" : "var(--foreground)" }}>{c.value}</div>
          <div className="text-xs font-semibold mt-2" style={{ color: c.hero ? "#D4D4D4" : "var(--foreground)" }}>{c.label}</div>
          <div className="text-[11px] mt-0.5" style={{ color: c.hero ? "#A3A3A3" : "var(--muted-foreground)" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Classification bar ──────────────────────────────────────────────────────────
function ClassificationBar({ bundle }: { bundle: TicketsBundle }) {
  const total = bundle.totals.open || 1;
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex h-3 rounded-full overflow-hidden mb-4">
        {bundle.classification_breakdown.map((c) => {
          const pct = (c.count / total) * 100;
          if (pct === 0) return null;
          const bg = c.classification === "hard_blocker" ? "#E24B4A"
            : c.classification === "workaround_exists" ? "#EF9F27"
            : c.classification === "transient_retry" ? "#378ADD"
            : c.classification === "just_a_bug" ? "#A3A3A3"
            : "var(--brand-metal-line)";
          return <div key={c.classification} style={{ width: `${pct}%`, background: bg }} title={`${classificationLabel(c.classification === "unclassified" ? null : c.classification)}: ${c.count}`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-4">
        {bundle.classification_breakdown.map((c) => (
          <div key={c.classification} className="flex items-center gap-2">
            <Pill tone={classificationTone(c.classification === "unclassified" ? null : c.classification)}>
              {classificationLabel(c.classification === "unclassified" ? null : c.classification)}
            </Pill>
            <span className="text-sm font-semibold text-[color:var(--foreground)]">{c.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ticket row + domain-grouped table ───────────────────────────────────────────
function TicketRowView({ t }: { t: TicketRow }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[var(--brand-metal-line)] last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <a href={t.url} target="_blank" rel="noreferrer"
            className="font-mono text-[11px] text-blue-700 dark:text-blue-400 border-b border-dotted border-blue-300 hover:border-solid">{t.id}</a>
          <span className="text-[12.5px] text-[color:var(--foreground)] leading-snug">{t.title}</span>
        </div>
        <div className={`text-[10.5px] ${MUTED} mt-0.5`}>
          {t.team ?? "—"} · {t.linear_status} · opened {fmtDate(t.linear_created_at)}
          {t.rationale ? <span> · {t.rationale}</span> : null}
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {t.priority ? <Pill tone={priorityTone(t.priority)}>{t.priority}</Pill> : null}
        <Pill tone={classificationTone(t.classification)}>{classificationLabel(t.classification)}</Pill>
      </div>
    </div>
  );
}

interface Filters {
  classification: TicketClassification | "all";
  domain: TicketDomain | "all";
  team: string | "all";
  search: string;
}

function TicketsTable({ tickets }: { tickets: TicketRow[] }) {
  const groups = useMemo(() => {
    const order: (TicketDomain | "unclassified")[] = [
      "idp_document_processing", "browser_automation", "integrations_connectors",
      "drafts_quill_ux", "live_automations_runtime", "platform_infra", "other", "unclassified",
    ];
    const byDomain = new Map<string, TicketRow[]>();
    for (const t of tickets) {
      const key = t.domain ?? "unclassified";
      const arr = byDomain.get(key) ?? [];
      arr.push(t);
      byDomain.set(key, arr);
    }
    return order
      .map((d) => ({ domain: d, rows: byDomain.get(d) ?? [] }))
      .filter((g) => g.rows.length > 0);
  }, [tickets]);

  if (tickets.length === 0) {
    return <div className="glass-card rounded-2xl p-6 text-sm text-center text-[color:var(--muted-foreground)]">No tickets match the current filters.</div>;
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      {groups.map((g) => (
        <div key={g.domain}>
          <div className="flex items-center justify-between gap-2 bg-[var(--brand-seasalt)] border border-[var(--brand-metal-line)] rounded-lg px-3 py-1.5 mt-4 mb-1.5 first:mt-0">
            <span className="text-[11px] uppercase tracking-wide font-bold text-[color:var(--foreground)]">
              {g.domain === "unclassified" ? "Unclassified" : DOMAIN_LABELS[g.domain]}
            </span>
            <span className="text-[10px] font-semibold text-[color:var(--muted-foreground)] whitespace-nowrap">{g.rows.length} open</span>
          </div>
          {g.rows.map((t) => <TicketRowView key={t.id} t={t} />)}
        </div>
      ))}
    </div>
  );
}

function FilterBar({ filters, setFilters, teams }: { filters: Filters; setFilters: (f: Filters) => void; teams: string[] }) {
  const selectCls = "rounded-lg border border-[var(--glass-border)] bg-transparent px-2.5 py-1.5 text-xs text-[color:var(--foreground)]";
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <input
        value={filters.search}
        onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        placeholder="Search title or ID…"
        className={`${selectCls} min-w-[180px]`}
      />
      <select value={filters.classification} onChange={(e) => setFilters({ ...filters, classification: e.target.value as Filters["classification"] })} className={selectCls}>
        <option value="all">All classifications</option>
        {(["hard_blocker", "workaround_exists", "transient_retry", "just_a_bug"] as TicketClassification[]).map((c) => (
          <option key={c} value={c}>{CLASSIFICATION_LABELS[c]}</option>
        ))}
      </select>
      <select value={filters.domain} onChange={(e) => setFilters({ ...filters, domain: e.target.value as Filters["domain"] })} className={selectCls}>
        <option value="all">All domains</option>
        {(Object.keys(DOMAIN_LABELS) as TicketDomain[]).map((d) => (
          <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>
        ))}
      </select>
      <select value={filters.team} onChange={(e) => setFilters({ ...filters, team: e.target.value })} className={selectCls}>
        <option value="all">All teams</option>
        {teams.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}

// ── Team asks ────────────────────────────────────────────────────────────────────
const TIER_LABEL: Record<AskPriorityTier, string> = { now: "Now", soon: "Soon", later: "Later" };
const TIER_COLOR: Record<AskPriorityTier, string> = { now: "#A32D2D", soon: "#BA7517", later: "#185FA5" };

function AskCard({ ask, onChanged }: { ask: TeamAsk; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function setStatus(status: TeamAsk["status"]) {
    setBusy(true);
    try {
      await fetch(`/api/tickets/team-asks/${ask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      onChanged();
    } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/tickets/team-asks/${ask.id}`, { method: "DELETE" });
      onChanged();
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-[var(--brand-metal-line)] bg-[var(--brand-seasalt)] p-3 space-y-1.5">
      <div className="text-[12.5px] text-[color:var(--foreground)] leading-snug">{ask.ask_text}</div>
      <div className={`text-[10.5px] ${MUTED}`}>{ask.requester}{ask.notes ? ` · ${ask.notes}` : ""}</div>
      {ask.tickets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ask.tickets.map((t) => <span key={t.id} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--background)] border border-[var(--brand-metal-line)]">{t.id}</span>)}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1 print:hidden">
        <select disabled={busy} value={ask.status} onChange={(e) => setStatus(e.target.value as TeamAsk["status"])}
          className="rounded border border-[var(--glass-border)] bg-transparent px-1.5 py-0.5 text-[10.5px] text-[color:var(--foreground)]">
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <button disabled={busy} onClick={remove} className={`text-[10.5px] ${MUTED} hover:text-red-600`}>Remove</button>
      </div>
    </div>
  );
}

function AddAskForm({ tier, onChanged }: { tier: AskPriorityTier; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [requester, setRequester] = useState("");
  const [ticketIds, setTicketIds] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!askText.trim() || !requester.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/tickets/team-asks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ask_text: askText.trim(),
          requester: requester.trim(),
          priority_tier: tier,
          ticket_ids: ticketIds.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      setAskText(""); setRequester(""); setTicketIds(""); setOpen(false);
      onChanged();
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`text-[11px] ${MUTED} hover:text-[color:var(--foreground)] print:hidden`}>+ Add ask</button>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-[var(--brand-metal-line)] p-3 space-y-1.5 print:hidden">
      <input value={askText} onChange={(e) => setAskText(e.target.value)} placeholder="What do we need?"
        className="w-full rounded border border-[var(--glass-border)] bg-transparent px-2 py-1 text-[12px]" />
      <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Requester"
        className="w-full rounded border border-[var(--glass-border)] bg-transparent px-2 py-1 text-[12px]" />
      <input value={ticketIds} onChange={(e) => setTicketIds(e.target.value)} placeholder="Linked ticket IDs (comma-separated, optional)"
        className="w-full rounded border border-[var(--glass-border)] bg-transparent px-2 py-1 text-[12px]" />
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={submit} className="btn-primary rounded-lg px-3 py-1 text-[11px] font-semibold">Add</button>
        <button onClick={() => setOpen(false)} className={`text-[11px] ${MUTED}`}>Cancel</button>
      </div>
    </div>
  );
}

function TeamAsksSection({ bundle }: { bundle: TicketsBundle }) {
  const router = useRouter();
  const onChanged = () => router.refresh();
  const tiers: AskPriorityTier[] = ["now", "soon", "later"];
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {tiers.map((tier) => (
        <div key={tier} className="glass-card rounded-2xl p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wide font-bold" style={{ color: TIER_COLOR[tier] }}>{TIER_LABEL[tier]}</div>
          {bundle.team_asks[tier].length === 0 ? (
            <div className={`text-[11px] ${MUTED} italic`}>Nothing pinned.</div>
          ) : (
            <div className="space-y-2">
              {bundle.team_asks[tier].map((a) => <AskCard key={a.id} ask={a} onChanged={onChanged} />)}
            </div>
          )}
          <AddAskForm tier={tier} onChanged={onChanged} />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function TicketsClient({ bundle }: { bundle: TicketsBundle }) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Filters>({ classification: "all", domain: "all", team: "all", search: "" });

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const t of bundle.open_tickets) if (t.team) set.add(t.team);
    return Array.from(set).sort();
  }, [bundle.open_tickets]);

  const filteredTickets = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return bundle.open_tickets.filter((t) => {
      if (filters.classification !== "all" && t.classification !== filters.classification) return false;
      if (filters.domain !== "all" && t.domain !== filters.domain) return false;
      if (filters.team !== "all" && t.team !== filters.team) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bundle.open_tickets, filters]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <span className={`text-xs ${MUTED}`}>
          {bundle.last_synced_at ? `Linear last synced ${fmtDate(bundle.last_synced_at)}` : "Not yet synced"} · {bundle.totals.open} open · {bundle.totals.unclassified_open} unclassified
        </span>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <ExportButtons reportRef={reportRef} />
        </div>
      </div>

      {bundle.data_error && (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "rgba(226,75,74,0.35)", background: "rgba(226,75,74,0.06)", color: "#A32D2D" }}>
          Couldn&apos;t load ticket data: {bundle.data_error}
        </div>
      )}

      <div ref={reportRef} className="space-y-7">
        {/* Header */}
        <div className="rounded-2xl px-7 py-6" style={{ background: "var(--brand-night)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#A3A3A3" }}>V2 Migration · Engineering tickets</div>
          <h1 className="text-2xl font-bold tracking-tight mt-1" style={{ color: "#FFFFFF" }}>Open tickets</h1>
          <div className="text-sm mt-1.5" style={{ color: "#D4D4D4" }}>Linear (live) · classification is a periodic human/Claude pass, not automated</div>
          <p className="text-[13px] mt-3 leading-relaxed max-w-[820px]" style={{ color: "#E5E5E5" }}>
            Casts a wide net across V2 migration blocker labels, feedback labels, and On-Call/Integrations/Product
            Improvements team queues — the same set used in the original triage pass. Out-of-scope noise gets
            flagged by the classification pass rather than filtered out here, so nothing quietly disappears.
          </p>
        </div>

        <section>
          <SectionLabel>This week</SectionLabel>
          <DeltaCards bundle={bundle} />
        </section>

        <section>
          <SectionLabel>Open tickets by classification</SectionLabel>
          <ClassificationBar bundle={bundle} />
        </section>

        <section className="space-y-2">
          <SectionLabel>Top priorities</SectionLabel>
          <TeamAsksSection bundle={bundle} />
        </section>

        <section className="space-y-2">
          <SectionLabel>All open tickets, by domain</SectionLabel>
          <FilterBar filters={filters} setFilters={setFilters} teams={teams} />
          <TicketsTable tickets={filteredTickets} />
        </section>

        <p className={`text-[11px] ${MUTED} leading-relaxed border-t border-[var(--brand-metal-line)] pt-3.5`}>
          Raw fields (title, status, priority, dates) sync daily from Linear plus on-demand via Refresh.
          Classification, confidence, domain, and in-scope flags are set by a periodic Claude-assisted review and are
          never written back to Linear — update the underlying ticket by hand if it needs to change.
        </p>
      </div>
    </div>
  );
}
