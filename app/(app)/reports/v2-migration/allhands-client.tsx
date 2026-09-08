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

// Fresh-V2-build lifecycle stages — a separate map from STAGE_COLORS (not
// just a different set of keys on the same one) because "in_development"
// means something different in each place: here it's a lifecycle stage that
// should read as active/in-progress (yellow), but STAGE_COLORS' in_development
// is a migration stage that's deliberately muted so it doesn't compete with
// customer_validation's accent yellow in the same funnel. Reusing one map for
// both would force them to the same color. Green is reserved for "live" states
// elsewhere in this report, so it's not reused here even though on_hold/uat
// could otherwise read as "good."
const FRESH_BUILD_STAGE_COLORS: Record<string, string> = {
  backlog: "var(--rt-status-warn)",
  upcoming: "var(--rt-violet)",
  discovery: "var(--rt-fg-muted)",
  in_development: "var(--rt-accent)",
  uat: "var(--rt-status-info)",
  on_hold: "var(--rt-status-bad)",
};

// ── Section caption ──────────────────────────────────────────────────────────
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[13px] uppercase tracking-[0.06em] mb-2"
      style={{ color: "var(--rt-fg-muted)" }}
    >
      {children}
    </div>
  );
}

// ── Stat tile (top row of the portfolio and migration-program cards) ────────
function StatTile({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div>
      <div className="text-2xl font-extrabold" style={{ color: color ?? "var(--rt-fg)" }}>
        {value}
      </div>
      <div className="text-[12px]" style={{ color: "var(--rt-fg-muted)" }}>
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

function StageColumn({
  stage,
  label,
  count,
  processNames,
  colorMap = STAGE_COLORS,
}: {
  stage: string;
  label: string;
  count: number;
  processNames: string[];
  colorMap?: Record<string, string>;
}) {
  const lines = summarizeNames(processNames);
  return (
    <div className="flex-1 min-w-[130px] rounded-[10px] p-2.5" style={{ background: "var(--rt-surface-2)" }}>
      <div className="text-[13px] font-bold mb-1.5" style={{ color: colorMap[stage] ?? "var(--rt-fg)" }}>
        {label} · {count}
      </div>
      <div className="text-[12px] leading-relaxed" style={{ color: "var(--rt-fg-body)" }}>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
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
        className="flex rounded-[10px] p-[3px] text-[13px]"
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
            className="rounded-lg px-2 py-1 text-[13px]"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)", border: "1px solid var(--rt-surface-2)" }}
          />
          <span className="text-[13px]" style={{ color: "var(--rt-fg-muted)" }}>
            to
          </span>
          <input
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            min={fromDraft || undefined}
            className="rounded-lg px-2 py-1 text-[13px]"
            style={{ background: "var(--rt-surface-1)", color: "var(--rt-fg)", border: "1px solid var(--rt-surface-2)" }}
          />
          <button
            onClick={() => pushParams({ preset: "custom", from: fromDraft, to: toDraft })}
            disabled={isPending || !fromDraft || !toDraft}
            className="px-2.5 py-1 rounded-lg text-[13px] font-semibold disabled:opacity-50"
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

  // Only `status` is rendered: the renewal-spotlight, at-risk, blocker and
  // ticket-health sections were removed 2026-09-08 (Rishabh) so All-Hands shows
  // just the current portfolio and the V2 migration programme. AllHandsReport
  // still carries those fields, so bringing a section back is a UI-only change.
  const { status } = report;

  const exportLabel =
    exportState === "loading" ? "Rendering…" : exportState === "done" ? "Saved ✓" : exportState === "error" ? "Failed" : "Download PNG";

  return (
    <div className="report-theme rounded-2xl p-6" ref={reportRef}>
      {/* Header */}
      <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
        <div>
          <div className="text-[13px] uppercase tracking-[0.06em] mb-1" style={{ color: "var(--rt-fg-muted)" }}>
            All-Hands · Delivery &amp; Customer Success
          </div>
          <div className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--rt-fg)" }}>
            {report.range.label}
          </div>
        </div>
        <div className="flex gap-1.5 items-center">
          <PresetPicker range={report.range} />
          <button
            onClick={downloadPng}
            disabled={exportState === "loading"}
            className="rounded-[10px] px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 transition-opacity"
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

      {/* Section 1a.5: fresh V2 builds — net-new work built directly on V2,
          never migrated from V1. Excluded from every migration-goal/stage
          number below by design (they're not migrations); this is the
          report's only visibility into that work. Mirrors /delivery's
          Active view filtered to v2-native, so it's exactly as refined as
          Delivery's data currently is — no separate classification here.
          Placed here (not inside the V2 migration section) since it isn't
          migration work at all — a fresh build has no V1 to migrate from. */}
      {status.freshV2Builds.count > 0 && (
        <>
          <Caption>Fresh V2 builds in progress (net-new, not migrations)</Caption>
          <div className="rounded-[14px] p-3.5 mb-5" style={{ background: "var(--rt-surface-1)" }}>
            <div className="text-[12px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
              {status.freshV2Builds.count} active, by stage:
            </div>
            <div className="flex flex-wrap gap-2">
              {status.freshV2Builds.rows.map((row) => (
                <StageColumn
                  key={row.lifecycle}
                  stage={row.lifecycle}
                  label={row.label}
                  count={row.count}
                  processNames={row.processNames}
                  colorMap={FRESH_BUILD_STAGE_COLORS}
                />
              ))}
            </div>
          </div>
        </>
      )}

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
            <div className="text-[12px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
              Engineering-blocked (excludes customer-pending and commercial-discussion waits, already visible above):
            </div>
            {status.migrationBlockedProcesses.map((p) => (
              <div key={`${p.account}-${p.processName}`} className="text-[13px] mb-1" style={{ color: "var(--rt-fg-body)" }}>
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
                  <div className="text-[12px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
                    Already migrated (not counted in the {status.migratingNowCount} below):
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {completeRows.map((row) => (
                      <StageColumn key={row.stage} stage={row.stage} label={row.label} count={row.count} processNames={row.processNames} />
                    ))}
                  </div>
                </>
              )}
              <div className="text-[12px] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
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
    </div>
  );
}
