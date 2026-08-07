import { BackButton } from "@/app/_components/back-button";
import { loadAllHandsReport } from "@/lib/reports/allhands-loader";
import { AllHandsClient } from "./allhands-client";
import type { RangePreset } from "@/lib/reports/date-range";

export const dynamic = "force-dynamic";

export default async function AllHandsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const preset = (params.preset as RangePreset | undefined) ?? "week";
  const report = await loadAllHandsReport({ preset, from: params.from, to: params.to });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <AllHandsClient report={report} />
    </div>
  );
}
