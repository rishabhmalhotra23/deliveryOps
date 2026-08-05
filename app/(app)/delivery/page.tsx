import { loadProcessesOverview } from "@/lib/processes/loader";
import { PageHeader } from "@/app/_components/brand";
import { BackButton } from "@/app/_components/back-button";
import { DeliveryClient } from "./delivery-client";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const overview = await loadProcessesOverview();

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <PageHeader
        eyebrow="Delivery"
        title="Every process, every customer, every quarter."
        subtitle={`${overview.counts.total} processes, native to DeliveryOps — no Monday dependency on this page.`}
      />

      <DeliveryClient overview={overview} />
    </div>
  );
}
