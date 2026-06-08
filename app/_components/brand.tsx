// Tiny shared brand-correct primitives. Server-component-safe (no hooks).

import type { ReactNode } from "react";

// DeliveryOps category vocabulary — the operational truth. Source order +
// tones. Custom categories minted by the team via the operations chat fall
// through to a neutral tone.
//
// Dynamic derivation:
//   - Renewal in next 90 days → "Upcoming Renewals" (beats almost everything)
//   - Annual revenue > $20M    → "Strategic Growth"
//   - POV / To Drop / Past / Partner Managed / At Risk are explicit Monday
//     states and survive over the dynamic rules
//   - Default                  → "Secondary Priority"
//
// Precedence is defined inside categoryFromCustomer() — read there for the
// full set of rules and rationale.
//
// "Past" is the auto-classification for customers whose Monday lifecycle is
// "Churned/Dropped" — that single Monday group conflates two distinct end-
// states (Churned = left after using us, Dropped = we disengaged pre-go-
// live). When the FDE knows which, they override via the inline edit on the
// customer page, choosing "Churned" or "Dropped" explicitly.
//
// "Active" is the legacy name for the default bucket — we still recognise
// it (existing custom_category="Active" rows render correctly) but newly
// derived categories use "Secondary Priority". Over time the legacy label
// will fade out of the data set.
export const CATEGORY_ORDER = [
  "At Risk",
  "Upcoming Renewals",
  "Strategic Growth",
  "Secondary Priority",
  "Active", // legacy alias for "Secondary Priority"
  "Partner Managed",
  "POV",
  "To Drop",
  "Past",
  "Churned",
  "Dropped",
] as const;

const CATEGORY_TONE: Record<string, { class: string; label?: string; weight: number }> = {
  "At Risk": { class: "tone-high-risk", weight: 0 },
  "Upcoming Renewals": { class: "tone-renewal", weight: 1 },
  "Strategic Growth": { class: "tone-growth", weight: 2 },
  "Secondary Priority": { class: "tone-tier2", weight: 3 },
  Active: { class: "tone-tier2", weight: 3 }, // same tone — legacy alias
  "Partner Managed": { class: "tone-partner", weight: 4 },
  POV: { class: "tone-pov", weight: 5 },
  // "To Drop" — customers we've decided to drop at renewal. Distinct from
  // Churned (already gone) and At Risk (could still be saved). Visually
  // adjacent to Churned but with its own warmer-warning tone.
  "To Drop": { class: "tone-todrop", weight: 6 },
  // "Past" — the safe default for customers Monday flagged as
  // "Churned/Dropped". The FDE disambiguates per-customer.
  Past: { class: "tone-churned", weight: 7 },
  Churned: { class: "tone-churned", weight: 8 },
  Dropped: { class: "tone-todrop", weight: 9 },
};

// Legacy lifecycle group → category mapping for any customer that still
// hasn't been backfilled. Mirrors migration 0005 + the live Monday board.
//
// "Churned/Dropped" is intentionally mapped to the neutral "Past" — Monday
// lumps the two states together and we don't want to make a false claim.
// FDEs disambiguate via the inline-edit category dropdown.
const LIFECYCLE_TO_CATEGORY: Record<string, string> = {
  "High Risk": "At Risk", // historical Monday label, no longer in use
  "Upcoming Renewal": "Upcoming Renewals",
  "Growth / Focus": "Strategic Growth",
  "Tier 2 - Secondary Priority": "Secondary Priority",
  "Partner Managed": "Partner Managed",
  POV: "POV",
  "To be Dropped": "To Drop",
  "Churned/Dropped": "Past",
};

// Lifecycle states that are "explicit business decisions" — these never get
// auto-flipped by the revenue / renewal rules.  At Risk is the FDE's
// judgment call and should survive; Partner Managed is a relationship
// structure independent of size; POV / To Drop / Past are end-state
// declarations.
const STABLE_LIFECYCLE_OUTPUTS = new Set([
  "POV",
  "To Drop",
  "Past",
  "Partner Managed",
  "At Risk",
]);

const RENEWAL_WINDOW_DAYS = 90;
const STRATEGIC_GROWTH_REVENUE_THRESHOLD = 20_000_000;

export interface CategorySignals {
  /** Renewal date as YYYY-MM-DD (from profiles.renewal_date). */
  renewal_date?: string | null;
  /** Customer's annual revenue in dollars (from sf_accounts.annual_revenue). */
  annual_revenue?: number | null;
}

