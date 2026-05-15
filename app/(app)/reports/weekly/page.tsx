import { loadWeeklyBundle, type RangePreset } from "@/lib/reports/weekly-loader";
import { BackButton } from "@/app/_components/back-button";
import { WeeklyReportClient } from "./_components/weekly-report-client";

export const dynamic = "force-dynamic";

interface SearchParams {
  preset?: string;
  from?: string;
  to?: string;
}

const VALID_PRESETS = new Set<RangePreset>(["week", "month", "quarter", "custom"]);

export default async function WeeklyReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const preset = (VALID_PRESETS.has(params.preset as RangePreset) ? params.preset : "week") as RangePreset;
  const bundle = await loadWeeklyBundle({ preset, from: params.from, to: params.to });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <WeeklyReportClient bundle={bundle} />
    </div>
  );
}
