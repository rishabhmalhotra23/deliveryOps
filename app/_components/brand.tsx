// Tiny shared brand-correct primitives. Server-component-safe (no hooks).

import type { ReactNode } from "react";

const TONE_BY_LIFECYCLE: Record<string, { class: string; label?: string }> = {
  "High Risk": { class: "tone-high-risk" },
  "Upcoming Renewal": { class: "tone-renewal" },
  "Growth / Focus": { class: "tone-growth" },
  "Tier 2 - Secondary Priority": { class: "tone-tier2", label: "Tier 2" },
  "Partner Managed": { class: "tone-partner" },
  POV: { class: "tone-pov" },
  "Churned/Dropped": { class: "tone-churned", label: "Churned" },
};

export const LIFECYCLE_ORDER = [
  "High Risk",
  "Upcoming Renewal",
  "Growth / Focus",
  "Tier 2 - Secondary Priority",
  "Partner Managed",
  "POV",
  "Churned/Dropped",
] as const;

export function LifecycleChip({
  group,
  size = "md",
}: {
  group: string | null;
  size?: "sm" | "md";
}) {
  if (!group) return null;
  const tone = TONE_BY_LIFECYCLE[group] ?? { class: "tone-other" };
  const label = tone.label ?? group;
  const sizeClass = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium uppercase tracking-wider ${sizeClass} ${tone.class}`}
    >
      {label}
    </span>
  );
}

export function SectionMark({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] mb-2 font-medium">
      <span className="sparkle">{children}</span>
    </div>
  );
}

export function StatBlock({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        emphasis
          ? "bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] border-[color:var(--brand-night)]"
          : "bg-white border-line"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.22em] font-medium ${
          emphasis ? "text-[color:var(--brand-yellow)]" : "text-[color:var(--brand-gray)]"
        }`}
      >
        {label}
      </div>
      <div className="mt-2 text-display text-3xl tracking-tight tabular-nums">{value}</div>
      {hint ? (
        <div
          className={`mt-1 text-xs ${
            emphasis ? "text-[color:var(--brand-metal)]" : "text-[color:var(--brand-gray)]"
          }`}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        {eyebrow ? <SectionMark>{eyebrow}</SectionMark> : null}
        <h1 className="text-display text-4xl md:text-5xl tracking-tight leading-[1.05]">{title}</h1>
        {subtitle ? (
          <p className="mt-3 text-[color:var(--brand-gray)] text-base max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

export function formatMoney(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null) return "—";
  if (opts.compact !== false) {
    if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  }
  return `$${n.toLocaleString()}`;
}

export function formatTimeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
