"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DeliveryReviewLoaderResult } from "@/lib/reports/delivery-review-loader";
import type { DeliveryReviewProcessItem, DeliveryReviewCustomerGroup } from "@/lib/reports/delivery-review";
import type { RangePreset } from "@/lib/reports/date-range";

// Colors reuse the --rt-* tokens already defined for this report theme
// (app/globals.css) instead of the illustrative hex values in the mockups
// (e.g. the mockup's "Coming up" blue #60A5FA has no matching token) — same
// call the sibling All-Hands report made for its stage colors
// (app/(app)/reports/v2-migration/allhands-client.tsx: STAGE_COLORS).
const STATUS_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  done: { text: "Done", bg: "var(--rt-status-good)", fg: "var(--rt-bg)" },
  coming_up: { text: "Coming up", bg: "var(--rt-accent)", fg: "var(--rt-bg)" },
  blocked: { text: "Blocked", bg: "var(--rt-status-bad)", fg: "var(--rt-bg)" },
  live: { text: "Live", bg: "var(--rt-surface-2)", fg: "var(--rt-fg-muted)" },
};

// Same Linear-issue link convention as the All-Hands report
// (allhands-client.tsx's LINEAR_ISSUE).
const LINEAR_ISSUE = (id: string) => `https://linear.app/kognitos/issue/${id}`;

const PHASE_LABEL: Record<string, string> = {
  pre_kickoff: "Pre-Kickoff",
  m1_discovery: "M1 · Discovery",
  m2_development: "M2 · Development",
  m3_testing_uat: "M3 · Testing/UAT",
  m4_deployment: "M4 · Deployment",
  m5_exception_handling: "M5 · Exception Handling",
};

const PLATFORM_LABEL: Record<string, string> = {
  v1: "V1",
  v2: "V2",
  custom: "Custom",
};

// Only "Week" and "Custom" — this report is a working review, not the
// flexible historical report the All-Hands PresetPicker supports (no
// Month/Quarter here, per the plan's explicit constraint).
const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "week", label: "Week" },
  { value: "custom", label: "Custom" },
];

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

// ── Section caption (same convention as allhands-client.tsx's Caption) ──────
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.06em] mb-2" style={{ color: "var(--rt-fg-muted)" }}>
      {children}
    </div>
  );
}

// ── Small pill chip for phase / complexity / platform ────────────────────────
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[9px] rounded-full px-1.5 py-0.5"
      style={{ background: "var(--rt-surface-2)", color: "var(--rt-fg-body)" }}
    >
      {children}
    </span>
  );
}

