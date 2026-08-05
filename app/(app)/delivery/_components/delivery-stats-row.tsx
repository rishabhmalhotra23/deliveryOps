"use client";

import { StatBlock } from "@/app/_components/brand";
import type { ProcessesOverview } from "@/lib/processes/loader";

// Each stat jumps straight to the matching tab rather than opening its own
// drill-down panel — the tab's table/board already is the drill-down, no
// need for a second copy of the same list.
export function DeliveryStatsRow({
  counts,
  onSelectTab,
}: {
  counts: ProcessesOverview["counts"];
  onSelectTab: (tab: "Active Work" | "Delivered" | "Archive" | "All") => void;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-5">
      <StatBlock
        label="Processes"
        value={String(counts.total)}
        hint="all views"
        emphasis
        onClick={() => onSelectTab("All")}
      />
      <StatBlock
        label="Active"
        value={String(counts.active)}
        hint="in flight"
        onClick={() => onSelectTab("Active Work")}
      />
      <StatBlock
        label="Delivered"
        value={String(counts.delivered)}
        hint="live"
        onClick={() => onSelectTab("Delivered")}
      />
      <StatBlock
        label="Archive"
        value={String(counts.archive)}
        hint={`${counts.archiveBreakdown.cancelled} cancelled · ${counts.archiveBreakdown.churned} churned`}
        onClick={() => onSelectTab("Archive")}
      />
      <StatBlock
        label="Needs review"
        value={String(counts.needsAttention + counts.needsClassification)}
        hint="flagged at import"
        onClick={() => onSelectTab("All")}
      />
    </section>
  );
}
