import Link from "next/link";
import { BackButton } from "@/app/_components/back-button";
import { V2MigrationClient } from "./_components/v2-migration-client";

export const dynamic = "force-dynamic";

export default function V2MigrationReportPage() {
  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <BackButton href="/reports" label="Reports" />
        <Link href="/reports/v2-migration/tickets"
          className="text-xs font-medium text-[color:var(--foreground)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors">
          Open Tickets →
        </Link>
      </div>
      <V2MigrationClient />
    </div>
  );
}
