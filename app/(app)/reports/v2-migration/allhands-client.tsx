"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AllHandsReport } from "@/lib/reports/allhands-loader";
import type { RangePreset } from "@/lib/reports/date-range";

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "custom", label: "Custom" },
];

// Same Linear-issue link convention as the deleted lib/reports/v2-migrations.ts
// (inlined here since that file goes away in Task 9).
const LINEAR_ISSUE = (id: string) => `https://linear.app/kognitos/issue/${id}`;

// Stage colors reuse the four --rt-* accents already defined for this report
// theme (good/accent/warn/bad) rather than introducing a new hex value for
// "customer validation" the way the mockup's illustrative blue (#60A5FA) did.
const STAGE_COLORS: Record<string, string> = {
  live_on_v2: "var(--rt-status-good)",
  customer_validation: "var(--rt-accent)",
  parity_testing: "var(--rt-status-warn)",
  engg_pending: "var(--rt-status-bad)",
  in_development: "var(--rt-fg-muted)",
};

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

// ── Section caption ──────────────────────────────────────────────────────────
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] uppercase tracking-[0.06em] mb-2"
      style={{ color: "var(--rt-fg-muted)" }}
    >
      {children}
    </div>
  );
}

// ── Stat tile (top row of the merged status card, spotlight, ticket health) ──
function StatTile({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div>
      <div className="text-lg font-extrabold" style={{ color: color ?? "var(--rt-fg)" }}>
        {value}
      </div>
      <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
        {label}
      </div>
    </div>
  );
}

// ── Stage column (grouped, deduped process names — mirrors the mockup's
//    "Name ×N / +N more" truncation) ─────────────────────────────────────────
function summarizeNames(names: string[], maxLines = 2): string[] {
  if (names.length === 0) return [];
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const groups = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  if (groups.length <= maxLines) {
    return groups.map((g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name));
  }
  const shown = groups.slice(0, maxLines - 1);
  const shownCount = shown.reduce((s, g) => s + g.count, 0);
  const remaining = names.length - shownCount;
  return [...shown.map((g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name)), `+${remaining} more`];
}

