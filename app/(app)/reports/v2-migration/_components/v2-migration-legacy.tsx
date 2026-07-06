"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  WEEKS, LINEAR_ISSUE, LINEAR_BLOCKER_LABEL,
  type V2Week, type JourneyData, type BoardChip,
} from "@/lib/reports/v2-allhands-weeks";

// ── Export (mirrors the weekly report's html-to-image pattern) ────────────────
function ExportButtons({ reportRef, weekKey }: { reportRef: RefObject<HTMLDivElement | null>; weekKey: string }) {
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
      a.download = `deliveryops-v2-migration-${weekKey}.png`;
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
    <h2 className="text-sm font-semibold text-[color:var(--foreground)] flex items-center gap-2 mb-1">
      <span style={{ color: "#A8B400" }}>✴</span>{children}
    </h2>
  );
}
function DeltaLine({ children }: { children: ReactNode }) {
  return <p className={`text-[11px] ${MUTED} mb-3`}>{children}</p>;
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
  prog: "bg-blue-500/12 text-blue-700 dark:text-blue-400 border-blue-500/25",
  open: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  urgent: "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  high: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
};
function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${TONE_PILL[tone] ?? TONE_PILL.open}`}>{children}</span>;
}
function Chip({ chip, stageColor }: { chip: BoardChip; stageColor: string }) {
  const moverBorder = chip.mover ? { borderColor: chip.mover === "down" ? "#E24B4A" : stageColor } : undefined;
  return (
    <span
      className="inline-flex items-baseline gap-1 text-[11px] rounded-full border border-[var(--brand-metal-line)] bg-[var(--brand-seasalt)] px-2.5 py-0.5 text-[color:var(--foreground)]"
      style={moverBorder ? { ...moverBorder, background: "transparent" } : undefined}>
      {chip.mover === "up" ? <span className="font-semibold">▲ </span> : chip.mover === "down" ? <span className="font-semibold" style={{ color: "#E24B4A" }}>▼ </span> : null}
      <span className={chip.mover ? "font-medium" : undefined}>{chip.name}</span>
      {chip.note ? <span className={`${MUTED}`}>· {chip.note}</span> : null}
    </span>
  );
}

// ── Journey chart (two panels, shared timeline) ───────────────────────────────
const CHART = { x0: 60, x1: 560, procBase: 150, procTop: 30, tickBase: 275, tickTop: 218 };

function JourneyChart({ j }: { j: JourneyData }) {
  const n = j.dates.length;
  const xs = j.dates.map((_, i) => CHART.x0 + (i * (CHART.x1 - CHART.x0)) / (n - 1));
  const yProc = (v: number) => CHART.procBase - (v / j.procMax) * (CHART.procBase - CHART.procTop);
  const yTick = (v: number) => CHART.tickBase - (v / j.ticketMax) * (CHART.tickBase - CHART.tickTop);
  const pts = (vals: (number | null)[], y: (v: number) => number) =>
    vals.map((v, i) => (v === null ? null : `${xs[i]},${Math.round(y(v) * 10) / 10}`)).filter(Boolean) as string[];

  const finishPts = pts(j.finish, yProc);
  const blockedPts = pts(j.blocked, yProc);
  const createdPts = pts(j.ticketsCreated, yTick);
  const openPts = pts(j.ticketsOpen, yTick);
  const finishSolid = finishPts.slice(1); // first finish point is the dotted lead-in origin
  const firstFinishIdx = j.finish.findIndex((v) => v !== null);
  const li = n - 1;
  const lastX = xs[li];
  const lastFinish = j.finish[li] ?? 0;
  const gapMidY = (yTick(j.ticketsCreated[li - 1]) + yTick(j.ticketsOpen[li - 1])) / 2;

  const areaPath = `M${finishPts.join(" L")} L${lastX},${CHART.procBase} Z`;
  const gapPath = `M${createdPts.join(" L")} L${[...openPts].reverse().join(" L")} Z`;

  return (
    <svg viewBox="0 0 640 322" className="w-full h-auto block" role="img" aria-label="Migration journey: progress toward all 46 migrations at V1 parity, and cumulative blocker tickets">
      {/* goal line */}
      <line x1={CHART.x0} y1={CHART.procTop} x2={CHART.x1} y2={CHART.procTop} stroke="#1D9E75" strokeWidth={1.5} strokeDasharray="6 5" opacity={0.55} />
      <text x={CHART.x0} y={22} fontSize={10.5} fill="#0F6E56">{j.goalLabel}</text>
      {/* process axis */}
      <line x1={CHART.x0} y1={CHART.procBase} x2={CHART.x1} y2={CHART.procBase} stroke="var(--brand-metal-line)" strokeWidth={1} />
      <text x={54} y={CHART.procBase + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">0</text>
      <text x={54} y={CHART.procTop + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{j.procMax}</text>
      {/* finish area + lines */}
      <path d={areaPath} fill="#1D9E75" opacity={0.09} />
      <line x1={xs[firstFinishIdx]} y1={yProc(j.finish[firstFinishIdx] ?? 0)} x2={xs[firstFinishIdx + 1]} y2={yProc(j.finish[firstFinishIdx + 1] ?? 0)}
        stroke="#1D9E75" strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
      <polyline points={finishSolid.join(" ")} fill="none" stroke="#1D9E75" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={blockedPts.join(" ")} fill="none" stroke="#E24B4A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* dots + value labels */}
      {j.finish.map((v, i) =>
        v === null || i <= firstFinishIdx ? null : (
          <g key={`f${i}`}>
            <circle cx={xs[i]} cy={yProc(v)} r={i === li ? 5 : 4} fill="#1D9E75" />
            <text x={i === li ? xs[i] - 8 : xs[i]} y={yProc(v) - 10}
              textAnchor={i === li ? "end" : "middle"} fontSize={i === li ? 13 : 12} fontWeight={500} fill="#0F6E56">{v}</text>
          </g>
        ))}
      <text x={CHART.x1 - 8} y={yProc(lastFinish) - 24} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{j.finalLabels.toGo}</text>
      {j.blocked.map((v, i) =>
        v === null ? null : (
          <g key={`b${i}`}>
            <circle cx={xs[i]} cy={yProc(v)} r={3} fill="#E24B4A" />
            <text x={i === li ? xs[i] - 8 : xs[i]} y={yProc(v) + (v <= (j.finish[i] ?? 99) ? 15 : -8)}
              textAnchor={i === li ? "end" : "middle"} fontSize={10.5} fill="#A32D2D">{v}</text>
          </g>
        ))}
      {/* legend */}
      <circle cx={360} cy={170} r={3} fill="#1D9E75" /><text x={368} y={174} fontSize={10.5} fill="var(--foreground)">at or near finish</text>
      <circle cx={474} cy={170} r={3} fill="#E24B4A" /><text x={482} y={174} fontSize={10.5} fill="var(--foreground)">blocked processes</text>
      {/* ticket band */}
      <text x={CHART.x0} y={205} fontSize={10} fill="var(--muted-foreground)" fontWeight={600} letterSpacing="0.05em">BLOCKER TICKETS · CUMULATIVE</text>
      <line x1={CHART.x0} y1={CHART.tickBase} x2={CHART.x1} y2={CHART.tickBase} stroke="var(--brand-metal-line)" strokeWidth={1} />
      <text x={54} y={CHART.tickBase + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">0</text>
      <text x={54} y={CHART.tickTop + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{j.ticketMax}</text>
      <path d={gapPath} fill="#1D9E75" opacity={0.08} />
      <polyline points={createdPts.join(" ")} fill="none" stroke="#854F0B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={openPts.join(" ")} fill="none" stroke="#EF9F27" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={CHART.x1} cy={yTick(j.ticketsCreated[li])} r={3.5} fill="#854F0B" />
      <circle cx={CHART.x1} cy={yTick(j.ticketsOpen[li])} r={3.5} fill="#EF9F27" />
      <text x={CHART.x1 - 8} y={yTick(j.ticketsCreated[li]) - 5} textAnchor="end" fontSize={11} fontWeight={500} fill="#854F0B">{j.finalLabels.created}</text>
      <text x={CHART.x1 - 8} y={yTick(j.ticketsOpen[li]) + 14} textAnchor="end" fontSize={11} fill="#BA7517">{j.finalLabels.open}</text>
      <text x={xs[li - 1] + (xs[li] - xs[li - 1]) * 0.45} y={gapMidY} textAnchor="middle" fontSize={9.5} fill="#0F6E56">{j.finalLabels.resolvedGap}</text>
      {/* shared x-axis */}
      {xs.map((x) => <line key={x} x1={x} y1={CHART.tickBase} x2={x} y2={CHART.tickBase + 5} stroke="var(--muted-foreground)" />)}
      {j.dates.map((d, i) => (
        <text key={d} x={xs[i]} y={292} textAnchor="middle" fontSize={10.5} fill="var(--foreground)">{d}</text>
      ))}
      {j.milestones.map((m, i) =>
        m.text ? (
          <text key={i} x={xs[i]} y={308}
            textAnchor={i === 0 ? "start" : i === j.milestones.length - 1 ? "end" : "middle"}
            fontSize={10} fill={m.good ? "#0F6E56" : "var(--muted-foreground)"}>{m.text}</text>
        ) : null)}
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function V2MigrationLegacy() {
  const reportRef = useRef<HTMLDivElement>(null);
  const [weekKey, setWeekKey] = useState(WEEKS[0].key);
  const week: V2Week = WEEKS.find((w) => w.key === weekKey) ?? WEEKS[0];

  return (
    <div className="space-y-4">
      {/* Controls (not captured) */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          {WEEKS.map((w) => (
            <button key={w.key} onClick={() => setWeekKey(w.key)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                w.key === weekKey
                  ? "border-transparent text-white"
                  : "border-[var(--glass-border)] text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]"
              }`}
              style={w.key === weekKey ? { background: "var(--brand-night)" } : undefined}>
              {w.dateLabel}
            </button>
          ))}
          <span className={`text-xs ${MUTED}`}>weekly snapshots · export as PNG for the All Hands deck</span>
        </div>
        <ExportButtons reportRef={reportRef} weekKey={week.key} />
      </div>

      {/* Captured report */}
      <div ref={reportRef} className="space-y-7">
        {/* Header */}
        <div className="rounded-2xl px-7 py-6" style={{ background: "var(--brand-night)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#A3A3A3" }}>Field Delivery · Company All Hands</div>
          <h1 className="text-2xl font-bold tracking-tight mt-1" style={{ color: "#FFFFFF" }}>Delivery and V2 migration</h1>
          <div className="text-sm mt-1.5" style={{ color: "#D4D4D4" }}>{week.dateLabel} · migration tracker, Monday, and Linear (live)</div>
          <p className="text-[13px] mt-3 leading-relaxed max-w-[820px]" style={{ color: "#E5E5E5" }}>{week.lede}</p>
        </div>

        {/* Delivery snapshot */}
        <section>
          <SectionLabel>Delivery snapshot</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-2">
            {week.snapshot.map((m) => (
              <div key={m.label} className={m.hero ? "rounded-xl p-4" : "glass-card rounded-xl p-4"}
                style={m.hero ? { background: "var(--brand-night)" } : undefined}>
                <div className="text-3xl font-bold leading-none" style={{ color: m.hero ? "var(--brand-yellow)" : "var(--foreground)" }}>{m.value}</div>
                <div className="text-xs font-semibold mt-2" style={{ color: m.hero ? "#D4D4D4" : "var(--foreground)" }}>{m.label}</div>
                <div className="text-[11px] mt-0.5" style={{ color: m.hero ? "#A3A3A3" : "var(--muted-foreground)" }}>{m.sub}</div>
              </div>
            ))}
          </div>
          <p className={`text-[11px] ${MUTED} mt-2 leading-relaxed`}>{week.snapshotNote}</p>
        </section>

        {/* Net-new development */}
        <section>
          <SectionLabel>Net-new V2 development</SectionLabel>
          <DeltaLine>{week.netNewDelta}</DeltaLine>
          <div className="glass-card rounded-2xl p-5">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] border-b border-[var(--brand-metal-line)]">
                <th className="py-2 pr-3 font-semibold">Process</th><th className="py-2 pr-3 font-semibold">Owner</th><th className="py-2 pr-3 font-semibold">Phase</th><th className="py-2 font-semibold">Latest update (from Monday)</th>
              </tr></thead>
              <tbody>
                {week.netNew.map((r) => (
                  <tr key={r.process} className="border-b border-[var(--brand-metal-line)] last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[color:var(--foreground)] whitespace-nowrap">{r.process}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.owner}</td>
                    <td className={`py-2 pr-3 ${MUTED} whitespace-nowrap`}>{r.phase}</td>
                    <td className="py-2 text-[color:var(--foreground)]" style={r.tone === "off" ? { color: "#B91C1C" } : r.tone === "new" ? { color: "#0F6E56" } : undefined}>{r.update}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Renewals */}
        <section>
          <SectionLabel>Renewals this quarter</SectionLabel>
          <DeltaLine>{week.renewalsDelta}</DeltaLine>
          {week.renewalBanner && (
            <div className="glass-card rounded-2xl p-5 mb-3" style={{ borderColor: "#5BC4A0" }}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[15px] font-bold" style={{ color: "#0F6E56" }}>{week.renewalBanner.title}</div>
                  <div className={`text-[11.5px] ${MUTED} mt-0.5`}>{week.renewalBanner.sub}</div>
                </div>
                <div className="flex gap-6">
                  {week.renewalBanner.stats.map((s) => (
                    <div key={s.label} className="text-center">
                      <div className="text-lg font-bold leading-none" style={{ color: "#0F6E56" }}>{s.value}</div>
                      <div className={`text-[10.5px] ${MUTED} mt-1`}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="glass-card rounded-2xl p-5">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)] border-b border-[var(--brand-metal-line)]">
                <th className="py-2 pr-3 font-semibold">Account</th><th className="py-2 pr-3 font-semibold">Renewal</th><th className="py-2 pr-3 font-semibold">Health</th><th className="py-2 font-semibold">Migration readiness</th>
              </tr></thead>
              <tbody>
                {week.renewals.map((r) => (
                  <tr key={r.account} className="border-b border-[var(--brand-metal-line)] last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[color:var(--foreground)] whitespace-nowrap">{r.account}</td>
                    <td className="py-2 pr-3 whitespace-nowrap font-medium"
                      style={{ color: r.renewalTone === "good" ? "#0F6E56" : r.renewalTone === "risk" ? "#A32D2D" : "var(--muted-foreground)" }}>{r.renewal}</td>
                    <td className="py-2 pr-3"><Pill tone={r.healthTone}>{r.health}</Pill></td>
                    <td className="py-2 text-[color:var(--foreground)]">{r.readiness}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`text-[11px] ${MUTED} mt-3 leading-relaxed border-t border-[var(--brand-metal-line)] pt-3`}>{week.renewalsFootnote}</p>
          </div>
        </section>

        {/* ── V2 migration block ── */}
        <section className="border-t-2 border-[var(--brand-metal-line)] pt-5">
          <h2 className="text-lg font-bold text-[color:var(--foreground)]">V2 migration</h2>
          <p className={`text-[12px] ${MUTED} mt-1 mb-5 leading-relaxed`}>{week.migrationIntro}</p>

          {/* Journey */}
          <SectionLabel>The journey so far</SectionLabel>
          <div className="glass-card rounded-2xl p-5 mb-6 mt-2">
            <div className="max-w-[780px] mx-auto">
              <JourneyChart j={week.journey} />
            </div>
          </div>

          {/* Board */}
          <SectionLabel>Where all {week.board.reduce((s, r) => s + r.count, 0)} stand · ▲ moved this week</SectionLabel>
          <DeltaLine>{week.boardDelta}</DeltaLine>
          <div className="glass-card rounded-2xl p-5 mb-6">
            {week.board.map((row, i) => (
              <div key={row.stage} className={`flex gap-3 py-2.5 items-start ${i < week.board.length - 1 ? "border-b border-[var(--brand-metal-line)]" : ""}`}>
                <span className="flex-none w-[130px] text-[12px] font-semibold pt-0.5" style={{ color: row.color === "#5BC4A0" ? "#1D9E75" : row.color === "#EF9F27" ? "#BA7517" : row.color === "#E24B4A" ? "#A32D2D" : row.color === "#378ADD" ? "#185FA5" : row.color === "#1D9E75" ? "#0F6E56" : row.color }}>
                  {row.stage} · {row.count}
                </span>
                {row.chips && row.chips.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {row.chips.map((c) => <Chip key={c.name} chip={c} stageColor={row.color} />)}
                  </span>
                ) : (
                  <span className={`text-[11.5px] ${MUTED} pt-0.5 leading-relaxed`}>{row.summary}</span>
                )}
              </div>
            ))}
            <p className={`text-[11px] ${MUTED} mt-3 leading-relaxed`}>{week.boardFootnote}</p>
          </div>

          {/* Push lanes */}
          {week.push.length > 0 && (
            <>
              <SectionLabel>{week.pushTitle}</SectionLabel>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mb-3 mt-2">
                {week.push.map((p) => (
                  <div key={p.title} className="glass-card rounded-2xl p-4">
                    <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: p.color }}>{p.title}</div>
                    <div className="text-[11.5px] text-[color:var(--foreground)] leading-relaxed">{p.body}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {week.platformIssues.length > 0 && (
            <div className="glass-card rounded-2xl p-4 mb-6" style={{ borderColor: "rgba(226,75,74,0.35)" }}>
              <div className="text-[12px] font-semibold mb-2" style={{ color: "#A32D2D" }}>{week.platformIssuesTitle}</div>
              <div className="space-y-1.5">
                {week.platformIssues.map((p) => (
                  <div key={p.id} className="flex items-baseline gap-2 text-[12px] text-[color:var(--foreground)]">
                    <Tik id={p.id} />
                    <span className="leading-snug">{p.title}{p.note ? <span className={`${MUTED}`}> — {p.note}</span> : null}</span>
                    <span className="ml-auto flex-none"><Pill tone={p.sevTone}>{p.sev} · {p.state}</Pill></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open tickets */}
          <SectionLabel>Open engineering tickets</SectionLabel>
          <DeltaLine>
            {week.ticketsDelta}{" "}
            <a href={LINEAR_BLOCKER_LABEL} target="_blank" rel="noreferrer" className="text-blue-700 dark:text-blue-400 border-b border-dotted border-blue-300 hover:border-solid">Linear label: v2 Migration Blockers</a>
          </DeltaLine>
          <div className="glass-card rounded-2xl p-5 mb-6">
            {week.ticketGroups.map((g) => (
              <div key={g.theme}>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-[color:var(--muted-foreground)] mt-3 mb-1 first:mt-0">{g.theme}</div>
                {g.rows.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-[var(--brand-metal-line)] last:border-b-0 text-[12.5px] text-[color:var(--foreground)]">
                    <span className="leading-snug"><Tik id={t.id} /> {t.title}</span>
                    <Pill tone={t.tone}>{t.state}</Pill>
                  </div>
                ))}
              </div>
            ))}
            <p className={`text-[11px] ${MUTED} mt-3 leading-relaxed border-t border-[var(--brand-metal-line)] pt-3`}>{week.ticketsFootnote}</p>
          </div>

          {/* Decisions */}
          <SectionLabel>Decisions needed</SectionLabel>
          <div className="grid gap-3 lg:grid-cols-3 mt-2">
            {week.decisions.map((d) => (
              <div key={d.title} className="glass-card rounded-2xl p-4">
                <h3 className="text-[13px] font-semibold text-[color:var(--foreground)] mb-1.5">{d.title}</h3>
                <p className="text-[11.5px] text-[color:var(--foreground)] leading-relaxed mb-2.5">{d.body}</p>
                <div className="text-[11.5px] text-[color:var(--foreground)] bg-[var(--brand-seasalt)] border-l-[3px] border-l-[var(--brand-yellow)] rounded-r-lg px-3 py-2 leading-snug">
                  <span className="font-semibold">{d.verb ?? "Decide"}:</span> {d.decide}
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className={`text-[11px] ${MUTED} leading-relaxed border-t border-[var(--brand-metal-line)] pt-3.5`}>{week.sources}</p>
      </div>
    </div>
  );
}
