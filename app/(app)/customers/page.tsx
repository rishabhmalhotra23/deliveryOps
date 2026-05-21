import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import {
  loadCustomerCommercialsMap,
  loadCustomerDomainMap,
  loadPortfolioSummary,
  type CustomerCommercials,
} from "@/lib/cache/integrations";
import { CustomerAvatar } from "@/app/_components/customer-avatar";
import { deriveCustomerDomain } from "@/app/_components/customer-domain";
import {
  PageHeader,
  formatMoney,
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
  Past: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  Churned: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  Dropped: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

const CATEGORY_DOT: Record<string, string> = {
  "At Risk": "bg-red-500",
  "To Drop": "bg-red-500",
  "Upcoming Renewals": "bg-amber-500",
  "Strategic Growth": "bg-emerald-500",
  Active: "bg-emerald-500",
  "Partner Managed": "bg-purple-500",
  POV: "bg-[#F2FF70]",
  Past: "bg-[color:var(--muted-foreground)]",
  Churned: "bg-[color:var(--muted-foreground)]",
  Dropped: "bg-[color:var(--muted-foreground)]",
};

const PAST_CATEGORIES = new Set(["Churned", "Dropped", "Past", "To Drop"]);

// Days until renewal — used to tint the renewal-date pill amber when it's
// within 90 days, red when within 30, neutral otherwise. Past dates show in
// red too because that's a sync-stale signal worth surfacing.
function renewalUrgency(iso: string | null): "soon" | "due" | "ok" | "past" | "none" {
  if (!iso) return "none";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "none";
  const days = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return "past";
  if (days <= 30) return "due";
  if (days <= 90) return "soon";
  return "ok";
}

const RENEWAL_TONE: Record<string, string> = {
  due:  "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  soon: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  ok:   "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  past: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  none: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

function CustomerStrip({
  customer,
  domain,
  commercials,
}: {
  customer: Customer;
  domain: string | null;
  commercials: CustomerCommercials | null;
}) {
  const category = categoryFromCustomer(customer, {
    renewal_date: commercials?.renewal_date,
    annual_revenue: commercials?.annual_revenue,
  });
  const catStyle = CATEGORY_VARIANT[category] ?? "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
  const isPast = PAST_CATEGORIES.has(category);
  const arr = commercials?.arr ?? null;
  const renewal = commercials?.renewal_date ?? null;
  const urgency = renewalUrgency(renewal);

  return (
    <Link
      href={`/customers/${customer.key}`}
      className="glass-card glass-card-hover flex items-center gap-4 px-4 py-3 transition-all"
    >
      <CustomerAvatar
        name={customer.display_name}
        logoUrl={customer.logo_url}
        domain={domain}
        category={category}
        size="sm"
        dimmed={isPast}
      />

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

      {/* Commercial summary — ARR + renewal date.  Skipped for past
          customers since neither number is meaningful for them. */}
      {!isPast ? (
        <div className="hidden md:flex items-center gap-2 shrink-0 mr-3 text-right">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]">ARR</div>
            <div className="data-label tabular-nums text-[color:var(--foreground)] font-semibold">
              {arr != null ? formatMoney(arr) : "—"}
            </div>
          </div>
          <div className="w-px h-7 bg-[var(--glass-border)]" />
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]">Renews</div>
            {renewal ? (
              <span
                title={
                  urgency === "due"
                    ? "Renewal within 30 days"
                    : urgency === "soon"
                      ? "Renewal within 90 days"
                      : urgency === "past"
                        ? "Renewal date is in the past — sync may be stale"
                        : "Renewal date"
                }
                className={`data-label tabular-nums px-1.5 py-0.5 rounded border whitespace-nowrap ${RENEWAL_TONE[urgency]}`}
              >
                {renewal}
              </span>
            ) : (
              <span className="data-label text-[color:var(--muted-foreground)]">—</span>
            )}
          </div>
        </div>
      ) : null}

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
  const [customers, summary, sfDomains, commercialsMap] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
    loadCustomerDomainMap().catch(() => new Map<string, string | null>()),
    loadCustomerCommercialsMap().catch(() => new Map<string, CustomerCommercials>()),
  ]);

  // Resolve a domain per customer with a graceful fallback chain so favicon
  // services have something to lookup even when Salesforce data is missing.
  const domainFor = (c: Customer): string | null =>
    sfDomains.get(c.id) ??
    deriveCustomerDomain({ emailAlias: c.email_alias, key: c.key });

  // Helper for the dynamic category — same signals every consumer in this
  // page uses, in one place so the strip and the group header don't drift.
  const categoryFor = (c: Customer): string => {
    const commercials = commercialsMap.get(c.id);
    return categoryFromCustomer(c, {
      renewal_date: commercials?.renewal_date,
      annual_revenue: commercials?.annual_revenue,
    });
  };

  const grouped = new Map<string, Customer[]>();
  for (const c of customers) {
    const cat = categoryFor(c);
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
        subtitle={
          summary?.last_sync.monday
            ? `Your portfolio, grouped by lifecycle stage. Monday synced ${formatTimeAgo(summary.last_sync.monday)}.`
            : "Your portfolio, grouped by lifecycle stage. Monday hasn't synced yet."
        }
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
        // Softer framing for past/inactive accounts. "Past" is the auto-class
        // for Monday's ambiguous "Churned/Dropped" group — the CSM can
        // disambiguate per-customer into "Churned" or "Dropped" via inline
        // edit on the customer page.
        const isPastEngagement = PAST_CATEGORIES.has(category);
        const PAST_HEADER: Record<string, string> = {
          Churned: "Churned customers",
          Dropped: "Dropped accounts",
          Past: "Past customers · awaiting classification",
          "To Drop": "Winding down",
        };
        const displayLabel = isPastEngagement
          ? `${PAST_HEADER[category] ?? category} · ${list.length}`
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
                    {category === "Past"
                      ? "(Monday says \u201cChurned/Dropped\u201d — open a customer to mark them Churned or Dropped)"
                      : category === "Dropped"
                        ? "(disengaged before go-live)"
                        : category === "To Drop"
                          ? "(decided to drop at renewal)"
                          : "(no longer using DeliveryOps)"}
                  </span>
                ) : null}
              </div>
              {!isPastEngagement && (
                <span className="data-label text-[color:var(--muted-foreground)] tabular-nums">{list.length}</span>
              )}
            </div>
            <div className="space-y-2">
              {list.map((c) => (
                <CustomerStrip
                  key={c.id}
                  customer={c}
                  domain={domainFor(c)}
                  commercials={commercialsMap.get(c.id) ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
