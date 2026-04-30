import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import { loadPortfolioSummary } from "@/lib/cache/integrations";
import {
  LifecycleChip,
  PageHeader,
  SectionMark,
  formatTimeAgo,
  LIFECYCLE_ORDER,
} from "@/app/_components/brand";
import type { Customer } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const [customers, summary] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
  ]);

  // Group + sort
  const grouped = new Map<string, Customer[]>();
  for (const group of LIFECYCLE_ORDER) grouped.set(group, []);
  for (const c of customers) {
    const k = c.lifecycle_group ?? "Other";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(c);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  return (
    <div className="px-8 lg:px-12 py-10 max-w-7xl mx-auto space-y-10">
      <PageHeader
        eyebrow="Customers"
        title={`${summary?.total ?? customers.length} post-sales accounts.`}
        subtitle="The roster mirrors your Monday Customers board. Each row pulls live data from Salesforce + Monday on the detail page; the list view reads from the cached snapshot."
        actions={
          <Link
            href="/dev/import"
            className="inline-flex items-center rounded-md border border-[color:var(--brand-night)] px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--brand-night)] hover:text-[color:var(--brand-seasalt)] transition-colors"
          >
            Re-import
          </Link>
        }
      />

      {/* Distribution stripe */}
      <section className="rounded-lg border border-line bg-white p-5">
        <SectionMark>Distribution</SectionMark>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
          {LIFECYCLE_ORDER.map((group) => {
            const count = grouped.get(group)?.length ?? 0;
            return (
              <div key={group} className="space-y-1">
                <LifecycleChip group={group} size="sm" />
                <div className="text-display text-2xl tracking-tight tabular-nums">{count}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-[color:var(--brand-metal-line)] flex flex-wrap items-center justify-between gap-3 text-xs text-[color:var(--brand-gray)]">
          <div>
            {summary?.with_salesforce ?? 0} mapped to Salesforce ·{" "}
            {summary?.with_monday_workspace ?? 0} with Monday workspace
          </div>
          <div className="flex gap-3">
            <span>SF synced {formatTimeAgo(summary?.last_sync.salesforce ?? null)}</span>
            <span>Monday synced {formatTimeAgo(summary?.last_sync.monday ?? null)}</span>
          </div>
        </div>
      </section>

      {/* Grouped customer list */}
      {LIFECYCLE_ORDER.map((g) => {
        const list = grouped.get(g);
        if (!list || list.length === 0) return null;
        return (
          <section key={g} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <SectionMark>{g}</SectionMark>
              <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">{list.length}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <CustomerCard key={c.id} customer={c} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <Link
      href={`/customers/${customer.key}`}
      className="group block rounded-lg border border-line bg-white p-5 hover:border-[color:var(--brand-night)] hover:-translate-y-0.5 transition-all relative overflow-hidden"
    >
      {/* The yellow accent line that fires on hover */}
      <span className="absolute left-0 top-0 bottom-0 w-1 bg-[color:var(--brand-yellow)] scale-y-0 group-hover:scale-y-100 origin-top transition-transform" />

      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-display text-lg leading-tight">{customer.display_name}</div>
          <div className="text-[11px] uppercase tracking-wider text-[color:var(--brand-gray)] mt-1">
            {customer.key}
          </div>
        </div>
        {customer.salesforce_account_id ? (
          <span className="chip-yellow text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5">
            SF
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-1 text-sm text-[color:var(--brand-gray)]">
        {customer.ce_owner ? (
          <div>
            <span className="text-[color:var(--brand-night)]">CE</span> · {customer.ce_owner}
          </div>
        ) : null}
        {customer.partner ? (
          <div>
            <span className="text-[color:var(--brand-night)]">Partner</span> · {customer.partner}
          </div>
        ) : null}
        {customer.monday_workspace_id ? (
          <div className="text-[10px] tabular-nums">
            Monday workspace · {customer.monday_workspace_id}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
