import Link from "next/link";

import { loadAnalytics } from "@/lib/analytics/loader";
import { formatMoney, formatTimeAgo } from "@/app/_components/brand";
import { BackButton } from "@/app/_components/back-button";
import {
  ArrByCategoryChart,
  CustomersByCategoryChart,
  ProjectsByGroupChart,
  AeWorkloadChart,
  TeamWorkloadChart,
  TtvDistributionChart,
  TtvTrendChart,
  NpsGauge,
  NpsDistributionChart,
  NpsByQuarterChart,
  DeliveriesOverTimeChart,
} from "./charts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const bundle = await loadAnalytics();
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
          {totals.customers} customers · {totals.projects_total} projects · {totals.nps_responses} NPS responses
          {lastSynced ? ` · Synced ${formatTimeAgo(lastSynced)}` : ""}
        </p>
      </div>

      {/* Hero KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total ARR"
          value={formatMoney(totals.total_arr)}
          sub={`${totals.customers} customers`}
          color="#818cf8"
          featured
        />
        <KpiCard
          label="Active projects"
          value={String(totals.projects_in_progress)}
          sub={`${totals.projects_total} total · ${totals.projects_delivered} delivered`}
          color="#34d399"
        />
        <KpiCard
          label="Average NPS"
          value={totals.nps_average != null ? totals.nps_average.toFixed(1) : "—"}
          sub={`${totals.nps_responses} responses`}
          color={totals.nps_average != null && totals.nps_average >= 8 ? "#34d399" : totals.nps_average != null && totals.nps_average >= 6 ? "#fbbf24" : "#f43f5e"}
        />
        <KpiCard
          label="Open pipeline"
          value={String(totals.open_opportunities)}
          sub={`${totals.open_cases} open cases`}
          color="#fb923c"
        />
      </div>

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

      {/* Delivery team workload */}
      <div className="grid gap-6 lg:grid-cols-2">
        {bundle.by_tam.length > 0 ? (
          <Chart title="TAM / FDE workload" subtitle="Projects per Technical Account Manager / Field Delivery Engineer">
            <TeamWorkloadChart data={bundle.by_tam} />
          </Chart>
        ) : null}
        {bundle.by_dev.length > 0 ? (
          <Chart title="SE / Dev workload" subtitle="Projects per Solutions Engineer">
            <TeamWorkloadChart data={bundle.by_dev} />
          </Chart>
        ) : null}
      </div>

      {/* Projects + AE */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Chart title="Projects by stage" subtitle="Active in-flight pipeline (Active / Pipeline / On Hold / Backlog)">
          <ProjectsByGroupChart data={bundle.projects_by_lifecycle} />
        </Chart>
        <Chart title="AE workload" subtitle="ARR per Account Executive">
          <AeWorkloadChart data={bundle.by_ae} />
        </Chart>
      </div>

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

function KpiCard({
  label,
  value,
  sub,
  color,
  featured,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 flex flex-col justify-between min-h-[110px] ${featured ? "lg:min-h-[130px]" : ""}`}
      style={{
        background: featured ? `${color}15` : "var(--card)",
        border: `1px solid ${color}${featured ? "35" : "20"}`,
      }}
    >
      <div className="text-xs font-medium text-[color:var(--muted-foreground)] uppercase tracking-wider">{label}</div>
      <div>
        <div
          className="font-bold tabular-nums leading-none"
          style={{ fontSize: featured ? "2.5rem" : "2rem", color }}
        >
          {value}
        </div>
        <div className="text-xs text-[color:var(--muted-foreground)] mt-1.5">{sub}</div>
      </div>
    </div>
  );
}

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
