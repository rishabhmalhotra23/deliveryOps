import { BackButton } from "@/app/_components/back-button";
import { loadDeliveryReview } from "@/lib/reports/delivery-review-loader";
import { DeliveryReviewClient } from "./delivery-review-client";
import type { RangePreset } from "@/lib/reports/date-range";

export const dynamic = "force-dynamic";

export default async function DeliveryReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const preset = (params.preset as RangePreset | undefined) ?? "week";
  const report = await loadDeliveryReview({ preset, from: params.from, to: params.to });

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <DeliveryReviewClient report={report} />
    </div>
  );
}
