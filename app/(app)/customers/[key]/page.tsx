import { notFound } from "next/navigation";

import { getCustomerByKey, listCustomers } from "@/lib/customers";
import { getProfile, getInternalProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";
import { loadCustomerEnrichment } from "@/lib/cache/integrations";

import {
  buildHeroProps,
  buildHealthSpotlightProps,
  buildArrStatProps,
  buildNpsStatProps,
  buildProjectsStatProps,
  buildArrPoints,
  buildNpsTrendPoints,
  buildOpportunitiesCardProps,
  buildProjectsCardProps,
  buildActivityLogCardProps,
  buildEventsTasksCardProps,
  buildMetadataCardProps,
} from "@/lib/customers/view-model";

import { HeroCard } from "./_cards/hero-card";
import { HealthSpotlight } from "./_cards/health-spotlight";
import { ArrStat } from "./_cards/arr-stat";
import { NpsStat } from "./_cards/nps-stat";
import { ProjectsStat } from "./_cards/projects-stat";
import { ArrTrend } from "./_cards/arr-trend";
import { NpsTrend } from "./_cards/nps-trend";
import { OpportunitiesCard } from "./_cards/opportunities-card";
import { ProjectsCard } from "./_cards/projects-card";
import { NpsResponsesCard } from "./_cards/nps-responses-card";
import { ContactsCard } from "./_cards/contacts-card";
import { ActivityLogCard } from "./_cards/activity-log-card";
import { EventsTasksCard } from "./_cards/events-tasks-card";
import { MetadataCard } from "./_cards/metadata-card";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function CustomerPage({ params }: Props) {
  const { key } = await params;

  const customer = await getCustomerByKey(key);
  if (!customer) notFound();

  const [enrichment, profile, internalProfile, events, tasks, allCustomers] = await Promise.all([
    loadCustomerEnrichment(customer.id).catch(() => null),
    getProfile(key).catch(() => null),
    getInternalProfile(key).catch(() => null),
    listEvents(key, { limit: 30 }).catch(() => []),
    listTasks(key).catch(() => []),
    listCustomers().catch(() => []),
  ]);

  // ─── View-model assembly ───────────────────────────────────────────────
  const opps = enrichment?.opportunities ?? [];
  const npsResponses = enrichment?.nps ?? [];

  const heroProps = buildHeroProps(customer, profile, allCustomers);
  const healthProps = buildHealthSpotlightProps(
    customer,
    internalProfile,
    npsResponses,
    enrichment?.account?.owner_name ?? null
  );
  const arrStatProps = buildArrStatProps(opps, profile);
  const npsStatProps = buildNpsStatProps(npsResponses);
  const projectsStatProps = buildProjectsStatProps(enrichment?.projects ?? []);
  const arrPoints = buildArrPoints(opps);
  const npsTrendPoints = buildNpsTrendPoints(npsResponses);
  const opportunitiesCardProps = buildOpportunitiesCardProps(customer, enrichment ?? null);
  const projectsCardProps = buildProjectsCardProps(customer, enrichment ?? null);
  const activityLogProps = buildActivityLogCardProps(customer, enrichment ?? null);
  const eventsTasksProps = buildEventsTasksCardProps(events, tasks);
  const metadataProps = buildMetadataCardProps(customer, profile);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Page eyebrow */}
      <div>
        <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">
          Customer
        </p>
        <h1 className="text-3xl font-display font-semibold tracking-tight mt-1">
          {customer.display_name}
        </h1>
      </div>

      {/* 12-column responsive grid */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Row 1 — Hero context + Health */}
        <HeroCard {...heroProps} className="lg:col-span-8" />
        <HealthSpotlight {...healthProps} className="lg:col-span-4" />

        {/* Row 2 — Top metric tiles */}
        <ArrStat {...arrStatProps} className="lg:col-span-4" />
        <NpsStat {...npsStatProps} className="lg:col-span-4" />
        <ProjectsStat {...projectsStatProps} className="lg:col-span-4" />

        {/* Row 3 — Trend charts (only rendered when there's data to plot) */}
        {arrPoints.length > 0 || npsTrendPoints.length > 0 ? (
          <>
            <ArrTrend data={arrPoints} className="lg:col-span-6" />
            <NpsTrend data={npsTrendPoints} className="lg:col-span-6" />
          </>
        ) : null}

        {/* Row 4 — Commercial detail */}
        <OpportunitiesCard {...opportunitiesCardProps} className="lg:col-span-6" />
        <ProjectsCard {...projectsCardProps} className="lg:col-span-6" />

        {/* Row 5 — Relationship */}
        <NpsResponsesCard responses={npsResponses} className="lg:col-span-6" />
        <ContactsCard
          contacts={profile?.contacts ?? []}
          className="lg:col-span-6"
        />

        {/* Row 6 — Audit (default collapsed — set in each card) */}
        <ActivityLogCard {...activityLogProps} className="lg:col-span-6" />
        <EventsTasksCard {...eventsTasksProps} className="lg:col-span-6" />

        {/* Row 7 — Technical metadata */}
        <MetadataCard {...metadataProps} className="lg:col-span-12" />
      </div>
    </div>
  );
}
