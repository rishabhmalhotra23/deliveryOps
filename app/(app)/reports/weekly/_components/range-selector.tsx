"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RangePreset } from "@/lib/reports/weekly-loader";

const PRESETS: Array<{ id: RangePreset; label: string; sub: string }> = [
  { id: "week",    label: "Week",    sub: "last 7 days" },
  { id: "month",   label: "Month",   sub: "last 30 days" },
  { id: "quarter", label: "Quarter", sub: "last 90 days" },
  { id: "custom",  label: "Custom",  sub: "pick dates" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function RangeSelector({ activePreset, from, to }: {
  activePreset: RangePreset;
  from: string | null;
  to: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(activePreset === "custom");
  const [fromDraft, setFromDraft] = useState(from ?? daysAgoIso(7));
  const [toDraft, setToDraft]     = useState(to ?? todayIso());

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
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

  function applyCustom() {
    if (!fromDraft || !toDraft) return;
    pushParams({ preset: "custom", from: fromDraft, to: toDraft });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Preset chips */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] w-fit">
        {PRESETS.map((p) => {
          const active = activePreset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              disabled={isPending}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                active
                  ? "bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] shadow-sm"
                  : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]"
              } disabled:opacity-50`}
              title={p.sub}
            >
              {p.label}
            </button>
          );
        })}
        {isPending && (
          <span className="text-[10px] text-[color:var(--muted-foreground)] ml-2 animate-pulse">
            loading…
          </span>
        )}
      </div>

      {/* Custom date pickers — only when custom is active */}
      {pickerOpen && activePreset === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            max={toDraft || undefined}
            className="rounded-lg border border-[var(--glass-border)] bg-[color:var(--background)] px-2.5 py-1.5 text-xs text-[color:var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]/40"
          />
          <span className="text-xs text-[color:var(--muted-foreground)]">to</span>
          <input
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            min={fromDraft || undefined}
            max={todayIso()}
            className="rounded-lg border border-[var(--glass-border)] bg-[color:var(--background)] px-2.5 py-1.5 text-xs text-[color:var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]/40"
          />
          <button
            onClick={applyCustom}
            disabled={isPending || !fromDraft || !toDraft}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] hover:opacity-90 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
