import Link from "next/link";

import { loadDeliveryBundle } from "@/lib/delivery/loader";
import { PageHeader, StatBlock, formatTimeAgo } from "@/app/_components/brand";
import { BackButton } from "@/app/_components/back-button";
import { DeliveryClient } from "./delivery-client";

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
        subtitle={`${bundle.totals.total} projects across ${bundle.facets.customers.length} customers · ${sub}`}
        actions={
          <Link
            href="/dev/sync"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
          >
            Refresh data
          </Link>
        }
      />

      <section className="grid gap-3 md:grid-cols-4 glass-card-hover">
        <StatBlock label="Projects" value={String(bundle.totals.total)} hint="all boards" emphasis />
        <StatBlock label="In-flight" value={String(bundle.totals.active_in_flight)} hint="active board" />
        <StatBlock label="Delivered all-time" value={String(bundle.totals.delivered_all_time)} hint="Live / Delivered" />
        <StatBlock
          label="Delivered Q-to-date"
          value={String(bundle.totals.delivered_this_quarter)}
          hint="go-live this quarter"
        />
      </section>

      <DeliveryClient projects={bundle.projects} facets={bundle.facets} />
    </div>
  );
}
