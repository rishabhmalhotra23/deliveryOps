import Link from "next/link";

import { loadAnalytics } from "@/lib/analytics/loader";
import {
  PageHeader,
  SectionMark,
  StatBlock,
  formatMoney,
  formatTimeAgo,
} from "@/app/_components/brand";
import {
  ArrByCategoryChart,
  CustomersByCategoryChart,
  ProjectsByGroupChart,
  AeWorkloadChart,
  NpsDistributionChart,
  NpsByQuarterChart,
  DeliveriesOverTimeChart,
} from "./charts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const bundle = await loadAnalytics();

  return (
    <div className="px-8 lg:px-12 py-10 max-w-7xl mx-auto space-y-10">
      <PageHeader
        eyebrow="Analytics"
        title="Portfolio at a glance."
        subtitle={[
          `${bundle.totals.customers} customers`,
          `${bundle.totals.projects_total} projects`,
          `${bundle.totals.nps_responses} NPS responses`,
          bundle.last_sync.salesforce
            ? `SF synced ${formatTimeAgo(bundle.last_sync.salesforce)}`
            : "SF not synced",
          bundle.last_sync.monday
            ? `Monday synced ${formatTimeAgo(bundle.last_sync.monday)}`
            : "Monday not synced",
        ].join(" · ")}
        actions={
          <Link
            href="/dev/sync"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
          >
            Refresh data
          </Link>
        }
      />

      {/* ─── Top stat row ─────────────────────────────────────────── */}
      <section className="grid gap-3 md:grid-cols-4 glass-card-hover">
        <StatBlock
          label="Total ARR"
          value={formatMoney(bundle.totals.total_arr)}
          hint={`${bundle.totals.customers} customers`}
          emphasis
        />
        <StatBlock
          label="Active projects"
          value={String(bundle.totals.projects_in_progress)}
          hint={`${bundle.totals.projects_total} total · ${bundle.totals.projects_delivered} delivered`}
        />
        <StatBlock
          label="Average NPS"
          value={bundle.totals.nps_average != null ? bundle.totals.nps_average.toFixed(1) : "—"}
          hint={`${bundle.totals.nps_responses} responses`}
        />
        <StatBlock
          label="Open pipeline"
          value={String(bundle.totals.open_opportunities)}
          hint={`${bundle.totals.open_cases} open SF cases`}
        />
      </section>

      {/* ─── ARR / customers by category ──────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="ARR by category" subtitle="Kognitos ARR · DeliveryOps category">
          <ArrByCategoryChart data={bundle.by_category} />
        </ChartCard>
        <ChartCard title="Customers by category" subtitle="Where the portfolio sits today">
          <CustomersByCategoryChart data={bundle.by_category} />
        </ChartCard>
      </section>

      {/* ─── Projects ───────────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Projects by board group" subtitle="Active / Pipeline / On Hold / Backlog (from Monday)">
          <ProjectsByGroupChart data={bundle.projects_by_group} />
        </ChartCard>
        {bundle.deliveries_over_time.length > 0 ? (
          <ChartCard title="Projects delivered over time" subtitle="By go-live month">
            <DeliveriesOverTimeChart data={bundle.deliveries_over_time} />
          </ChartCard>
        ) : (
          <ChartCard title="Projects delivered over time" subtitle="By go-live month">
            <Empty text="No projects have a Go Live Date set yet. Once go-live dates populate on Monday, this chart fills in." />
          </ChartCard>
        )}
      </section>

      {/* ─── NPS ─────────────────────────────────────────────── */}
      {bundle.totals.nps_responses > 0 ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="NPS distribution" subtitle={`${bundle.nps_distribution.reduce((s, n) => s + n.count, 0)} responses, all-time`}>
            <NpsDistributionChart data={bundle.nps_distribution} />
          </ChartCard>
          <ChartCard title="NPS trend by quarter" subtitle="Average score + promoter / detractor counts">
            <NpsByQuarterChart data={bundle.nps_by_quarter} />
          </ChartCard>
        </section>
      ) : null}

      {/* ─── AE workload ────────────────────────────────────────── */}
      <ChartCard title="AE workload" subtitle="Customers per Account Executive (top 10)">
        <AeWorkloadChart data={bundle.by_ae} />
      </ChartCard>

      {/* ─── Project phase breakdown table ──────────────────────── */}
      {bundle.projects_by_phase.length > 0 ? (
        <section className="glass-card p-6">
          <div className="eyebrow text-[color:var(--muted-foreground)] mb-3">Projects by milestone</div>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4 mt-4">
            {bundle.projects_by_phase.map((p) => (
              <div
                key={p.phase}
                className="glass-card glass-card-hover p-3"
              >
                <div className="data-label text-2xl font-semibold tabular-nums text-[color:var(--foreground)]">{p.count}</div>
                <div className="eyebrow text-[color:var(--muted-foreground)] mt-0.5">{p.phase}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ─── NPS by customer category ───────────────────────────── */}
      {bundle.nps_by_customer_category.length > 0 ? (
        <section className="glass-card p-6">
          <div className="eyebrow text-[color:var(--muted-foreground)] mb-3">Average NPS by customer category</div>
          <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-7 mt-4">
            {bundle.nps_by_customer_category.map((row) => (
              <div key={row.category} className="glass-card p-3">
                <div className="data-label text-xl font-semibold tabular-nums text-[color:var(--foreground)]">{row.average.toFixed(1)}</div>
                <div className="eyebrow text-[color:var(--muted-foreground)] mt-0.5">{row.category}</div>
                <div className="data-label text-[color:var(--muted-foreground)] tabular-nums">
                  n = {row.responses}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card glass-card-hover p-6">
      <div className="mb-4">
        <div className="eyebrow text-[color:var(--muted-foreground)] mb-1">{title}</div>
        {subtitle ? (
          <p className="text-xs text-[color:var(--muted-foreground)]">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-sm text-[color:var(--brand-gray)] italic py-12 text-center">
      {text}
    </div>
  );
}
