// Tiny shared brand-correct primitives. Server-component-safe (no hooks).

import type { ReactNode } from "react";

// DeliveryOps category vocabulary — the operational truth. Source order +
// tones. Custom categories minted by the team via the operations chat fall
// through to a neutral tone.
export const CATEGORY_ORDER = [
  "At Risk",
  "Upcoming Renewals",
  "Strategic Growth",
  "Active",
  "Partner Managed",
  "POV",
  "To Drop",
  "Churned",
] as const;

const CATEGORY_TONE: Record<string, { class: string; label?: string; weight: number }> = {
  "At Risk": { class: "tone-high-risk", weight: 0 },
  "Upcoming Renewals": { class: "tone-renewal", weight: 1 },
  "Strategic Growth": { class: "tone-growth", weight: 2 },
  Active: { class: "tone-tier2", weight: 3 },
  "Partner Managed": { class: "tone-partner", weight: 4 },
  POV: { class: "tone-pov", weight: 5 },
  // "To Drop" — customers we've decided to drop at renewal. Distinct from
  // Churned (already gone) and At Risk (could still be saved). Visually
  // adjacent to Churned but with its own warmer-warning tone.
  "To Drop": { class: "tone-todrop", weight: 6 },
  Churned: { class: "tone-churned", weight: 7 },
};

// Legacy lifecycle group → category mapping for any customer that still
// hasn't been backfilled. Mirrors migration 0005 + the live Monday board.
const LIFECYCLE_TO_CATEGORY: Record<string, string> = {
  "High Risk": "At Risk", // historical Monday label, no longer in use
  "Upcoming Renewal": "Upcoming Renewals",
  "Growth / Focus": "Strategic Growth",
  "Tier 2 - Secondary Priority": "Active",
  "Partner Managed": "Partner Managed",
  POV: "POV",
  "To be Dropped": "To Drop",
  "Churned/Dropped": "Churned",
};

export function categoryFromCustomer(customer: {
  custom_category: string | null;
  lifecycle_group: string | null;
}): string {
  if (customer.custom_category?.trim()) return customer.custom_category.trim();
  if (customer.lifecycle_group && LIFECYCLE_TO_CATEGORY[customer.lifecycle_group]) {
    return LIFECYCLE_TO_CATEGORY[customer.lifecycle_group];
  }
  return "Active";
}

export function categorySortIndex(category: string): number {
  return CATEGORY_TONE[category]?.weight ?? 99;
}

export function CategoryChip({
  category,
  size = "md",
}: {
  category: string | null;
  size?: "sm" | "md";
}) {
  if (!category) return null;
  const tone = CATEGORY_TONE[category] ?? { class: "tone-other" };
  const label = tone.label ?? category;
  const sizeClass = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium uppercase tracking-wider ${sizeClass} ${tone.class}`}
    >
      {label}
    </span>
  );
}

// Back-compat: kept for the import page (which still shows the raw Monday
// lifecycle_group with the old-name palette). New pages use CategoryChip.
export const LIFECYCLE_ORDER = [
  "High Risk",
  "Upcoming Renewal",
  "Growth / Focus",
  "Tier 2 - Secondary Priority",
  "Partner Managed",
  "POV",
  "Churned/Dropped",
] as const;

export function LifecycleChip({ group, size = "md" }: { group: string | null; size?: "sm" | "md" }) {
  return <CategoryChip category={group ? LIFECYCLE_TO_CATEGORY[group] ?? group : null} size={size} />;
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
  // label / hint accept ReactNode so callers can embed tooltips, chips,
  // or other inline elements — not just plain strings.
  label: ReactNode;
  value: string;
  hint?: ReactNode;
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
