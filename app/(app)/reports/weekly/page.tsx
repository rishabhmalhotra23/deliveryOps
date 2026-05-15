import { loadWeeklyBundle } from "@/lib/reports/weekly-loader";
import { BackButton } from "@/app/_components/back-button";
import { WeeklyReportClient } from "./_components/weekly-report-client";

export const dynamic = "force-dynamic";

export default async function WeeklyReportPage() {
  const bundle = await loadWeeklyBundle();
  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <WeeklyReportClient bundle={bundle} />
    </div>
  );
}