function StageColumn({ stage, label, count, processNames }: { stage: string; label: string; count: number; processNames: string[] }) {
  const lines = summarizeNames(processNames);
  return (
    <div className="flex-1 min-w-[130px] rounded-[10px] p-2.5" style={{ background: "var(--rt-surface-2)" }}>
      <div className="text-[10px] font-bold mb-1.5" style={{ color: STAGE_COLORS[stage] ?? "var(--rt-fg)" }}>
        {label} · {count}
      </div>
      <div className="text-[9px] leading-relaxed" style={{ color: "var(--rt-fg-body)" }}>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

// ── Cumulative progress chart — SVG area/line, points scaled to data length ──
function CumulativeChart({ points }: { points: AllHandsReport["cumulativeProgress"] }) {
  if (points.length === 0) {
    return (
      <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
        Not enough milestone data yet to chart cumulative progress.
      </div>
    );
  }

  const W = 600;
  const H = 90;
  const padTop = 8;
  const padBottom = 10;
  const values = points.map((p) => p.cumulativeAtOrPastParity);
  const max = Math.max(...values, 1);

  const coords =
    values.length === 1
      ? [
          [0, H - padBottom - (values[0] / max) * (H - padTop - padBottom)],
          [W, H - padBottom - (values[0] / max) * (H - padTop - padBottom)],
        ]
      : values.map((v, i) => [
          (i / (values.length - 1)) * W,
          H - padBottom - (v / max) * (H - padTop - padBottom),
        ]);

  const lineD = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${lineD} L${W},${H} L0,${H} Z`;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="cumulative-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--rt-accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--rt-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#cumulative-gradient)" />
      <path d={lineD} fill="none" stroke="var(--rt-accent)" strokeWidth="2.5" />
    </svg>
  );
}

// ── Preset picker — client-side navigation via search params (same pattern
//    as weekly-report-client.tsx's RangeSelector) ─────────────────────────────
function PresetPicker({ range }: { range: AllHandsReport["range"] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(range.preset === "custom");
  const [fromDraft, setFromDraft] = useState(range.start.toISOString().slice(0, 10));
  const [toDraft, setToDraft] = useState(range.end.toISOString().slice(0, 10));

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  }

  function pickPreset(p: RangePreset) {
    if (p === "custom") {
      setPickerOpen(true);
      pushParams({ preset: "custom", from: fromDraft, to: toDraft });
      return;
    }
    setPickerOpen(false);
    pushParams({ preset: p, from: null, to: null });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div
        className="flex rounded-[10px] p-[3px] text-[10px]"
        style={{ background: "var(--rt-surface-1)" }}
      >
        {PRESETS.map((p) => {
          const active = range.preset === p.value;
          return (
            <button
              key={p.value}
              onClick={() => pickPreset(p.value)}
              disabled={isPending}
              className="px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={
                active
                  ? { background: "var(--rt-accent)", color: "var(--rt-bg)", fontWeight: 700 }
                  : { color: "var(--rt-fg-muted)" }
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {pickerOpen && range.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            max={toDraft || undefined}
            className="rounded-lg px-2 py-1 text-[10px]"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)", border: "1px solid var(--rt-surface-2)" }}
          />
          <span className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
            to
          </span>
          <input
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            min={fromDraft || undefined}
            className="rounded-lg px-2 py-1 text-[10px]"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)", border: "1px solid var(--rt-surface-2)" }}
          />
          <button
            onClick={() => pushParams({ preset: "custom", from: fromDraft, to: toDraft })}
            disabled={isPending || !fromDraft || !toDraft}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-50"
            style={{ background: "var(--rt-accent)", color: "var(--rt-bg)" }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function AllHandsClient({ report }: { report: AllHandsReport }) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exportState, setExportState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function downloadPng() {
    setExportState("loading");
    try {
      const el = reportRef.current;
      if (!el) throw new Error("No report element");
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#171717", style: { maxWidth: "none" } });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `allhands-${report.range.preset}-${report.range.label.replace(/\s+/g, "-")}.png`;
      a.click();
      setExportState("done");
    } catch (err) {
      console.error("[allhands-export]", err);
      setExportState("error");
    } finally {
      setTimeout(() => setExportState("idle"), 3000);
    }
  }

  const { status, cumulativeProgress, renewalSpotlight, atRiskMigrating, blockers, ticketHealth } = report;

  // Denominator for the cumulative-progress headline, per spec: in-flight
  // migrations (haven't reached parity yet) + the live-on-v2 stage-board
  // count + the all-time reached-parity total itself.
  const liveOnV2Count = status.stageRows.find((r) => r.stage === "live_on_v2")?.count ?? 0;
  const reachedParityTotal = cumulativeProgress.length > 0 ? cumulativeProgress[cumulativeProgress.length - 1].cumulativeAtOrPastParity : 0;
  const trackedTotal = status.migratingNowCount + liveOnV2Count + reachedParityTotal;

  const exportLabel =
    exportState === "loading" ? "Rendering…" : exportState === "done" ? "Saved ✓" : exportState === "error" ? "Failed" : "Download PNG";

  const spotlightAlsoAtRisk =
    renewalSpotlight != null && atRiskMigrating.some((a) => a.customerKey === renewalSpotlight.customerKey);
  const spotlightRenewalDate = renewalSpotlight
    ? new Date(new Date(report.generatedAt).getTime() + renewalSpotlight.renewalInDays * 86_400_000)
    : null;

  return (
    <div className="report-theme rounded-2xl p-6" ref={reportRef}>
      {/* Header */}
      <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.06em] mb-1" style={{ color: "var(--rt-fg-muted)" }}>
            All-Hands · Delivery &amp; Customer Success
          </div>
          <div className="text-xl font-extrabold tracking-tight" style={{ color: "var(--rt-fg)" }}>
            {report.range.label}
          </div>
        </div>
        <div className="flex gap-1.5 items-center">
          <PresetPicker range={report.range} />
          <button
            onClick={downloadPng}
            disabled={exportState === "loading"}
            className="rounded-[10px] px-3 py-1.5 text-[10px] font-semibold disabled:opacity-50 transition-opacity"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)" }}
          >
            {exportLabel}
          </button>
        </div>
      </div>

      {/* Section 1: merged portfolio & migration status */}
      <Caption>Portfolio &amp; migration status</Caption>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        <div
          className="flex gap-4 mb-3.5 pb-3.5"
          style={{ borderBottom: "1px solid var(--rt-surface-2)" }}
        >
          <StatTile value={status.liveCount} label="Live in production" />
          <StatTile value={status.activeCount} label="Active work" />
          <StatTile value={status.migratingNowCount} label="Migrating to V2 now" color="var(--rt-accent)" />
          <StatTile value={status.queuedCount} label="Queued" />
        </div>
        <div className="text-[9px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
          The {status.migratingNowCount} migrating now, by stage:
        </div>
        {status.stageRows.length === 0 ? (
          <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
            Nothing actively migrating right now.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {status.stageRows.map((row) => (
              <StageColumn key={row.stage} stage={row.stage} label={row.label} count={row.count} processNames={row.processNames} />
            ))}
          </div>
        )}
      </div>

      {/* Section 2: cumulative progress since program start */}
      <Caption>Migration progress — cumulative since the program started</Caption>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        <CumulativeChart points={cumulativeProgress} />
        {cumulativeProgress.length > 0 && (
          <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--rt-fg-muted)" }}>
            <span>{fmtShort(new Date(cumulativeProgress[0].weekStart))}</span>
            <span>today</span>
          </div>
        )}
        <div className="text-[10px] mt-2" style={{ color: "var(--rt-fg-body)" }}>
          {reachedParityTotal} of {trackedTotal} tracked migrations at or past parity since the program started. A running
          total, not a weekly count — a quiet week flattens the line, it never looks like a step backward.
        </div>
      </div>

      {/* Section 3: upcoming renewal spotlight — only when non-null */}
      {renewalSpotlight && (
        <>
          <Caption>Upcoming renewal spotlight</Caption>
          <div
            className="rounded-[14px] p-3.5 mb-5"
            style={{
              background: "linear-gradient(135deg, var(--rt-surface-1), var(--rt-surface-2))",
              border: "1px solid rgba(242,255,112,0.35)",
            }}
          >
            <div className="flex justify-between items-baseline mb-2 gap-2">
              <div className="text-[13px] font-extrabold" style={{ color: "var(--rt-fg)" }}>
                {renewalSpotlight.customerName} renews in {renewalSpotlight.renewalInDays} days
              </div>
              {spotlightRenewalDate && (
                <span
                  className="text-[9px] font-bold rounded-full px-2 py-0.5"
                  style={{ background: "var(--rt-accent)", color: "var(--rt-bg)" }}
                >
                  {fmtShort(spotlightRenewalDate)}
                </span>
              )}
            </div>
            <div className="flex gap-4 mb-2">
              <StatTile value={fmtMoney(renewalSpotlight.arr)} label="ARR" />
              <StatTile value={renewalSpotlight.liveProcessCount} label="Live processes" />
              <StatTile value={renewalSpotlight.migratingProcessCount} label="Migrating now" />
            </div>
            {spotlightAlsoAtRisk && (
              <div className="text-[10px]" style={{ color: "var(--rt-status-bad)" }}>
                Also flagged At Risk — see below.
              </div>
            )}
          </div>
        </>
      )}

      {/* Section 3b: at-risk-and-migrating cross-signal — only when non-empty */}
      {atRiskMigrating.length > 0 && (
        <>
          <Caption>At risk &amp; actively migrating</Caption>
          <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
            {atRiskMigrating.map((entry) => (
              <div
                key={entry.customerKey}
                className="flex justify-between items-center py-1.5"
                style={{ borderBottom: "1px solid var(--rt-surface-2)" }}
              >
                <span className="text-[11px] font-medium" style={{ color: "var(--rt-fg)" }}>
                  {entry.customerName}
                </span>
                <span className="text-[10px]" style={{ color: "var(--rt-status-bad)" }}>
                  {entry.migratingProcessCount} migrating
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Section 4: blockers */}
      <Caption>This week&apos;s blockers</Caption>
      <div className="rounded-[14px] p-2.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        {blockers.length === 0 ? (
          <div className="text-xs italic px-1 py-1" style={{ color: "var(--rt-fg-muted)" }}>
            No blockers reported this period.
          </div>
        ) : (
          blockers.map((b, i) => (
            <div
              key={i}
              className="py-2 px-1"
              style={{ borderBottom: i < blockers.length - 1 ? "1px solid var(--rt-surface-2)" : undefined }}
            >
              <div className="flex justify-between items-start gap-2">
                <span className="text-[11px] font-bold" style={{ color: "var(--rt-fg)" }}>
                  {b.title}
                </span>
                <span
                  className="text-[9px] font-bold rounded-full px-1.5 py-0.5 shrink-0"
                  style={{
                    background: b.priorityLabel === "NOW" ? "var(--rt-status-bad)" : "var(--rt-status-warn)",
                    color: "var(--rt-bg)",
                  }}
                >
                  {b.priorityLabel}
                </span>
              </div>
              {b.linkedTicketIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {b.linkedTicketIds.map((id) => (
                    <a
                      key={id}
                      href={LINEAR_ISSUE(id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] rounded-full px-2 py-0.5"
                      style={{ background: "var(--rt-surface-2)", color: "var(--rt-fg-muted)" }}
                    >
                      {id}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Section 5: ticket health */}
      <Caption>Ticket health — live Linear pull</Caption>
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
          <div className="text-base font-extrabold" style={{ color: "var(--rt-fg)" }}>
            {ticketHealth.openInScope}
          </div>
          <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
            open, in scope
          </div>
        </div>
        <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
          <div className="text-base font-extrabold" style={{ color: "var(--rt-status-bad)" }}>
            {ticketHealth.hardBlockers}
          </div>
          <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
            hard blockers
          </div>
        </div>
        <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
          <div className="text-base font-extrabold" style={{ color: "var(--rt-status-good)" }}>
            +{ticketHealth.closedThisPeriod}
          </div>
          <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
            closed this period
          </div>
        </div>
        <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
          <div className="text-base font-extrabold" style={{ color: "var(--rt-fg)" }}>
            +{ticketHealth.newThisPeriod}
          </div>
          <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
            new this period
          </div>
        </div>
      </div>
    </div>
  );
}
