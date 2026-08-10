"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AllHandsReport } from "@/lib/reports/allhands-loader";
import type { RangePreset } from "@/lib/reports/date-range";
import { DOMAIN_LABELS, type TicketDomain } from "@/lib/tickets/types";

function domainLabel(domain: TicketDomain | "unclassified"): string {
  return domain === "unclassified" ? "Unclassified" : DOMAIN_LABELS[domain];
}

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
  migrated_pending_commercial: "var(--rt-status-good)",
  customer_validation: "var(--rt-accent)",
  parity_testing: "var(--rt-status-warn)",
  engg_pending: "var(--rt-status-bad)",
  in_development: "var(--rt-fg-muted)",
};

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function fmtAxis(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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

// ── Stage column (grouped, deduped process names — every name shown in full,
//    no "+N more" truncation) ────────────────────────────────────────────────
function summarizeNames(names: string[]): string[] {
  if (names.length === 0) return [];
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .sort((a, b) => a.localeCompare(b));
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

// ── Cumulative progress chart — SVG area/line with gridlines, weekly point
//    markers, and a labeled y-axis so the scale and weekly movement are both
//    readable, not just the overall shape. ────────────────────────────────────
function CumulativeChart({ points }: { points: AllHandsReport["cumulativeProgress"] }) {
  if (points.length === 0) {
    return (
      <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
        Not enough milestone data yet to chart cumulative progress.
      </div>
    );
  }

  const W = 640;
  const H = 150;
  const padLeft = 28;
  const padRight = 8;
  const padTop = 16;
  const padBottom = 20;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const values = points.map((p) => p.cumulativeAtOrPastParity);
  const max = Math.max(...values, 1);
  // Round the axis ceiling up to a "nice" multiple of 5 so gridline labels
  // aren't jagged (e.g. 46 -> axis tops out at 50, not 46).
  const axisMax = Math.max(5, Math.ceil(max / 5) * 5);

  const xAt = (i: number) => padLeft + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
  const yAt = (v: number) => padTop + chartH - (v / axisMax) * chartH;

  const coords = values.map((v, i) => [xAt(i), yAt(v)]);
  const lineD = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const baseline = padTop + chartH;
  const areaD = `${lineD} L${xAt(values.length - 1).toFixed(1)},${baseline} L${xAt(0).toFixed(1)},${baseline} Z`;

  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const latest = values[values.length - 1];
  const delta = latest - values[0];

  // Thin out x-axis date labels so they don't overlap when there are many weeks.
  const maxLabels = 7;
  const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
          Weekly, since {fmtShort(new Date(points[0].weekStart))}
        </span>
        {delta > 0 && (
          <span className="text-[10px] font-bold" style={{ color: "var(--rt-status-good)" }}>
            +{delta} this window
          </span>
        )}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="cumulative-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--rt-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--rt-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridFractions.map((frac) => {
          const y = padTop + chartH - frac * chartH;
          return (
            <g key={frac}>
              <line x1={padLeft} x2={W - padRight} y1={y} y2={y} stroke="var(--rt-surface-2)" strokeWidth="1" />
              <text x={padLeft - 5} y={y} textAnchor="end" dominantBaseline="middle" fontSize="8" fill="var(--rt-fg-muted)">
                {Math.round(frac * axisMax)}
              </text>
            </g>
          );
        })}

        <path d={areaD} fill="url(#cumulative-gradient)" />
        <path d={lineD} fill="none" stroke="var(--rt-accent)" strokeWidth="2.5" />

        {coords.map(([x, y], i) => (
          <circle
            key={points[i].weekStart}
            cx={x}
            cy={y}
            r={i === coords.length - 1 ? 3.5 : 2.5}
            fill={i === coords.length - 1 ? "var(--rt-accent)" : "var(--rt-surface-1)"}
            stroke="var(--rt-accent)"
            strokeWidth="1.5"
          />
        ))}

        <text
          x={xAt(coords.length - 1)}
          y={Math.max(padTop - 2, yAt(latest) - 9)}
          textAnchor="end"
          fontSize="11"
          fontWeight="700"
          fill="var(--rt-fg)"
        >
          {latest}
        </text>

        {points.map((p, i) =>
          i % labelStep === 0 || i === points.length - 1 ? (
            <text key={p.weekStart} x={xAt(i)} y={H - 5} textAnchor="middle" fontSize="8" fill="var(--rt-fg-muted)">
              {fmtAxis(new Date(p.weekStart))}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

// ── Ticket-data error banner ─────────────────────────────────────────────────
// The Linear-backed sections (blockers, ticket health) read tables that may not
// exist in this Supabase project. loadTicketsBundle() returns empty arrays plus
// a data_error rather than throwing, so without this banner the report would
// present a failed read as "no blockers / 0 open / 0 hard blockers" — confident
// fabricated zeros. Same wording as the /reports/v2-migration/tickets page.
function TicketDataErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-[14px] px-3.5 py-3 mb-3 text-[11px] leading-relaxed"
      style={{
        border: "1px solid var(--rt-status-bad)",
        background: "rgba(248,113,113,0.08)",
        color: "var(--rt-status-bad)",
      }}
    >
      <span className="font-bold">Couldn&apos;t load ticket data:</span> {message}
      <div className="mt-1" style={{ color: "var(--rt-fg-muted)" }}>
        Blockers and ticket health below are unavailable for this run — they are not zero.
      </div>
    </div>
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

  const {
    status,
    cumulativeProgress,
    renewalSpotlight,
    atRiskMigrating,
    blockers,
    ticketDomainBuckets,
    customerTicketConcentration,
    ticketHealth,
    ticketDataError,
  } = report;

  // Numerator and denominator both come from the one V2-relevant population
  // the loader builds the chart from (see AllHandsReport.trackedMigrationTotal).
  // Never add the stage-board counts back in: live_on_v2 /
  // migrated_pending_commercial processes have already reached parity, so
  // adding them to the reached-parity total double-counts them.
  const reachedParityTotal = cumulativeProgress.length > 0 ? cumulativeProgress[cumulativeProgress.length - 1].cumulativeAtOrPastParity : 0;
  const trackedTotal = report.trackedMigrationTotal;

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
        {(() => {
          const completeRows = status.stageRows.filter((r) => r.group === "complete");
          const inProgressRows = status.stageRows.filter((r) => r.group === "in_progress");
          return (
            <>
              {completeRows.length > 0 && (
                <>
                  <div className="text-[9px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
                    Already migrated (not counted in the {status.migratingNowCount} below):
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {completeRows.map((row) => (
                      <StageColumn key={row.stage} stage={row.stage} label={row.label} count={row.count} processNames={row.processNames} />
                    ))}
                  </div>
                </>
              )}
              <div className="text-[9px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
                The {status.migratingNowCount} actively migrating, by stage:
              </div>
              {inProgressRows.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
                  Nothing actively migrating right now.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {inProgressRows.map((row) => (
                    <StageColumn key={row.stage} stage={row.stage} label={row.label} count={row.count} processNames={row.processNames} />
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Section 2: cumulative progress since program start */}
      <Caption>Migration progress — cumulative since the program started</Caption>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        <CumulativeChart points={cumulativeProgress} />
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

      {/* Sections 4 & 5 both read Linear-backed tables — surface a read failure
          once, above them, instead of rendering fabricated zeros. */}
      {ticketDataError && <TicketDataErrorBanner message={ticketDataError} />}

      {/* Section 4: blockers. Team-curated asks (if any are filed) show first;
          the domain/customer breakdowns below always show — they're a volume
          view, not conditional on whether anyone filed an ask this week. */}
      {!ticketDataError && blockers.length > 0 && (
        <>
          <Caption>This week&apos;s blockers</Caption>
          <div className="rounded-[14px] p-2.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
            {blockers.map((b, i) => (
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
            ))}
          </div>
        </>
      )}

      <Caption>Open tickets by category</Caption>
      <div className="rounded-[14px] p-2.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        {ticketDataError ? (
          <div className="text-xs italic px-1 py-1" style={{ color: "var(--rt-status-bad)" }}>
            Unavailable — ticket data could not be read (see above).
          </div>
        ) : ticketDomainBuckets.length === 0 ? (
          <div className="text-xs italic px-1 py-1" style={{ color: "var(--rt-fg-muted)" }}>
            No open tickets.
          </div>
        ) : (
          ticketDomainBuckets.map((bucket, i) => (
            <div
              key={bucket.domain}
              className="py-2 px-1"
              style={{ borderBottom: i < ticketDomainBuckets.length - 1 ? "1px solid var(--rt-surface-2)" : undefined }}
            >
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[11px] font-bold" style={{ color: "var(--rt-fg)" }}>
                  {domainLabel(bucket.domain)}
                </span>
                <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--rt-fg)" }}>
                  {bucket.total}
                  {bucket.hard_blocker > 0 && (
                    <span style={{ color: "var(--rt-status-bad)" }}> · {bucket.hard_blocker} hard</span>
                  )}
                </span>
              </div>
              {bucket.tickets.length > 0 && (
                <div className="text-[9px] mt-1" style={{ color: "var(--rt-fg-muted)" }}>
                  {bucket.tickets.slice(0, 3).map((t) => t.title).join(" · ")}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Caption>Open tickets by migration</Caption>
      <div className="rounded-[14px] p-2.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        {ticketDataError ? (
          <div className="text-xs italic px-1 py-1" style={{ color: "var(--rt-status-bad)" }}>
            Unavailable — ticket data could not be read (see above).
          </div>
        ) : customerTicketConcentration.length === 0 ? (
          <div className="text-xs italic px-1 py-1" style={{ color: "var(--rt-fg-muted)" }}>
            No open tickets linked to a specific migration.
          </div>
        ) : (
          customerTicketConcentration.map((c, i) => (
            <div
              key={c.customerName}
              className="py-2 px-1"
              style={{ borderBottom: i < customerTicketConcentration.length - 1 ? "1px solid var(--rt-surface-2)" : undefined }}
            >
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[11px] font-bold" style={{ color: "var(--rt-fg)" }}>
                  {c.customerName}
                </span>
                <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--rt-fg)" }}>
                  {c.openTicketCount}
                  {c.hardBlockerCount > 0 && (
                    <span style={{ color: "var(--rt-status-bad)" }}> · {c.hardBlockerCount} hard</span>
                  )}
                </span>
              </div>
              {c.sampleTitles.length > 0 && (
                <div className="text-[9px] mt-1" style={{ color: "var(--rt-fg-muted)" }}>
                  {c.sampleTitles.join(" · ")}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Section 5: ticket health. The closed/new tiles are a rolling 7-day
          delta from loadTicketsBundle(), independent of the selected preset —
          labelled "last 7 days" rather than "this period" so a Quarter view
          doesn't imply a quarter's worth of movement. */}
      <Caption>Ticket health — live Linear pull</Caption>
      {ticketDataError ? (
        <div
          className="rounded-xl p-2.5 text-xs italic"
          style={{ background: "var(--rt-surface-1)", color: "var(--rt-status-bad)" }}
        >
          Unavailable — ticket data could not be read (see above).
        </div>
      ) : (
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
              +{ticketHealth.closedLast7Days}
            </div>
            <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
              closed, last 7 days
            </div>
          </div>
          <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
            <div className="text-base font-extrabold" style={{ color: "var(--rt-fg)" }}>
              +{ticketHealth.newLast7Days}
            </div>
            <div className="text-[9px]" style={{ color: "var(--rt-fg-muted)" }}>
              new, last 7 days
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
