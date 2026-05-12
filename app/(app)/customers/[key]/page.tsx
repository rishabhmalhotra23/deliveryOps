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

import { CustomerHero } from "./_components/customer-hero";
import { StickyStatsRail } from "./_components/sticky-stats-rail";
import { CustomerTabs } from "./_components/customer-tabs";
import { HealthSpotlight } from "./_cards/health-spotlight";
import { ContactsCard } from "./_cards/contacts-card";
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

  const opps = enrichment?.opportunities ?? [];
  const npsResponses = enrichment?.nps ?? [];

  const heroProps = buildHeroProps(
    customer,
    profile,
    allCustomers,
    enrichment?.account?.website ?? null
  );
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
    <div className="min-h-screen">
      {/* Brand Chameleon hero strip */}
      <CustomerHero {...heroProps} />

      {/* Sticky stats bar — client component, shows when hero scrolls out */}
      <StickyStatsRail
        displayName={customer.display_name}
        arrStat={arrStatProps}
        npsStat={npsStatProps}
        projectsStat={projectsStatProps}
        healthScore={healthProps.healthScore}
        renewalDate={heroProps.renewalDate}
      />

      {/* Two-column body */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: tabs (8 cols) */}
          <div className="lg:col-span-8">
            <CustomerTabs
              arrPoints={arrPoints}
              npsTrendPoints={npsTrendPoints}
              opportunitiesCardProps={opportunitiesCardProps}
              projectsCardProps={projectsCardProps}
              npsResponses={npsResponses}
              contacts={profile?.contacts ?? []}
              activityLogProps={activityLogProps}
              eventsTasksProps={eventsTasksProps}
            />
          </div>

          {/* Right rail: sticky (4 cols) */}
          <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-[72px] self-start">
            <HealthSpotlight {...healthProps} />
            <ContactsCard contacts={profile?.contacts ?? []} />
            <EventsTasksCard {...eventsTasksProps} />
            <MetadataCard {...metadataProps} />
          </div>
        </div>
      </div>
    </div>
  );
}
