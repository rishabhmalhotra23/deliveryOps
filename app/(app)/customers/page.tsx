import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import {
  loadCustomerCommercialsMap,
  loadCustomerDomainMap,
  loadPortfolioSummary,
  type CustomerCommercials,
} from "@/lib/cache/integrations";
import { loadFdesByCustomerId } from "@/lib/dashboard/stats-drilldown";
import { deriveCustomerDomain } from "@/app/_components/customer-domain";
import {
  PageHeader,
  formatTimeAgo,
  categoryFromCustomer,
  zoneForCategory,
} from "@/app/_components/brand";
import { CustomersBrowser, type CustomerRow } from "./_components/customers-browser";
import type { Customer } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const [customers, summary, sfDomains, commercialsMap, fdesByCustomer] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
    loadCustomerDomainMap().catch(() => new Map<string, string | null>()),
    loadCustomerCommercialsMap().catch(() => new Map<string, CustomerCommercials>()),
    loadFdesByCustomerId().catch(() => new Map<string, string[]>()),
  ]);

  // Resolve a domain per customer with a graceful fallback chain so favicon
  // services have something to look up even when Salesforce data is missing.
  const domainFor = (c: Customer): string | null =>
    sfDomains.get(c.id) ?? deriveCustomerDomain({ emailAlias: c.email_alias, key: c.key });

  // Flatten to a serializable row list. Category + zone are resolved here
  // (server-side, with full signals) so the client browser stays pure
  // presentation — it filters, sorts, and groups, but derives nothing.
  const rows: CustomerRow[] = customers.map((c) => {
    const commercials = commercialsMap.get(c.id);
    const category = categoryFromCustomer(c, {
      renewal_date: commercials?.renewal_date,
      annual_revenue: commercials?.annual_revenue,
    });
    return {
      key: c.key,
      displayName: c.display_name,
      logoUrl: c.logo_url ?? null,
      domain: domainFor(c),
      category,
      zone: zoneForCategory(category),
      aeOwner: c.ae_owner,
      fdes: fdesByCustomer.get(c.id) ?? [],
      partner: c.partner,
      arr: commercials?.arr ?? null,
      renewalDate: commercials?.renewal_date ?? null,
      editedCount: c.deliveryops_protected_fields?.length ?? 0,
    };
  });

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        eyebrow="Customers"
        title="Customers"
        subtitle={
          summary?.last_sync.monday
            ? `Your portfolio across Focus, Pipeline, Evaluation, and Closed. Monday synced ${formatTimeAgo(summary.last_sync.monday)}.`
            : "Your portfolio across Focus, Pipeline, Evaluation, and Closed. Monday hasn't synced yet."
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

      <CustomersBrowser rows={rows} />
    </div>
  );
}
