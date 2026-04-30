import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import { loadPortfolioSummary } from "@/lib/cache/integrations";
import {
  LifecycleChip,
  PageHeader,
  SectionMark,
  StatBlock,
  formatMoney,
  formatTimeAgo,
  LIFECYCLE_ORDER,
} from "@/app/_components/brand";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [customers, summary] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
  ]);

  const totalArr = summary?.total_arr ?? 0;
  const needAttention =
    (summary?.by_lifecycle["High Risk"] ?? 0) + (summary?.by_lifecycle["Upcoming Renewal"] ?? 0);

  const recentlyActive = customers.slice().sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
  ).slice(0, 6);

  const highRisk = customers.filter((c) => c.lifecycle_group === "High Risk");
  const renewals = customers.filter((c) => c.lifecycle_group === "Upcoming Renewal");

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
      />

      {/* Top stats — Kognitos hero treatment */}
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
          hint="High Risk + Upcoming Renewal"
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

      {/* Lifecycle distribution */}
      <section>
        <SectionMark>Lifecycle distribution</SectionMark>
        <div className="rounded-lg border border-line bg-white p-6">
          <div className="grid gap-4 md:grid-cols-7">
            {LIFECYCLE_ORDER.map((group) => {
              const count = summary?.by_lifecycle[group] ?? 0;
              const pct = summary?.total ? Math.round((count / summary.total) * 100) : 0;
              return (
                <div key={group} className="space-y-2">
                  <LifecycleChip group={group} size="sm" />
                  <div className="text-display text-3xl tracking-tight tabular-nums">{count}</div>
                  <div className="text-xs text-[color:var(--brand-gray)]">{pct}% of book</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Need attention sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        <FocusList
          title="High risk"
          subtitle="Customers flagged on the Monday board"
          customers={highRisk}
        />
        <FocusList
          title="Upcoming renewals"
          subtitle="Conversations to start now, not later"
          customers={renewals}
        />
      </div>

      {/* Recent activity */}
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
                <LifecycleChip group={c.lifecycle_group} size="sm" />
              </div>
              <div className="mt-2 text-xs text-[color:var(--brand-gray)] space-y-0.5">
                {c.ce_owner ? <div>CE · {c.ce_owner}</div> : null}
                {c.partner ? <div>Partner · {c.partner}</div> : null}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Sync prompt */}
      {!summary?.last_sync.salesforce ? (
        <section className="rounded-lg border border-[color:var(--brand-yellow-line)] bg-[color:var(--brand-yellow-soft)] p-5 text-sm">
          <div className="font-display text-base mb-1">No data synced yet.</div>
          <p className="text-[color:var(--brand-night)] mb-3">
            DeliveryOps caches Salesforce + Monday weekly so the dashboard stays fast. Trigger the
            first sync now to populate.
          </p>
          <Link
            href="/dev/sync"
            className="inline-flex btn-primary rounded-md px-4 py-1.5 text-sm"
          >
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
  return (
    <section className="rounded-lg border border-line bg-white p-6">
      <SectionMark>{title}</SectionMark>
      <p className="text-xs text-[color:var(--brand-gray)] mb-4">{subtitle}</p>
      {customers.length === 0 ? (
        <div className="text-sm text-[color:var(--brand-gray)]">Nothing in this bucket.</div>
      ) : (
        <ul className="divide-y divide-[color:var(--brand-metal-line)]">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/customers/${c.key}`}
                className="flex items-center justify-between py-2.5 hover:opacity-80"
              >
                <div>
                  <div className="font-medium">{c.display_name}</div>
                  {c.ce_owner ? (
                    <div className="text-xs text-[color:var(--brand-gray)]">CE · {c.ce_owner}</div>
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
