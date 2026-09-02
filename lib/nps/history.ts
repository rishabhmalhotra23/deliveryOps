// All-time / by-quarter NPS aggregation across every customer, for the /nps
// admin page's "Score history" section. Deliberately a small dedicated
// query rather than calling lib/analytics/loader.ts's loadAnalytics() —
// that function runs ~13 queries to build the whole dashboard Trends
// bundle, which would be wasted overhead here since /nps only needs
// nps_responses. Mirrors that same file's npsCategory bucketing + quarter
// sort so the two stay visually consistent.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, npsCategory } from "@/lib/supabase/types";

export interface NpsQuarterStat {
  quarter: string;
  average: number;
  count: number;
  promoter: number;
  passive: number;
  detractor: number;
}

export interface NpsDistributionStat {
  category: string;
  count: number;
}

export interface NpsHistory {
  totalAverage: number | null;
  totalResponses: number;
  byQuarter: NpsQuarterStat[];
  distribution: NpsDistributionStat[];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// nps_responses.quarter is stored "<quarter-digit>Q<2-digit-year>" (e.g.
// "4Q25", "1Q26") — same format lib/analytics/loader.ts,
// lib/dashboard/stats-drilldown.ts, and lib/customers/view-model.ts already
// sort by. lib/nps/campaigns.ts composes new campaigns' quarter values in
// this exact format (see the New Campaign modal's quarter+year picker) so
// historical and campaign-sourced responses sort together correctly.
/** Pure. Exported for unit testing (tests/nps/history.test.ts). */
export function quarterSortKey(s: string): number {
  const m = /^(\d)Q(\d{2})$/.exec(s);
  return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
}

const NPS_CAT_ORDER = ["Promoter", "Passive", "Detractor"];

export async function loadNpsHistory(): Promise<NpsHistory> {
  const sb = requireAdmin();
  const { data, error } = await sb.from(TABLES.npsResponses).select("score, quarter");
  if (error) throw error;
  const rows = (data as { score: number; quarter: string }[]) ?? [];

  const distAgg = new Map<string, number>();
  const byQuarterAgg = new Map<
    string,
    { sum: number; count: number; promoter: number; passive: number; detractor: number }
  >();
  let sum = 0;

  for (const r of rows) {
    const cat = capitalize(npsCategory(r.score));
    distAgg.set(cat, (distAgg.get(cat) ?? 0) + 1);
    sum += r.score;

    if (r.quarter) {
      const prev = byQuarterAgg.get(r.quarter) ?? { sum: 0, count: 0, promoter: 0, passive: 0, detractor: 0 };
      prev.sum += r.score;
      prev.count++;
      if (cat === "Promoter") prev.promoter++;
      else if (cat === "Passive") prev.passive++;
      else prev.detractor++;
      byQuarterAgg.set(r.quarter, prev);
    }
  }

  const distribution = NPS_CAT_ORDER.map((cat) => ({ category: cat, count: distAgg.get(cat) ?? 0 })).filter(
    (d) => d.count > 0
  );

  const byQuarter = [...byQuarterAgg.entries()]
    .map(([quarter, v]) => ({
      quarter,
      average: Math.round((v.sum / v.count) * 10) / 10,
      count: v.count,
      promoter: v.promoter,
      passive: v.passive,
      detractor: v.detractor,
    }))
    .sort((a, b) => quarterSortKey(a.quarter) - quarterSortKey(b.quarter));

  return {
    totalAverage: rows.length > 0 ? Math.round((sum / rows.length) * 10) / 10 : null,
    totalResponses: rows.length,
    byQuarter,
    distribution,
  };
}
