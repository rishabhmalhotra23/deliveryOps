import { loadProcessesOverview, loadV2MigrationOverview } from "@/lib/processes/loader";
import { BackButton } from "@/app/_components/back-button";
import { DeliveryClient } from "./delivery-client";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const [processesOverview, v2Overview] = await Promise.all([loadProcessesOverview(), loadV2MigrationOverview()]);

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <DeliveryClient processesOverview={processesOverview} v2Overview={v2Overview} />
    </div>
  );
}
