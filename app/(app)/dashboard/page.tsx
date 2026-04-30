import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import { loadPortfolioSummary } from "@/lib/cache/integrations";
import {
  CategoryChip,
  PageHeader,
  SectionMark,
  StatBlock,
  formatMoney,
  formatTimeAgo,
  CATEGORY_ORDER,
  categoryFromCustomer,
  categorySortIndex,
} from "@/app/_components/brand";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [customers, summary] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
  ]);

  const totalArr = summary?.total_arr ?? 0;
  const needAttention =
    (summary?.by_category["At Risk"] ?? 0) + (summary?.by_category["Upcoming Renewals"] ?? 0);

  const recentlyActive = customers
    .slice()
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 6);

  const atRisk = customers.filter((c) => categoryFromCustomer(c) === "At Risk");
  const renewals = customers.filter((c) => categoryFromCustomer(c) === "Upcoming Renewals");

  // Discover any custom categories the team has minted via the operations chat.
  const knownCategories = new Set<string>(CATEGORY_ORDER);
  const extraCategories = Object.keys(summary?.by_category ?? {})
    .filter((c) => !knownCategories.has(c))
    .sort();
  const allCategories = [...CATEGORY_ORDER, ...extraCategories];

  return (
    <div className="px-8 lg:px-12 py-10 max-w-7xl mx-auto space-y-12">
      <PageHeader
        eyebrow="Dashboard"
        title="Every customer, every system, one view."
        subtitle={`${summary?.total ?? customers.length} active customers across Salesforce, Monday, and Kognitos. Synced cache · ${
          summary?.last_sync.salesforce
            ? `Salesforce ${formatTimeAgo(summary.last_sync.salesforce)}`
            : "Salesforce never"
        } · ${
          summary?.last_sync.monday
            ? `Monday ${formatTimeAgo(summary.last_sync.monday)}`
            : "Monday never"
        }.`}
        actions={
          <Link
            href="/operations"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
          >
            Operations chat
          </Link>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <StatBlock
          label="Total ARR"
          value={formatMoney(totalArr)}
          hint={`${summary?.with_salesforce ?? 0} customers mapped to Salesforce`}
          emphasis
        />
        <StatBlock
          label="Need attention"
          value={String(needAttention)}
          hint="At Risk + Upcoming Renewals"
        />
        <StatBlock
          label="Open opportunities"
          value={String(summary?.total_open_opportunities ?? 0)}
          hint="Across all customers (cached)"
        />
        <StatBlock
          label="Open cases"
          value={String(summary?.total_open_cases ?? 0)}
          hint="Across all customers (cached)"
        />
      </section>

      <section>
        <SectionMark>Category distribution</SectionMark>
        <div className="rounded-lg border border-line bg-white p-6">
          <div className="grid gap-4 md:grid-cols-7">
            {allCategories.map((category) => {
              const count = summary?.by_category[category] ?? 0;
              if (count === 0) return null;
              const pct = summary?.total ? Math.round((count / summary.total) * 100) : 0;
              return (
                <div key={category} className="space-y-2">
                  <CategoryChip category={category} size="sm" />
                  <div className="text-display text-3xl tracking-tight tabular-nums">{count}</div>
                  <div className="text-xs text-[color:var(--brand-gray)]">{pct}% of book</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <FocusList
          title="At risk"
          subtitle="Conversations to start now, not later"
          customers={atRisk}
        />
        <FocusList
          title="Upcoming renewals"
          subtitle="Renewal cycles entering the danger zone"
          customers={renewals}
        />
      </div>

      <section>
        <SectionMark>Recently updated</SectionMark>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {recentlyActive.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.key}`}
              className="rounded-lg border border-line bg-white p-4 hover:border-[color:var(--brand-night)] transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-display text-base">{c.display_name}</div>
                <CategoryChip category={categoryFromCustomer(c)} size="sm" />
              </div>
              <div className="mt-2 text-xs text-[color:var(--brand-gray)] space-y-0.5">
                {c.ae_owner ? <div>AE · {c.ae_owner}</div> : null}
                {c.partner ? <div>Partner · {c.partner}</div> : null}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {!summary?.last_sync.salesforce ? (
        <section className="rounded-lg border border-[color:var(--brand-yellow-line)] bg-[color:var(--brand-yellow-soft)] p-5 text-sm">
          <div className="font-display text-base mb-1">No data synced yet.</div>
          <p className="text-[color:var(--brand-night)] mb-3">
            DeliveryOps caches Salesforce + Monday weekly so the dashboard stays fast. Trigger the
            first sync now to populate.
          </p>
          <Link href="/dev/sync" className="inline-flex btn-primary rounded-md px-4 py-1.5 text-sm">
            Run sync now
          </Link>
        </section>
      ) : null}
    </div>
  );
}

function FocusList({
  title,
  subtitle,
  customers,
}: {
  title: string;
  subtitle: string;
  customers: Awaited<ReturnType<typeof listCustomers>>;
}) {
  const sorted = customers.slice().sort((a, b) => a.display_name.localeCompare(b.display_name));
  return (
    <section className="rounded-lg border border-line bg-white p-6">
      <SectionMark>{title}</SectionMark>
      <p className="text-xs text-[color:var(--brand-gray)] mb-4">{subtitle}</p>
      {sorted.length === 0 ? (
        <div className="text-sm text-[color:var(--brand-gray)]">Nothing in this bucket.</div>
      ) : (
        <ul className="divide-y divide-[color:var(--brand-metal-line)]">
          {sorted.map((c) => (
            <li key={c.id}>
              <Link
                href={`/customers/${c.key}`}
                className="flex items-center justify-between py-2.5 hover:opacity-80"
              >
                <div>
                  <div className="font-medium">{c.display_name}</div>
                  {c.ae_owner ? (
                    <div className="text-xs text-[color:var(--brand-gray)]">AE · {c.ae_owner}</div>
                  ) : null}
                </div>
                {c.partner ? (
                  <span className="text-xs text-[color:var(--brand-gray)]">{c.partner}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Suppress lint warning when categorySortIndex isn't used — kept for future
// custom category orderings via the operations chat.
void categorySortIndex;