function renewalWithinWindow(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const days = Math.floor((d.getTime() - Date.now()) / 86_400_000);
  return days >= 0 && days <= RENEWAL_WINDOW_DAYS;
}

/**
 * Resolve a customer to a category. Precedence:
 *
 *   1. `custom_category` (manual override) — wins absolutely.
 *   2. Renewal in next 90 days → "Upcoming Renewals". Even a strategic-
 *      growth customer becomes a renewal when the renewal is imminent —
 *      that's the operationally important signal.
 *   3. Explicit Monday end-states (POV / To Drop / Past / Partner
 *      Managed / At Risk) survive the dynamic rules.
 *   4. Revenue > $20M → "Strategic Growth". Otherwise:
 *   5. Lifecycle-mapped category (Growth / Focus → Strategic Growth, etc.)
 *   6. Default → "Secondary Priority".
 *
 * `signals` is optional — when omitted the function falls back to legacy
 * lifecycle-only behaviour. Callers that have profile + SF data should
 * always pass it so the renewal / revenue rules can fire.
 */
export function categoryFromCustomer(
  customer: {
    custom_category: string | null;
    lifecycle_group: string | null;
  },
  signals?: CategorySignals
): string {
  // (1) manual override
  if (customer.custom_category?.trim()) return customer.custom_category.trim();

  // (2) renewal in 90 days — actionable now, beats everything else
  if (signals && renewalWithinWindow(signals.renewal_date)) {
    return "Upcoming Renewals";
  }

  // (3) explicit Monday end-states survive
  const mapped = customer.lifecycle_group ? LIFECYCLE_TO_CATEGORY[customer.lifecycle_group] : null;
  if (mapped && STABLE_LIFECYCLE_OUTPUTS.has(mapped)) return mapped;

  // (4) revenue-based: large enterprises → Strategic Growth
  if (
    signals &&
    typeof signals.annual_revenue === "number" &&
    signals.annual_revenue > STRATEGIC_GROWTH_REVENUE_THRESHOLD
  ) {
    return "Strategic Growth";
  }

  // (5) fall back to the legacy lifecycle mapping
  if (mapped) return mapped;

  // (6) default
  return "Secondary Priority";
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
    <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] dark:text-[color:var(--muted-foreground)] mb-2 font-medium">
      <span className="sparkle">{children}</span>
    </div>
  );
}

export function StatBlock({
  label,
  value,
  hint,
  emphasis = false,
  onClick,
}: {
  label: ReactNode;
  value: string;
  hint?: ReactNode;
  emphasis?: boolean;
  /** When provided, the block renders as a button. Click → caller-decides
   *  what to do (typically opens a drill-down panel). Adds a hover lift. */
  onClick?: () => void;
}) {
  const baseClasses = `rounded-lg border p-5 text-left transition-all w-full ${
    emphasis
      ? "bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] border-[color:var(--brand-night)] dark:bg-white/8 dark:border-white/15"
      : "bg-white border-line dark:bg-white/6 dark:border-white/12"
  } ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-[color:var(--brand-night)] dark:hover:border-white/30" : ""}`;

  const labelClasses = `text-[10px] uppercase tracking-[0.22em] font-medium ${
    emphasis ? "text-[color:var(--brand-yellow)]" : "text-[color:var(--brand-gray)] dark:text-[color:var(--muted-foreground)]"
  }`;
  const hintClasses = `mt-1 text-xs ${
    emphasis ? "text-[color:var(--brand-metal)]" : "text-[color:var(--brand-gray)] dark:text-[color:var(--muted-foreground)]"
  }`;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className={labelClasses}>{label}</div>
        {onClick ? (
          <span
            aria-hidden="true"
            className={`text-[10px] tabular-nums ${
              emphasis ? "text-[color:var(--brand-metal)]" : "text-[color:var(--brand-gray)] dark:text-[color:var(--muted-foreground)]"
            }`}
          >
            ↗
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-display text-3xl tracking-tight tabular-nums">{value}</div>
      {hint ? <div className={hintClasses}>{hint}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClasses}>
        {inner}
      </button>
    );
  }
  return <div className={baseClasses}>{inner}</div>;
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
  return `$${n.toLocaleString("en-US")}`;
}

export function formatTimeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
