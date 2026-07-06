"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  REPORT_DATE_LABEL, LINEAR_ISSUE, SNAPSHOT, MIGRATE_FUNNEL, MIGRATE_FINISH_HEADLINE,
  ESTATE_SPLIT, RETIRE_BREAKDOWN, ESTATE_INTRO, ESTATE_FINISH_NOTE, ESTATE_OPEN_DECISION,
  ESTATE_SOURCE_NOTE, PARITY_HEADLINE, PARITY_PASTDUE, PARITY_UPCOMING, PARITY_FOOTNOTE,
  NET_NEW, NET_NEW_NOTE, RENEWALS_ACTIVE, RENEWALS_HEADLINE,
  RENEWALS_DROPPING, NOT_MIGRATING, BLOCKERS_RESOLVED, BLOCKERS_RESOLVED_NOTE,
  BLOCKERS_RESOLVED_FOOTNOTE, BLOCKERS_OPEN, DECISIONS, SOURCES_NOTE,
  type Tone, type BlockerRow,
} from "@/lib/reports/v2-migration-allhands";

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
      a.download = "deliveryops-v2-migration-2026-06-29.png";
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

// ── Small pieces ──────────────────────────────────────────────────────────────
const MUTED = "text-[color:var(--muted-foreground)]";
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-[color:var(--foreground)] flex items-center gap-2 mb-3">
      <span className="text-[var(--brand-yellow)]" style={{ color: "#A8B400" }}>✴</span>{children}
    </h2>
  );
}
function Tik({ id }: { id: string }) {
  return (
    <a href={LINEAR_ISSUE(id)} target="_blank" rel="noreferrer"
      className="font-mono text-[11px] text-blue-700 dark:text-blue-400 border-b border-dotted border-blue-300 hover:border-solid">
      {id}
    </a>
  );
}
const TONE_PILL: Record<string, string> = {
  strong: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  watch: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  risk: "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  done: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  prog: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  open: "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
};
function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${TONE_PILL[tone] ?? TONE_PILL.open}`}>{children}</span>;
}
function StackBar({ stages, total }: { stages: { label: string; count: number; color: string }[]; total: number }) {
  return (
    <div className="flex h-6 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      {stages.map((s) => (
        <div key={s.label} title={`${s.label} ${s.count}`} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}
function Legend({ stages, suffixCounts = true }: { stages: { label: string; count: number; color: string }[]; suffixCounts?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-[color:var(--foreground)]">
      {stages.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}{suffixCounts ? ` ${s.count}` : ""}
        </span>
      ))}
    </div>
  );
}

export function V2MigrationLegacy() {
  const reportRef = useRef<HTMLDivElement>(null);
  const estateTotal = ESTATE_SPLIT.reduce((s, x) => s + x.count, 0);
  const migrateTotal = MIGRATE_FUNNEL.reduce((s, x) => s + x.count, 0);
  const retireTotal = ESTATE_SPLIT.find((s) => s.label.toLowerCase().includes("retire"))?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* Controls (not captured) */}
      <div className="flex items-center justify-between gap-4">
        <p className={`text-xs ${MUTED}`}>Curated snapshot · export as PNG for the All Hands deck</p>
        <ExportButtons reportRef={reportRef} />
      </div>

      {/* Captured report */}
      <div ref={reportRef} className="space-y-7">
        {/* Header */}
        <div className="rounded-2xl px-7 py-6" style={{ background: "var(--brand-night)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#A3A3A3" }}>Field Delivery · Company All Hands</div>
          <h1 className="text-2xl font-bold tracking-tight mt-1" style={{ color: "#FFFFFF" }}>Delivery and V2 migration</h1>
          <div className="text-sm mt-1.5" style={{ color: "#D4D4D4" }}>{REPORT_DATE_LABEL} · migration tracker, Monday, and Linear (live)</div>
        </div>

        {/* Snapshot */}
        <section>
          <SectionLabel>Delivery snapshot</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {SNAPSHOT.map((m) => (
              <div key={m.label} className={m.hero ? "rounded-xl p-4" : "glass-card rounded-xl p-4"}
                style={m.hero ? { background: "var(--brand-night)" } : undefined}>
                <div className="text-3xl font-bold leading-none" style={{ color: m.hero ? "var(--brand-yellow)" : "var(--foreground)" }}>{m.value}</div>
                <div className="text-xs font-semibold mt-2" style={{ color: m.hero ? "#D4D4D4" : "var(--foreground)" }}>{m.label}</div>
                <div className="text-[11px] mt-0.5" style={{ color: m.hero ? "#A3A3A3" : "var(--muted-foreground)" }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* V1 estate */}
        <section>
          <SectionLabel>The V1 estate: migrate or retire</SectionLabel>
          <div className="glass-card rounded-2xl p-5 space-y-4">
            <p className="text-sm text-[color:var(--foreground)] leading-relaxed">{ESTATE_INTRO}</p>
            <div>
              <div className="flex h-7 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10 text-[11px] font-semibold text-white">
                {ESTATE_SPLIT.map((s) => (
                  <div key={s.label} className="flex items-center justify-center" style={{ width: `${(s.count / estateTotal) * 100}%`, background: s.color }}>
                    {(s.count / estateTotal) > 0.06 ? s.count : ""}
                  </div>
                ))}
              </div>
              <Legend stages={ESTATE_SPLIT} />
            </div>
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3 rounded-xl border border-[var(--brand-metal-line)] p-4">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)]"><span className="text-xl font-bold mr-1" style={{ color: "#185FA5" }}>{migrateTotal}</span> Migrate to V2</h3>
                <div className={`text-[11px] ${MUTED} mt-0.5 mb-2.5`}>{MIGRATE_FINISH_HEADLINE}</div>
                <StackBar stages={MIGRATE_FUNNEL} total={migrateTotal} />
                <Legend stages={MIGRATE_FUNNEL} />
                <p className={`text-[11px] ${MUTED} mt-3 leading-relaxed`}>{ESTATE_FINISH_NOTE}</p>
              </div>
              <div className="lg:col-span-2 rounded-xl border border-[var(--brand-metal-line)] p-4">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)]"><span className="text-xl font-bold mr-1" style={{ color: "#737373" }}>{retireTotal}</span> Retire with V1</h3>
                <div className={`text-[11px] ${MUTED} mt-0.5 mb-2.5`}>not migrating; switched off when V1 is retired</div>
                {RETIRE_BREAKDOWN.map((r) => (
                  <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-[var(--brand-metal-line)] last:border-b-0 text-[12.5px] text-[color:var(--foreground)]">
                    <span>{r.label}</span><span className="font-semibold">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--brand-seasalt)] border border-[var(--brand-metal-line)] border-l-[3px] border-l-[var(--brand-yellow)] px-3.5 py-2.5 text-[12px] text-[color:var(--foreground)] leading-relaxed">
              {ESTATE_OPEN_DECISION}
            </div>
            <p className={`text-[11px] ${MUTED} leading-relaxed`}>{ESTATE_SOURCE_NOTE}</p>
          </div>
        </section>

        {/* What's next: parity targets */}
        <section>
          <SectionLabel>Path to v1 parity — all {migrateTotal} by July 3</SectionLabel>
          <div className="glass-card rounded-2xl p-5">
            <p className="text-[12.5px] text-[color:var(--foreground)] leading-relaxed mb-3.5">{PARITY_HEADLINE}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {/* Past due — in flight */}
              <div className="rounded-xl border border-[var(--brand-metal-line)] bg-[var(--brand-seasalt)] p-3">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[12.5px] font-semibold text-[color:var(--foreground)]">{PARITY_PASTDUE.label}</span>
                  <span className="text-base font-bold" style={{ color: "#185FA5" }}>{PARITY_PASTDUE.count}</span>
                </div>
                <div className="text-[11.5px] leading-relaxed text-[color:var(--foreground)]">
                  {PARITY_PASTDUE.lines.map((line, i) => (
                    <div key={i}>
                      {line.map((seg, j) => (
                        <span key={j} style={seg.c ? { color: seg.c, fontWeight: 600 } : undefined}>{seg.t}</span>
                      ))}
                    </div>
                  ))}
                </div>
                <div className={`text-[10.5px] ${MUTED} leading-relaxed mt-2 border-t border-[var(--brand-metal-line)] pt-2`}>{PARITY_PASTDUE.blocked}</div>
              </div>
              {/* Upcoming cohorts */}
              {PARITY_UPCOMING.map((c) => (
                <div key={c.label} className={`rounded-xl border border-[var(--brand-metal-line)] bg-[var(--brand-seasalt)] p-3 ${c.deadline ? "border-l-[3px] border-l-[var(--brand-yellow)]" : ""}`}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[12.5px] font-semibold text-[color:var(--foreground)]">{c.label}</span>
                    <span className="text-base font-bold" style={{ color: "#185FA5" }}>{c.count}</span>
                  </div>
                  <div className="text-[11px] leading-relaxed">
                    {c.items.map((it) => (
                      <div key={it.name} className={it.blocked ? "" : MUTED} style={it.blocked ? { color: "#B91C1C" } : undefined}>
                        {it.name}{it.blocked ? " ⚠" : ""}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className={`text-[11px] ${MUTED} leading-relaxed mt-3 border-t border-[var(--brand-metal-line)] pt-3`}>{PARITY_FOOTNOTE}</p>
          </div>
        </section>

        {/* Net-new dev */}
        <section>
          <SectionLabel>Net-new V2 development (not migration)</SectionLabel>
          <div className="glass-card rounded-2xl p-5">
            <p className={`text-[11px] ${MUTED} mb-3`}>{NET_NEW_NOTE}</p>
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] border-b border-[var(--brand-metal-line)]">
                <th className="py-2 pr-3 font-semibold">Process</th><th className="py-2 pr-3 font-semibold">Owner</th><th className="py-2 pr-3 font-semibold">Phase</th><th className="py-2 font-semibold">Latest update (from Monday)</th>
              </tr></thead>
              <tbody>
                {NET_NEW.map((r) => (
                  <tr key={r.process} className="border-b border-[var(--brand-metal-line)] last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[color:var(--foreground)] whitespace-nowrap">{r.process}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.owner}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.phase}</td>
                    <td className="py-2 text-[color:var(--foreground)]">{r.update}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Renewals */}
        <section>
          <SectionLabel>Renewals this quarter, and migration readiness</SectionLabel>
          <div className="glass-card rounded-2xl p-5">
            <p className="text-[12.5px] font-medium text-[color:var(--foreground)] mb-3">{RENEWALS_HEADLINE}</p>
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] border-b border-[var(--brand-metal-line)]">
                <th className="py-2 pr-3 font-semibold">Account</th><th className="py-2 pr-3 font-semibold">Renewal</th><th className="py-2 pr-3 font-semibold">Renewal health</th><th className="py-2 font-semibold">Migration readiness</th>
              </tr></thead>
              <tbody>
                {RENEWALS_ACTIVE.map((r) => (
                  <tr key={r.account} className="border-b border-[var(--brand-metal-line)] last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[color:var(--foreground)] whitespace-nowrap">{r.account}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.renewal}</td>
                    <td className="py-2 pr-3"><Pill tone={r.tone as Tone}>{r.health}</Pill></td>
                    <td className="py-2 text-[color:var(--foreground)]">{r.readiness}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] font-semibold mt-4 mb-1">Accounts being dropped or under commercial review</div>
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] border-b border-[var(--brand-metal-line)]">
                <th className="py-2 pr-3 font-semibold">Account</th><th className="py-2 pr-3 font-semibold">Renewal</th><th className="py-2 pr-3 font-semibold">Renewal health</th><th className="py-2 font-semibold">Status / decision</th>
              </tr></thead>
              <tbody>
                {RENEWALS_DROPPING.map((r) => (
                  <tr key={r.account} className="border-b border-[var(--brand-metal-line)] last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[color:var(--foreground)] whitespace-nowrap">{r.account}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.renewal}</td>
                    <td className="py-2 pr-3"><Pill tone={r.tone as Tone}>{r.health}</Pill></td>
                    <td className={`py-2 ${MUTED}`}>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Not migrating */}
        <section>
          <SectionLabel>Not migrating: decisions and rationale</SectionLabel>
          <div className="glass-card rounded-2xl p-5">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] border-b border-[var(--brand-metal-line)]">
                <th className="py-2 pr-3 font-semibold">Account / Process</th><th className="py-2 pr-3 font-semibold">Decision</th><th className="py-2 font-semibold">Rationale</th>
              </tr></thead>
              <tbody>
                {NOT_MIGRATING.map((r) => (
                  <tr key={r.item} className="border-b border-[var(--brand-metal-line)] last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[color:var(--foreground)]">{r.item}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.decision}</td>
                    <td className={`py-2 ${MUTED}`}>{r.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Blockers */}
        <section>
          <SectionLabel>Migration blockers (live)</SectionLabel>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="glass-card rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Resolved since last update ({BLOCKERS_RESOLVED.length})</h3>
              <p className={`text-[11px] ${MUTED} mt-0.5 mb-3`}>{BLOCKERS_RESOLVED_NOTE}</p>
              {BLOCKERS_RESOLVED.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-[var(--brand-metal-line)] last:border-b-0 text-[12.5px] text-[color:var(--foreground)]">
                  <span><Tik id={b.id} /> {b.item}</span><Pill tone="done">{b.status}</Pill>
                </div>
              ))}
              <p className={`text-[11px] ${MUTED} leading-relaxed mt-3 border-t border-[var(--brand-metal-line)] pt-3`}>{BLOCKERS_RESOLVED_FOOTNOTE}</p>
            </div>
            <div className="glass-card rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Open — migration-critical ({BLOCKERS_OPEN.length})</h3>
              <p className={`text-[11px] ${MUTED} mt-0.5 mb-2`}>
                Linear label: <a href="https://linear.app/kognitos/issue-label/v2%20migration%20blockers" target="_blank" rel="noreferrer" className="font-mono text-blue-700 dark:text-blue-400 border-b border-dotted border-blue-300 hover:border-solid">v2 Migration Blockers</a>
              </p>
              {renderOpenGrouped(BLOCKERS_OPEN)}
            </div>
          </div>
        </section>

        {/* Decision points */}
        <section>
          <SectionLabel>Key decision points</SectionLabel>
          <div className="grid gap-4 lg:grid-cols-2">
            {DECISIONS.map((d) => (
              <div key={d.title} className="glass-card rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)] mb-2">{d.title}</h3>
                <p className="text-[12px] text-[color:var(--foreground)] leading-relaxed mb-2">{d.context}</p>
                <p className={`text-[11.5px] ${MUTED} leading-relaxed mb-2.5`}>{d.workaround}</p>
                <div className="text-[12px] text-[color:var(--foreground)] bg-[var(--brand-seasalt)] border-l-[3px] border-l-[var(--brand-yellow)] rounded-r-lg px-3 py-2 leading-snug">
                  <span className="font-semibold">{d.verb ?? "Decide"}:</span> {d.decide}
                </div>
                {d.refs.length > 0 && (
                  <div className={`text-[11px] ${MUTED} mt-2`}>Reference: {d.refs.map((id, i) => (<span key={id}>{i > 0 ? ", " : ""}<Tik id={id} /></span>))}</div>
                )}
              </div>
            ))}
          </div>
        </section>

        <p className={`text-[11px] ${MUTED} leading-relaxed border-t border-[var(--brand-metal-line)] pt-3.5`}>{SOURCES_NOTE}</p>
      </div>
    </div>
  );
}

function renderOpenGrouped(rows: BlockerRow[]) {
  const groups = Array.from(new Set(rows.map((r) => r.theme))) as string[];
  return groups.map((g) => (
    <div key={g}>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[color:var(--muted-foreground)] mt-3 mb-1 first:mt-0">{g}</div>
      {rows.filter((r) => r.theme === g).map((b) => (
        <div key={b.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-[var(--brand-metal-line)] last:border-b-0 text-[12.5px] text-[color:var(--foreground)]">
          <span><Tik id={b.id} /> {b.item}</span><Pill tone={b.tone ?? "open"}>{b.status}</Pill>
        </div>
      ))}
    </div>
  ));
}
