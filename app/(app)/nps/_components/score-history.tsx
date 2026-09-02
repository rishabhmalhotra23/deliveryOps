// All-time / by-quarter NPS trend, across every historical response —
// including the 84 rows imported before this campaign feature existed —
// plus everything future campaigns collect. Reuses the exact chart
// components the dashboard's Trends tab already built for this same data
// shape (app/(app)/dashboard/_trends/charts.tsx) rather than a new pair of
// charts.

import { NpsGauge, NpsByQuarterChart, NpsDistributionChart } from "@/app/(app)/dashboard/_trends/charts";
import type { NpsHistory } from "@/lib/nps/history";

function Card({
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
    <div
      className={`glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-4 ${featured ? "col-span-full" : ""}`}
    >
      <div className="mb-3">
        <div className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">{title}</div>
        {subtitle ? <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function ScoreHistory({ history }: { history: NpsHistory }) {
  if (history.totalResponses === 0) {
    return (
      <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-6 text-sm text-[color:var(--muted-foreground)]">
        No NPS responses yet — historical or from a campaign.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title="NPS trend by quarter"
        subtitle={`${history.totalResponses} responses all-time · avg ${history.totalAverage?.toFixed(1) ?? "—"}`}
        featured
      >
        <NpsByQuarterChart data={history.byQuarter} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="NPS health score" subtitle="All-time average">
          <NpsGauge score={history.totalAverage} count={history.totalResponses} />
        </Card>
        <Card title="Promoters vs Detractors" subtitle="All-time distribution">
          <NpsDistributionChart data={history.distribution} />
        </Card>
      </div>
    </div>
  );
}