// ── Week/Custom picker — same client-side search-param pattern as the
//    All-Hands report's PresetPicker, restricted to the two presets above ──
function PresetPicker({ range }: { range: DeliveryReviewLoaderResult["range"] }) {
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
      <div className="flex rounded-[10px] p-[3px] text-[10px]" style={{ background: "var(--rt-surface-1)" }}>
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

// ── One process row inside a customer's card ─────────────────────────────────
function ProcessRow({ item, isLast }: { item: DeliveryReviewProcessItem; isLast: boolean }) {
  const label = STATUS_LABEL[item.status];
  // `daysSinceUpdate` derives from `processes.updated_at`, which a blanket DB
  // trigger resets on ANY column write (imports, backfills, sweeps) — it is
  // not an activity/staleness signal, so the label must say what the field
  // actually measures ("updated Nd ago"), not claim the process has been
  // "blocked" for that long.
  const blockedMetaParts = [
    item.blockedReasonLabel,
    `updated ${item.daysSinceUpdate}d ago`,
    item.blockedNote,
  ].filter((part): part is string => Boolean(part));

  return (
    <div
      className="flex justify-between items-start gap-3 py-2.5"
      style={{ borderBottom: isLast ? undefined : "1px solid var(--rt-surface-2)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold" style={{ color: "var(--rt-fg)" }}>
          {item.name}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {item.phase && <Chip>{PHASE_LABEL[item.phase] ?? item.phase}</Chip>}
          {item.complexity && <Chip>{item.complexity} complexity</Chip>}
          <Chip>{PLATFORM_LABEL[item.platform] ?? item.platform}</Chip>
        </div>
        {item.status === "blocked" && (
          <>
            {blockedMetaParts.length > 0 && (
              <div className="text-[9px] mt-1.5" style={{ color: "var(--rt-fg-muted)" }}>
                {blockedMetaParts.join(" — ")}
              </div>
            )}
            {item.linkedTicketIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {item.linkedTicketIds.map((id) => (
                  <a
                    key={id}
                    href={LINEAR_ISSUE(id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[9px] rounded-full px-2 py-0.5"
                    style={{ background: "var(--rt-surface-2)", color: "var(--rt-fg-muted)" }}
                  >
                    {id}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <span
        className="text-[9px] rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap"
        style={{ background: label.bg, color: label.fg, fontWeight: item.status === "live" ? 500 : 700 }}
      >
        {label.text}
      </span>
    </div>
  );
}

// ── One customer's card: context header + all their active/recent processes ─
function CustomerCard({ g }: { g: DeliveryReviewCustomerGroup }) {
  return (
    <div className="rounded-[14px] p-3.5 mb-3" style={{ background: "var(--rt-surface-1)" }}>
      <div
        className="flex justify-between items-baseline gap-3 mb-2.5 pb-2.5"
        style={{ borderBottom: "1px solid var(--rt-surface-2)" }}
      >
        <span className="text-sm font-extrabold" style={{ color: "var(--rt-fg)" }}>
          {g.customerName}
        </span>
        <div className="flex gap-3.5 text-[10px] shrink-0">
          {/* Omit the ARR chip entirely when there's no confirmed ARR source
              (no Closed-Won opp on file) rather than showing a fabricated
              "$0" — same "omit rather than fake a zero" pattern already used
              for the renewal badge below. */}
          {g.arr != null && (
            <span>
              <span style={{ color: "var(--rt-fg-muted)" }}>ARR</span>{" "}
              <strong style={{ color: "var(--rt-fg)" }}>{fmtMoney(g.arr)}</strong>
            </span>
          )}
          {g.renewalInDays != null && (
            <span>
              <span style={{ color: "var(--rt-fg-muted)" }}>Renews</span>{" "}
              <strong style={{ color: "var(--rt-status-warn)" }}>{g.renewalInDays} days</strong>
            </span>
          )}
        </div>
      </div>
      {g.processes.map((item, i) => (
        <ProcessRow key={item.id} item={item} isLast={i === g.processes.length - 1} />
      ))}
    </div>
  );
}

export function DeliveryReviewClient({ report }: { report: DeliveryReviewLoaderResult }) {
  return (
    <div className="report-theme rounded-2xl p-6">
      {/* Header: Week/Custom picker (same client-side pattern as the All-Hands
          report's date picker — reuse RangePreset, no "Month"/"Quarter" options
          here per the global constraint above). No export button — this report
          has no PNG export. */}
      <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.06em] mb-1" style={{ color: "var(--rt-fg-muted)" }}>
            Weekly Delivery Review · Delivery &amp; CS
          </div>
          <div className="text-xl font-extrabold tracking-tight" style={{ color: "var(--rt-fg)" }}>
            {report.range.label}
          </div>
        </div>
        <PresetPicker range={report.range} />
      </div>

      {/* One card per report.customerGroups entry, in the order the loader
          already sorted them (blocked-first, then renewal proximity, then
          alphabetical) — do not re-sort in the component. Customer header row:
          name, ARR, and renewalInDays badge (omit the ARR chip entirely when
          there's no confirmed ARR source, i.e. arr is null — no fabricated
          "$0"; same for the renewal badge when renewalInDays is null — no
          "no renewal" placeholder). Inside,
          one row per process in g.processes, showing STATUS_LABEL[item.status]
          as the trailing pill, phase/complexity/platform as leading chips, and
          — only when item.status === "blocked" — the blockedReasonLabel,
          daysSinceUpdate, blockedNote, and linkedTicketIds (as chips linking to
          https://linear.app/kognitos/issue/${id}) beneath the process name,
          matching the card-detail mockup. */}
      {report.customerGroups.length === 0 ? (
        <div className="text-xs italic mb-3" style={{ color: "var(--rt-fg-muted)" }}>
          No active or recently-touched work for any customer this period.
        </div>
      ) : (
        report.customerGroups.map((g) => <CustomerCard key={g.customerKey} g={g} />)
      )}

      <div className="text-[9px] mb-6" style={{ color: "var(--rt-fg-muted)" }}>
        Sort: accounts with a blocked item first, then by renewal proximity, then alphabetical. Customers with only
        archived work (cancelled/churned/retired) are omitted entirely; all other active and live work is shown,
        including long-running steady-state Live rows.
      </div>

      {/* Footer: report.longestUntouched as a compact list — "{processName} —
          {customerName} — {daysSinceUpdate} days, {lifecycle}". When empty,
          still render the section (with its caption) so the empty state
          reads as a real signal — "nothing crossed the 30-day threshold" —
          rather than a rendering gap that looks broken. */}
      <Caption>
        Longest untouched — an independent view, not additive with the groups above (a process can appear in both)
      </Caption>
      {report.longestUntouched.length > 0 ? (
        <div className="rounded-[14px] p-2.5" style={{ background: "var(--rt-surface-1)" }}>
          {report.longestUntouched.map((item, i) => (
            <div
              key={`${item.customerName}-${item.processName}-${i}`}
              className="text-[10px] py-1.5 px-1"
              style={{
                borderBottom: i < report.longestUntouched.length - 1 ? "1px solid var(--rt-surface-2)" : undefined,
                color: "var(--rt-fg-body)",
              }}
            >
              <span className="font-semibold" style={{ color: "var(--rt-fg)" }}>
                {item.processName}
              </span>{" "}
              — {item.customerName} — {item.daysSinceUpdate} days, {item.lifecycle}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs italic" style={{ color: "var(--rt-fg-muted)" }}>
          No processes untouched 30+ days.
        </div>
      )}
    </div>
  );
}
