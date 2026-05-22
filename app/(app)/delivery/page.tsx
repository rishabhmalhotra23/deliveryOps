import Link from "next/link";

import { loadDeliveryBundle } from "@/lib/delivery/loader";
import { PageHeader, formatTimeAgo } from "@/app/_components/brand";
import { BackButton } from "@/app/_components/back-button";
import { DeliveryClient } from "./delivery-client";
import { DeliveryStatsRow } from "./_components/delivery-stats-row";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const bundle = await loadDeliveryBundle();
  const sub =
    bundle.last_sync != null
      ? `Synced ${formatTimeAgo(bundle.last_sync)}.`
      : "Monday cache hasn't synced yet — run /dev/sync.";

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <PageHeader
        eyebrow="Delivery"
        title="Every project, every customer, every quarter."
        subtitle={`Portfolio-wide delivery across every active board. ${sub}`}
        actions={
          <Link
            href="/dev/sync"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
          >
            Refresh data
          </Link>
        }
      />

      <DeliveryStatsRow projects={bundle.projects} totals={bundle.totals} />

      <DeliveryClient projects={bundle.projects} facets={bundle.facets} />
    </div>
  );
}
