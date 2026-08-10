import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/app/_components/brand";
import { DashboardTabs } from "./_components/dashboard-tabs";
import { DashboardOverview } from "./_overview";
import { DashboardTrends } from "./_trends/content";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function Dashboard({ searchParams }: Props) {
  const { tab } = await searchParams;
  const activeTab: "overview" | "trends" = tab === "trends" ? "trends" : "overview";

  return (
    <div className="px-8 lg:px-12 py-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <PageHeader
          eyebrow="Dashboard"
          title="Every customer, every system, one view."
          actions={
            <Link
              href="/operations"
              className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
            >
              Operations chat
            </Link>
          }
        />
      </div>

      <DashboardTabs active={activeTab} />

      <Suspense fallback={null}>
        {activeTab === "trends" ? <DashboardTrends /> : <DashboardOverview />}
      </Suspense>
    </div>
  );
}
