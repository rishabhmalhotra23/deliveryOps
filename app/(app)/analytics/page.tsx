import Link from "next/link";

import { loadAnalytics } from "@/lib/analytics/loader";
import { formatTimeAgo } from "@/app/_components/brand";
import { BackButton } from "@/app/_components/back-button";
import {
  ArrByCategoryChart,
  CustomersByCategoryChart,
  TtvDistributionChart,
  TtvTrendChart,
  NpsGauge,
  NpsDistributionChart,
  NpsByQuarterChart,
  DeliveriesOverTimeChart,
} from "./charts";
import { WorkloadDrilldownSection } from "./_components/workload-drilldown-section";
import { AnalyticsKpiRow } from "./_components/kpi-row";
import {
  loadActiveProjects,
  loadArrBreakdown,
  loadNpsResponses,
  loadOpenOpportunities,
} from "@/lib/dashboard/stats-drilldown";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [bundle, arrRows, activeProjects, npsResponses, oppsRows] = await Promise.all([
    loadAnalytics(),
    loadArrBreakdown().catch(() => []),
    loadActiveProjects().catch(() => []),
    loadNpsResponses().catch(() => []),
    loadOpenOpportunities().catch(() => []),
  ]);
  const { totals } = bundle;

  const lastSynced = bundle.last_sync.monday ?? bundle.last_sync.salesforce;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1400px] mx-auto space-y-8">
      {/* Nav */}
      <div className="flex items-center justify-between">
        <BackButton href="/dashboard" label="Dashboard" />
        <Link href="/dev/sync" className="btn-primary inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold">
          Refresh data
        </Link>
      </div>

      {/* Header */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)] mb-1">Analytics</div>
        <h1 className="text-4xl font-bold tracking-tight text-[color:var(--foreground)]">Portfolio at a glance.</h1>
        <p className="text-sm text-[color:var(--muted-foreground)] mt-2">
          Aggregate metrics across the book — customers, projects, NPS, pipeline.
          {lastSynced ? ` Last synced ${formatTimeAgo(lastSynced)}.` : ""}
        </p>
      </div>

      {/* Hero KPI row — every card is click-through to the underlying
          rows (customers / projects / NPS responses / opportunities). */}
      <AnalyticsKpiRow
        totals={totals}
        arrRows={arrRows}
        activeProjects={activeProjects}
        npsResponses={npsResponses}
        oppsRows={oppsRows}
      />

      {/* ARR + Customer distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Chart title="ARR by category" subtitle="Where your revenue sits">
          <ArrByCategoryChart data={bundle.by_category} />
        </Chart>
        <Chart title="Customer portfolio" subtitle="Customers by lifecycle stage">
          <CustomersByCategoryChart data={bundle.by_category} />
        </Chart>
      </div>

      {/* Delivery timeline — full width, most important chart */}
      {bundle.deliveries_over_time.length > 0 ? (
        <Chart
          title="Delivery timeline"
          subtitle="Projects delivered by go-live month · all FY boards"
          featured
        >
          <DeliveriesOverTimeChart data={bundle.deliveries_over_time} />
        </Chart>
      ) : null}

      {/* NPS section — lead with Q-on-Q trend, not a static gauge */}
      {totals.nps_responses > 0 ? (
        <>
          <Chart
            title="NPS trend by quarter"
            subtitle={`How customer sentiment is changing — ${totals.nps_responses} responses total, avg ${totals.nps_average?.toFixed(1) ?? "—"}`}
            featured
          >
            <NpsByQuarterChart data={bundle.nps_by_quarter} />
          </Chart>
          <div className="grid gap-6 lg:grid-cols-3">
            <Chart title="NPS health score" subtitle="Portfolio-wide average">
              <NpsGauge score={totals.nps_average} count={totals.nps_responses} />
            </Chart>
            <Chart title="Promoters vs Detractors" subtitle="All-time distribution">
              <NpsDistributionChart data={bundle.nps_distribution} />
            </Chart>
            {bundle.nps_by_customer_category.length > 0 ? (
              <Chart title="NPS by segment" subtitle="Average score per customer category">
                <div className="space-y-2 py-2">
                  {bundle.nps_by_customer_category.map((row) => {
                    const color = row.average >= 8 ? "#34d399" : row.average >= 6 ? "#fbbf24" : "#f43f5e";
                    const pct = (row.average / 10) * 100;
                    return (
                      <div key={row.category}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[color:var(--foreground)] font-medium">{row.category}</span>
                          <span style={{ color }} className="font-semibold tabular-nums">{row.average.toFixed(1)}</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden bg-[var(--glass-bg)]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Chart>
            ) : null}
          </div>
        </>
      ) : null}

      {/* TTV — Time to Value analysis */}
      {bundle.ttv_distribution.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Chart title="Time to value distribution" subtitle="Days from kickoff to go-live — how fast does the team ship?">
            <TtvDistributionChart data={bundle.ttv_distribution} />
          </Chart>
          {bundle.ttv_avg_by_quarter.length > 1 ? (
            <Chart title="TTV trend by quarter" subtitle="Average days to go-live — is the team shipping faster?">
              <TtvTrendChart data={bundle.ttv_avg_by_quarter} />
            </Chart>
          ) : (
            <Chart title="TTV trend" subtitle="Will populate once more quarterly data is available">
              <div className="h-[220px] flex items-center justify-center text-sm text-[color:var(--muted-foreground)]">
                More data needed for trend analysis
              </div>
            </Chart>
          )}
        </div>
      ) : null}

      {/* FDE workload + projects-by-stage + AE workload.
          All three charts get click-through to a drill-down side panel —
          see WorkloadDrilldownSection for the dispatch logic. */}
      <WorkloadDrilldownSection
        bundle={bundle}
        knownAes={bundle.by_ae
          .map((r) => r.ae)
          .filter((ae) => ae && ae !== "(unassigned)")}
      />

      {/* Project phase breakdown */}
      {bundle.projects_by_phase.length > 0 ? (
        <section className="glass-card p-6">
          <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] mb-4">
            Projects by milestone phase
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {bundle.projects_by_phase.slice(0, 10).map((p, i) => (
              <div key={p.phase} className="glass-card p-3">
                <div
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: i < 5 ? ["#818cf8","#34d399","#38bdf8","#fb923c","#a78bfa"][i] : undefined }}
                >
                  {p.count}
                </div>
                <div className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5 leading-tight">{p.phase}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────
// (KpiCard moved to ./_components/kpi-row.tsx as a click-through KPI button.)

function Chart({
  title,
  subtitle,
  children,
  featured,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <section className={`glass-card glass-card-hover p-6 ${featured ? "col-span-full" : ""}`}>
      <div className="mb-5">
        <div className="text-base font-semibold tracking-tight text-[color:var(--foreground)]">{title}</div>
        {subtitle ? <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
