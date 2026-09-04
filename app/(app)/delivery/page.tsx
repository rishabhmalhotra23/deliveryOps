import { loadProcessesOverview } from "@/lib/processes/loader";
import { BackButton } from "@/app/_components/back-button";
import { DeliveryClient } from "./delivery-client";

export const dynamic = "force-dynamic";

// One loader, not two. Every section is derived from the same row list by
// lib/delivery/sections.ts, so loadV2MigrationOverview() — which applies the
// All-Hands report's stricter isV2Relevant() test — is no longer what the V2
// tab renders. Dropping it removes a second full fetch of processes,
// customers and Salesforce opps on every page load, and removes the reason 36
// processes used to appear in two tabs at once.
export default async function DeliveryPage() {
  const processesOverview = await loadProcessesOverview();

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <DeliveryClient processesOverview={processesOverview} />
    </div>
  );
}
