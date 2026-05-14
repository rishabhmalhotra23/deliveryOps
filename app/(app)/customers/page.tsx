import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import { loadPortfolioSummary } from "@/lib/cache/integrations";
import {
  PageHeader,
  SectionMark,
  formatTimeAgo,
  CATEGORY_ORDER,
  categoryFromCustomer,
  categorySortIndex,
} from "@/app/_components/brand";
import type { Customer } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const CATEGORY_VARIANT: Record<string, string> = {
  "At Risk": "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  "To Drop": "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  "Upcoming Renewals": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  "Strategic Growth": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  Active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "Partner Managed": "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  POV: "bg-[var(--brand-yellow-soft)] text-[color:var(--brand-night)] border-[var(--brand-yellow-line)]",
  Churned: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

const CATEGORY_DOT: Record<string, string> = {
  "At Risk": "bg-red-500",
  "To Drop": "bg-red-500",
  "Upcoming Renewals": "bg-amber-500",
  "Strategic Growth": "bg-emerald-500",
  Active: "bg-emerald-500",
  "Partner Managed": "bg-purple-500",
  POV: "bg-[#F2FF70]",
  Churned: "bg-[color:var(--muted-foreground)]",
};

// Generate a deterministic gradient background from a customer name.
// Each customer gets a unique color pair — much more visual than all-yellow.
const AVATAR_GRADIENTS = [
  ["#818cf8", "#6366f1"], // indigo
  ["#34d399", "#059669"], // emerald
  ["#fb923c", "#ea580c"], // orange
  ["#f472b6", "#db2777"], // pink
  ["#38bdf8", "#0284c7"], // sky
  ["#a78bfa", "#7c3aed"], // violet
  ["#fbbf24", "#d97706"], // amber
  ["#6ee7b7", "#0d9488"], // teal
  ["#f87171", "#dc2626"], // red
  ["#c084fc", "#9333ea"], // purple
];

function avatarGradient(name: string): string {
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % AVATAR_GRADIENTS.length;
  const [from, to] = AVATAR_GRADIENTS[idx];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function InitialsAvatar({ name, category }: { name: string; category: string }) {
  const dot = CATEGORY_DOT[category] ?? "bg-[color:var(--muted-foreground)]";
  const isPast = category === "Churned" || category === "To Drop";
  return (
    <div className="relative shrink-0">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white"
        style={{ background: isPast ? "#6b7280" : avatarGradient(name), opacity: isPast ? 0.7 : 1 }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
      {!isPast && (
        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[color:var(--background)] ${dot}`} />
      )}
    </div>
  );
}

function CustomerStrip({ customer }: { customer: Customer }) {
  const category = categoryFromCustomer(customer);
  const catStyle = CATEGORY_VARIANT[category] ?? "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";

  return (
    <Link
      href={`/customers/${customer.key}`}
      className="glass-card glass-card-hover flex items-center gap-4 px-4 py-3 transition-all"
    >
      <InitialsAvatar name={customer.display_name} category={category} />

      {/* Name + metadata */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold tracking-tight text-[color:var(--foreground)] truncate">
            {customer.display_name}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${catStyle}`}>
            {category}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {customer.ae_owner ? (
            <span className="data-label text-[color:var(--muted-foreground)] truncate">
              {customer.ae_owner}
            </span>
          ) : null}
          {customer.partner ? (
            <span className="data-label text-[color:var(--muted-foreground)] truncate">
              via {customer.partner}
            </span>
          ) : null}
        </div>
      </div>

      {/* Integration badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        {customer.salesforce_account_id ? (
          <span className="data-label px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
            SF
          </span>
        ) : null}
        {customer.monday_item_id ? (
          <span className="data-label px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 border border-purple-500/20">
            MON
          </span>
        ) : null}
        {(customer.deliveryops_protected_fields?.length ?? 0) > 0 ? (
          <span
            title={`${customer.deliveryops_protected_fields.length} field(s) manually edited`}
            className="data-label px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border border-[var(--glass-border)]"
          >
            {customer.deliveryops_protected_fields.length} edited
          </span>
        ) : null}
        {/* Arrow */}
        <svg
          className="w-3.5 h-3.5 text-[color:var(--muted-foreground)] ml-1 transition-transform group-hover:translate-x-0.5"
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </div>
    </Link>
  );
}

export default async function CustomersPage() {
  const [customers, summary] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
  ]);

  const grouped = new Map<string, Customer[]>();
  for (const c of customers) {
    const cat = categoryFromCustomer(c);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(c);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }
  const orderedGroups = Array.from(grouped.entries()).sort(
    ([a], [b]) => categorySortIndex(a) - categorySortIndex(b) || a.localeCompare(b)
  );

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1400px] mx-auto space-y-8">
      <PageHeader
        eyebrow="Customers"
        title="Customers"
        subtitle={`${summary?.total ?? customers.length} accounts — ${summary?.with_monday_workspace ?? 0} with active delivery workspaces · ${
          summary?.last_sync.monday ? `Monday synced ${formatTimeAgo(summary.last_sync.monday)}` : "Monday not synced"
        }`}
        actions={
          <Link
            href="/operations"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
          >
            Operations chat
          </Link>
        }
      />

      {/* Distribution bar */}
      <div className="glass-card px-5 py-4">
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-3">Distribution</div>
        <div className="flex flex-wrap gap-4">
          {CATEGORY_ORDER.map((category) => {
            const count = grouped.get(category)?.length ?? 0;
            if (count === 0) return null;
            const dot = CATEGORY_DOT[category] ?? "bg-[color:var(--muted-foreground)]";
            return (
              <div key={category} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${dot}`} />
                <span className="data-label text-[color:var(--muted-foreground)]">{category}</span>
                <span className="data-label font-semibold text-[color:var(--foreground)] tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex flex-wrap items-center justify-between gap-3">
          <span className="data-label text-[color:var(--muted-foreground)]">
            {summary?.with_salesforce ?? 0} mapped to Salesforce · {summary?.with_monday_workspace ?? 0} with Monday workspace
          </span>
          <span className="data-label text-[color:var(--muted-foreground)]">
            SF {formatTimeAgo(summary?.last_sync.salesforce ?? null)} · Monday {formatTimeAgo(summary?.last_sync.monday ?? null)}
          </span>
        </div>
      </div>

      {/* Customer groups */}
      {orderedGroups.map(([category, list]) => {
        if (list.length === 0) return null;
        // Softer framing for past/inactive accounts — show their contributions
        // rather than emphasising a negative status.
        const isPastEngagement = category === "Churned" || category === "To Drop";
        const displayLabel = isPastEngagement
          ? `${category === "Churned" ? "Past engagements" : "Winding down"} · ${list.length}`
          : null;
        return (
          <section key={category} className={`space-y-2 ${isPastEngagement ? "opacity-70" : ""}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${CATEGORY_DOT[category] ?? "bg-[color:var(--muted-foreground)]"}`} />
                <span className={`text-sm font-semibold tracking-tight ${isPastEngagement ? "text-[color:var(--muted-foreground)]" : "text-[color:var(--foreground)]"}`}>
                  {displayLabel ?? category}
                </span>
                {isPastEngagement ? (
                  <span className="text-[10px] text-[color:var(--muted-foreground)] italic">
                    (projects delivered; relationship closed)
                  </span>
                ) : null}
              </div>
              {!isPastEngagement && (
                <span className="data-label text-[color:var(--muted-foreground)] tabular-nums">{list.length}</span>
              )}
            </div>
            <div className="space-y-2">
              {list.map((c) => (
                <CustomerStrip key={c.id} customer={c} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
