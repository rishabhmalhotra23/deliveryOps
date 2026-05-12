"use client";

import { useState } from "react";
import { ArrTrend } from "../_cards/arr-trend";
import { NpsTrend } from "../_cards/nps-trend";
import { OpportunitiesCard } from "../_cards/opportunities-card";
import { ProjectsCard } from "../_cards/projects-card";
import { NpsResponsesCard } from "../_cards/nps-responses-card";
import { ActivityLogCard } from "../_cards/activity-log-card";
import type {
  ArrPoint,
  NpsTrendPoint,
  OpportunitiesCardProps,
  ProjectsCardProps,
  ActivityLogCardProps,
  EventsTasksCardProps,
  NpsResponsesCardProps,
} from "@/lib/customers/view-model";
import type { ContactRow } from "@/lib/supabase/types";

type NpsResponse = NpsResponsesCardProps["responses"][number];

const TABS = ["Overview", "Projects", "NPS", "Activity"] as const;
type Tab = (typeof TABS)[number];

interface CustomerTabsProps {
  arrPoints: ArrPoint[];
  npsTrendPoints: NpsTrendPoint[];
  opportunitiesCardProps: OpportunitiesCardProps;
  projectsCardProps: ProjectsCardProps;
  npsResponses: NpsResponse[];
  contacts: ContactRow[];
  activityLogProps: ActivityLogCardProps;
  eventsTasksProps: EventsTasksCardProps;
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm tracking-tight font-medium rounded-md transition-all ${
        active
          ? "bg-[rgba(242,255,112,0.12)] text-[color:var(--foreground)] border border-[rgba(242,255,112,0.25)]"
          : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
      }`}
    >
      {label}
    </button>
  );
}

export function CustomerTabs({
  arrPoints,
  npsTrendPoints,
  opportunitiesCardProps,
  projectsCardProps,
  npsResponses,
  activityLogProps,
  eventsTasksProps,
}: CustomerTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 rounded-lg glass-card w-fit">
        {TABS.map((tab) => (
          <TabButton
            key={tab}
            label={tab}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>

      {/* Tab content */}
      <div className="transition-opacity duration-150">
        {activeTab === "Overview" && (
          <div className="space-y-4">
            {arrPoints.length > 0 && (
              <ArrTrend data={arrPoints} className="glass-card-hover" />
            )}
            {npsTrendPoints.length > 0 && (
              <NpsTrend data={npsTrendPoints} className="glass-card-hover" />
            )}
            <OpportunitiesCard {...opportunitiesCardProps} className="glass-card-hover" />
          </div>
        )}

        {activeTab === "Projects" && (
          <ProjectsCard {...projectsCardProps} className="glass-card-hover" />
        )}

        {activeTab === "NPS" && (
          <NpsResponsesCard responses={npsResponses} className="glass-card-hover" />
        )}

        {activeTab === "Activity" && (
          <ActivityLogCard {...activityLogProps} className="glass-card-hover" />
        )}
      </div>
    </div>
  );
}
