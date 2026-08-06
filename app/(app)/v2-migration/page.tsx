import { loadV2MigrationOverview } from "@/lib/processes/loader";
import { PageHeader } from "@/app/_components/brand";
import { BackButton } from "@/app/_components/back-button";
import { V2MigrationClient } from "./v2-migration-client";

export const dynamic = "force-dynamic";

export default async function V2MigrationPage() {
  const overview = await loadV2MigrationOverview();

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <PageHeader
        eyebrow="V2 Migration"
        title="The V1 → V2 migration program."
        subtitle={`${overview.counts.total} processes with real migration activity — reads the same processes rows as Delivery, no Excel dependency.`}
      />

      <V2MigrationClient overview={overview} />
    </div>
  );
}
