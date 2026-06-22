import { BackButton } from "@/app/_components/back-button";
import { V2MigrationClient } from "./_components/v2-migration-client";

export const dynamic = "force-dynamic";

export default function V2MigrationReportPage() {
  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports" label="Reports" />
      <V2MigrationClient />
    </div>
  );
}
