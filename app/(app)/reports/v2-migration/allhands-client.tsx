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
      className="text-[11px] uppercase tracking-[0.06em] mb-2"
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
      <div className="text-xl font-extrabold" style={{ color: color ?? "var(--rt-fg)" }}>
        {value}
      </div>
      <div className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
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
      <div className="text-[11px] font-bold mb-1.5" style={{ color: STAGE_COLORS[stage] ?? "var(--rt-fg)" }}>
        {label} · {count}
      </div>
      <div className="text-[10px] leading-relaxed" style={{ color: "var(--rt-fg-body)" }}>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

// ── Combined progress chart — ONE chart, ONE shared weekly x-axis, dual y-axes:
//    left = cumulative "migrated to V2" (matches the Migrated to V2 tile exactly,
//    dashed goal line + a value label on every point), right = ticket velocity
//    PER WEEK, not cumulative (created vs. resolved, so direction is visible —
//    two cumulative lines both only ever go up, which hides whether resolution
//    is keeping pace). ──────────────────────────────────────────────────────
function CombinedProgressChart({
  migrationPoints,
  ticketPoints,
  goal,
}: {
  migrationPoints: AllHandsReport["cumulativeProgress"];
  ticketPoints: AllHandsReport["ticketVelocity"];
  goal: number;
}) {
  if (migrationPoints.length === 0 && ticketPoints.length === 0) {
    return (
      <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
        Not enough data yet to chart progress.
      </div>
    );
  }

  const W = 640;
  const H = 190;
  const padLeft = 28;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 20;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;
  const n = Math.max(migrationPoints.length, ticketPoints.length);
  const labelPoints = migrationPoints.length >= ticketPoints.length ? migrationPoints : ticketPoints;

  const migratedValues = migrationPoints.map((p) => p.cumulativeMigratedToV2);
  const latestMigrated = migratedValues[migratedValues.length - 1] ?? 0;
  // The left axis always shows the goal line, with a little headroom above it —
  // the migration line's peak can never exceed goal (same population, see
  // AllHandsStatus.migrationGoalTotal), so goal is always the true ceiling.
  const axisMaxLeft = Math.max(5, Math.ceil((goal * 1.08) / 5) * 5);

  const createdWeekly = ticketPoints.map((p) => p.createdThisWeek);
  const closedWeekly = ticketPoints.map((p) => p.closedThisWeek);
  const maxWeekly = Math.max(...createdWeekly, ...closedWeekly, 1);
  const axisMaxRight = Math.max(5, Math.ceil((maxWeekly * 1.15) / 5) * 5);

  const totalCreated = ticketPoints[ticketPoints.length - 1]?.cumulativeCreated ?? 0;
  const totalClosed = ticketPoints[ticketPoints.length - 1]?.cumulativeClosed ?? 0;
  const totalOpen = totalCreated - totalClosed;

  const xAt = (i: number) => padLeft + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yAtLeft = (v: number) => padTop + chartH - (v / axisMaxLeft) * chartH;
  const yAtRight = (v: number) => padTop + chartH - (v / axisMaxRight) * chartH;

  const migratedCoords = migratedValues.map((v, i) => [xAt(i), yAtLeft(v)]);
  const migratedLineD = migratedCoords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const baseline = padTop + chartH;
  const migratedAreaD =
    migratedCoords.length > 0
      ? `${migratedLineD} L${xAt(migratedValues.length - 1).toFixed(1)},${baseline} L${xAt(0).toFixed(1)},${baseline} Z`
      : "";

  const pathForRight = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAtRight(v).toFixed(1)}`).join(" ");
  const createdD = pathForRight(createdWeekly);
  const closedD = pathForRight(closedWeekly);

  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const goalY = yAtLeft(goal);
  const toGo = Math.max(0, goal - latestMigrated);

  // Thin out x-axis date labels so they don't overlap when there are many weeks.
  const maxLabels = 7;
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5 flex-wrap gap-1">
        <span className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
          Weekly, since {fmtShort(new Date(labelPoints[0].weekStart))}
        </span>
        <span className="text-[11px]" style={{ color: "var(--rt-fg-muted)" }}>
          <span className="font-bold" style={{ color: toGo === 0 ? "var(--rt-status-good)" : "var(--rt-fg)" }}>
            {toGo === 0 ? "Goal reached" : `${toGo} to go`}
          </span>
          {" · "}
          <span style={{ color: "var(--rt-fg)", fontWeight: 700 }}>{totalCreated}</span> created ·{" "}
          <span style={{ color: "var(--rt-status-good)", fontWeight: 700 }}>{totalClosed}</span> resolved ·{" "}
          <span style={{ color: "var(--rt-status-warn)", fontWeight: 700 }}>{totalOpen}</span> open
        </span>
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
              <text x={padLeft - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="var(--rt-fg-muted)">
                {Math.round(frac * axisMaxLeft)}
              </text>
              <text x={W - padRight + 8} y={y} textAnchor="start" dominantBaseline="middle" fontSize="9" fill="var(--rt-fg-muted)">
                {Math.round(frac * axisMaxRight)}
              </text>
            </g>
          );
        })}

        {migratedCoords.length > 0 && (
          <>
            <line x1={padLeft} x2={W - padRight} y1={goalY} y2={goalY} stroke="var(--rt-status-good)" strokeWidth="1.5" strokeDasharray="4 3" />
            <path d={migratedAreaD} fill="url(#cumulative-gradient)" />
            <path d={migratedLineD} fill="none" stroke="var(--rt-accent)" strokeWidth="2.5" />
            {migratedCoords.map(([x, y], i) => (
              <g key={migrationPoints[i].weekStart}>
                <circle
                  cx={x}
                  cy={y}
                  r={i === migratedCoords.length - 1 ? 3.5 : 2.5}
                  fill={i === migratedCoords.length - 1 ? "var(--rt-accent)" : "var(--rt-surface-1)"}
                  stroke="var(--rt-accent)"
                  strokeWidth="1.5"
                />
                <text
                  x={x}
                  y={Math.max(padTop - 4, y - 8)}
                  textAnchor={i === migratedCoords.length - 1 ? "end" : "middle"}
                  fontSize="10"
                  fontWeight={i === migratedCoords.length - 1 ? "700" : "600"}
                  fill={i === migratedCoords.length - 1 ? "var(--rt-fg)" : "var(--rt-fg-body)"}
                >
                  {migratedValues[i]}
                </text>
              </g>
            ))}
          </>
        )}

        {createdWeekly.length > 0 && (
          <>
            <path d={createdD} fill="none" stroke="var(--rt-fg-muted)" strokeWidth="1.75" />
            <path d={closedD} fill="none" stroke="var(--rt-status-good)" strokeWidth="1.75" strokeDasharray="0" />
            {createdWeekly.map((v, i) => (
              <circle key={`c-${ticketPoints[i].weekStart}`} cx={xAt(i)} cy={yAtRight(v)} r="2" fill="var(--rt-surface-1)" stroke="var(--rt-fg-muted)" strokeWidth="1.5" />
            ))}
            {closedWeekly.map((v, i) => (
              <circle key={`d-${ticketPoints[i].weekStart}`} cx={xAt(i)} cy={yAtRight(v)} r="2" fill="var(--rt-surface-1)" stroke="var(--rt-status-good)" strokeWidth="1.5" />
            ))}
          </>
        )}

        {labelPoints.map((p, i) =>
          i % labelStep === 0 || i === labelPoints.length - 1 ? (
            <text key={p.weekStart} x={xAt(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--rt-fg-muted)">
              {fmtAxis(new Date(p.weekStart))}
            </text>
          ) : null
        )}
      </svg>
      <div className="flex gap-3 mt-1 flex-wrap">
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--rt-accent)" }} /> migrated to V2 (cumulative, left axis)
        </span>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--rt-fg-muted)" }} /> tickets created (per week, right axis)
        </span>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--rt-status-good)" }} /> tickets resolved (per week, right axis)
        </span>
      </div>
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
      className="rounded-[14px] px-3.5 py-3 mb-3 text-[12px] leading-relaxed"
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
        className="flex rounded-[10px] p-[3px] text-[11px]"
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
            className="rounded-lg px-2 py-1 text-[11px]"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)", border: "1px solid var(--rt-surface-2)" }}
          />
          <span className="text-[11px]" style={{ color: "var(--rt-fg-muted)" }}>
            to
          </span>
          <input
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            min={fromDraft || undefined}
            className="rounded-lg px-2 py-1 text-[11px]"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)", border: "1px solid var(--rt-surface-2)" }}
          />
          <button
            onClick={() => pushParams({ preset: "custom", from: fromDraft, to: toDraft })}
            disabled={isPending || !fromDraft || !toDraft}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold disabled:opacity-50"
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
    ticketVelocity,
    renewalSpotlight,
    atRiskMigrating,
    blockers,
    ticketDomainBuckets,
    customerTicketConcentration,
    ticketHealth,
    ticketDataError,
  } = report;

  // The chart's own final value — always equals status.migrationDoneCount
  // exactly (same classification, see migratedToV2Date's doc comment in
  // migration-progress.ts), so this and the "Migrated to V2" tile never drift.
  const migratedToV2Total = cumulativeProgress.length > 0 ? cumulativeProgress[cumulativeProgress.length - 1].cumulativeMigratedToV2 : 0;

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
          <div className="text-[11px] uppercase tracking-[0.06em] mb-1" style={{ color: "var(--rt-fg-muted)" }}>
            All-Hands · Delivery &amp; Customer Success
          </div>
          <div className="text-2xl font-extrabold tracking-tight" style={{ color: "var(--rt-fg)" }}>
            {report.range.label}
          </div>
        </div>
        <div className="flex gap-1.5 items-center">
          <PresetPicker range={report.range} />
          <button
            onClick={downloadPng}
            disabled={exportState === "loading"}
            className="rounded-[10px] px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 transition-opacity"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)" }}
          >
            {exportLabel}
          </button>
        </div>
      </div>

      {/* Section 1a: general delivery portfolio — lifecycle-based, not migration-specific */}
      <Caption>Delivery portfolio</Caption>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        <div className="flex gap-4">
          <StatTile value={status.liveCount} label="Live in production" />
          <StatTile value={status.activeCount} label="Active work" />
          <StatTile value={status.queuedCount} label="Queued" />
        </div>
      </div>

      {/* Section 1b: V2 migration program — migration_stage-based, a fixed-size
          goal population (migrationDoneCount + migratingNowCount == migrationGoalTotal,
          always — see AllHandsStatus.migrationGoalTotal for why). */}
      <Caption>V2 migration program — goal: {status.migrationGoalTotal} total migrations</Caption>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        <div
          className="flex gap-4 mb-3.5 pb-3.5"
          style={{ borderBottom: "1px solid var(--rt-surface-2)" }}
        >
          <StatTile value={status.migrationGoalTotal} label="Total in scope" />
          <StatTile value={status.migrationDoneCount} label="Migrated to V2" color="var(--rt-status-good)" />
          <StatTile value={status.migratingNowCount} label="Actively migrating" color="var(--rt-accent)" />
          {status.migrationBlockedNowCount > 0 && (
            <StatTile value={status.migrationBlockedNowCount} label="Engineering blocked" color="var(--rt-status-bad)" />
          )}
        </div>
        {status.migrationBlockedProcesses.length > 0 && (
          <div className="mb-3.5 pb-3.5" style={{ borderBottom: "1px solid var(--rt-surface-2)" }}>
            <div className="text-[10px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
              Engineering-blocked (excludes customer-pending and commercial-discussion waits, already visible above):
            </div>
            {status.migrationBlockedProcesses.map((p) => (
              <div key={`${p.account}-${p.processName}`} className="text-[11px] mb-1" style={{ color: "var(--rt-fg-body)" }}>
                <span className="font-bold" style={{ color: "var(--rt-status-bad)" }}>
                  {p.processName}
                </span>
                {" — "}
                {p.reasons.join("; ")}
              </div>
            ))}
          </div>
        )}
        {(() => {
          const completeRows = status.stageRows.filter((r) => r.group === "complete");
          const inProgressRows = status.stageRows.filter((r) => r.group === "in_progress");
          return (
            <>
              {completeRows.length > 0 && (
                <>
                  <div className="text-[10px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
                    Already migrated (not counted in the {status.migratingNowCount} below):
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {completeRows.map((row) => (
                      <StageColumn key={row.stage} stage={row.stage} label={row.label} count={row.count} processNames={row.processNames} />
                    ))}
                  </div>
                </>
              )}
              <div className="text-[10px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
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

      {/* Section 2: migration + ticket progress, one combined chart, one shared
          weekly x-axis. Migration (left axis, cumulative) and ticket velocity
          (right axis, per-week) stay on separate axes deliberately — a
          cumulative count and a per-week delta plotted on one axis would make
          one of the two illegible. */}
      <Caption>Progress — migrated to V2 vs. ticket velocity</Caption>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        {ticketDataError && (
          <div className="text-xs italic px-1 py-1 mb-2" style={{ color: "var(--rt-status-bad)" }}>
            Ticket data unavailable for this run (see above) — showing migration progress only.
          </div>
        )}
        <CombinedProgressChart
          migrationPoints={cumulativeProgress}
          ticketPoints={ticketDataError ? [] : ticketVelocity}
          goal={status.migrationGoalTotal}
        />
        <div className="text-[11px] mt-2" style={{ color: "var(--rt-fg-body)" }}>
          {migratedToV2Total} of {status.migrationGoalTotal} migrated to V2 so far.
          {status.migrationBlockedNowCount > 0 && (
            <> {status.migrationBlockedNowCount} of the {status.migratingNowCount} still migrating are engineering-blocked.</>
          )}
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
              <div className="text-[14px] font-extrabold" style={{ color: "var(--rt-fg)" }}>
                {renewalSpotlight.customerName} renews in {renewalSpotlight.renewalInDays} days
              </div>
              {spotlightRenewalDate && (
                <span
                  className="text-[10px] font-bold rounded-full px-2 py-0.5"
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
              <div className="text-[11px]" style={{ color: "var(--rt-status-bad)" }}>
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
                <span className="text-[12px] font-medium" style={{ color: "var(--rt-fg)" }}>
                  {entry.customerName}
                </span>
                <span className="text-[11px]" style={{ color: "var(--rt-status-bad)" }}>
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
                  <span className="text-[12px] font-bold" style={{ color: "var(--rt-fg)" }}>
                    {b.title}
                  </span>
                  <span
                    className="text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0"
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
                        className="text-[11px] rounded-full px-2 py-0.5"
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

      {/* Compact chip rows, not a detailed breakdown — this is a company-wide
          quick overview, not a ticket triage view (Rishabh, 2026-08-10). No
          sample titles; that level of detail (plus manual Refresh) lives on
          /reports/v2-migration/tickets, linked below since this page has no
          other pointer to it (Rishabh, 2026-08-10). */}
      <div className="flex justify-between items-baseline mb-2">
        <div className="text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--rt-fg-muted)" }}>
          Hard blockers — {ticketHealth.hardBlockers} total
        </div>
        <a href="/reports/v2-migration/tickets" className="text-[10px] font-semibold" style={{ color: "var(--rt-accent)" }}>
          Manage tickets &amp; refresh from Linear →
        </a>
      </div>
      <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
        {ticketDataError ? (
          <div className="text-xs italic" style={{ color: "var(--rt-status-bad)" }}>
            Unavailable — ticket data could not be read (see above).
          </div>
        ) : (
          <>
            <div className="text-[10px] mb-1.5" style={{ color: "var(--rt-fg-muted)" }}>
              By category:
            </div>
            {ticketDomainBuckets.length === 0 ? (
              <div className="text-xs italic mb-3" style={{ color: "var(--rt-fg-muted)" }}>
                No open hard blockers.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ticketDomainBuckets.map((bucket) => (
                  <span
                    key={bucket.domain}
                    className="text-[11px] rounded-full px-2 py-1"
                    style={{ background: "var(--rt-surface-2)", color: "var(--rt-fg)" }}
                  >
                    {domainLabel(bucket.domain)} · <span style={{ color: "var(--rt-status-bad)", fontWeight: 700 }}>{bucket.count}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="text-[10px] mb-1.5" style={{ color: "var(--rt-fg-muted)" }}>
              By migration:
            </div>
            {customerTicketConcentration.length === 0 ? (
              <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
                No open hard blockers linked to a specific migration.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {customerTicketConcentration.map((c) => (
                  <span
                    key={c.customerName}
                    className="text-[11px] rounded-full px-2 py-1"
                    style={{ background: "var(--rt-surface-2)", color: "var(--rt-fg)" }}
                  >
                    {c.customerName} · <span style={{ color: "var(--rt-status-bad)", fontWeight: 700 }}>{c.ticketCount}</span>
                  </span>
                ))}
              </div>
            )}
            {/* Manually-maintained, deliberately not ticket-derived (Rishabh, 2026-08-10):
                IDP experience is a recurring gap across several customers' migrations, not
                fully captured as tracked tickets today. Revisit/remove once it is. */}
            <div className="text-[10px] italic mt-3" style={{ color: "var(--rt-fg-muted)" }}>
              Known gap beyond what&apos;s tracked above: IDP experience is a recurring need across multiple customers&apos;
              migrations.
            </div>
          </>
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
            <div className="text-lg font-extrabold" style={{ color: "var(--rt-fg)" }}>
              {ticketHealth.openInScope}
            </div>
            <div className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
              open, in scope
            </div>
          </div>
          <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
            <div className="text-lg font-extrabold" style={{ color: "var(--rt-status-bad)" }}>
              {ticketHealth.hardBlockers}
            </div>
            <div className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
              hard blockers
            </div>
          </div>
          <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
            <div className="text-lg font-extrabold" style={{ color: "var(--rt-status-good)" }}>
              +{ticketHealth.closedLast7Days}
            </div>
            <div className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
              closed, last 7 days
            </div>
          </div>
          <div className="flex-1 rounded-xl p-2.5" style={{ background: "var(--rt-surface-1)" }}>
            <div className="text-lg font-extrabold" style={{ color: "var(--rt-fg)" }}>
              +{ticketHealth.newLast7Days}
            </div>
            <div className="text-[10px]" style={{ color: "var(--rt-fg-muted)" }}>
              new, last 7 days
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
