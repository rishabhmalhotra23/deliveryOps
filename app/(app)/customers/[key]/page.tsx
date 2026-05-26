import { notFound } from "next/navigation";

import { getCustomerByKey, listCustomers } from "@/lib/customers";
import { getProfile, getInternalProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";
import { loadCustomerEnrichment } from "@/lib/cache/integrations";
import { loadK2Metrics } from "@/lib/customers/k2-metrics";
import { formatPersonName, isDelivered as txIsDelivered } from "@/lib/delivery/taxonomy";

import {
  buildHeroProps,
  buildAccountSnapshotProps,
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
import { AccountSnapshot } from "./_cards/account-snapshot";
import { ContactsCard } from "./_cards/contacts-card";
import { EventsTasksCard } from "./_cards/events-tasks-card";
import { MetadataCard } from "./_cards/metadata-card";
import { K2MetricsCard } from "./_cards/k2-metrics-card";
import { BackButton } from "@/app/_components/back-button";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function CustomerPage({ params }: Props) {
  const { key } = await params;

  const customer = await getCustomerByKey(key);
  if (!customer) notFound();

  const [enrichment, profile, internalProfile, events, tasks, allCustomers, k2Metrics] = await Promise.all([
    loadCustomerEnrichment(customer.id).catch(() => null),
    getProfile(key).catch(() => null),
    getInternalProfile(key).catch(() => null),
    listEvents(key, { limit: 30 }).catch(() => []),
    listTasks(key).catch(() => []),
    listCustomers().catch(() => []),
    loadK2Metrics(customer.id, customer.kognitos_v2_workspace_id).catch(() => null),
  ]);

  const opps = enrichment?.opportunities ?? [];
  const npsResponses = enrichment?.nps ?? [];

  // FDE roster for the hero — union of every non-delivered project's
  // delivery + engineering columns, canonical-cased + deduped.  Pulled
  // from the same enrichment we already loaded — no extra round-trip.
  const fdeSet = new Set<string>();
  for (const p of enrichment?.projects ?? []) {
    if (txIsDelivered(p.project_status, p.group_title)) continue;
    if (!p.fde) continue;
    for (const piece of p.fde.split(",")) {
      const name = formatPersonName(piece);
      if (name) fdeSet.add(name);
    }
  }
  const customerFdes = Array.from(fdeSet).sort();

  const heroProps = buildHeroProps(
    customer,
    profile,
    allCustomers,
    enrichment?.account?.website ?? null,
    enrichment?.account?.annual_revenue ?? null,
    customerFdes,
  );
  const snapshotProps = buildAccountSnapshotProps(
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
      {/* Back nav */}
      <div className="px-6 pt-4">
        <BackButton href="/customers" label="All customers" />
      </div>
      {/* Brand Chameleon hero strip */}
      <CustomerHero {...heroProps} />

      {/* Sticky stats bar — client component, shows when hero scrolls out */}
      <StickyStatsRail
        displayName={customer.display_name}
        arrStat={arrStatProps}
        npsStat={npsStatProps}
        projectsStat={projectsStatProps}
        renewalDate={heroProps.renewalDate}
      />

      {/* Two-column body */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: tabs (8 cols) */}
          <div className="lg:col-span-8">
            <CustomerTabs
              customerKey={key}
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
            <AccountSnapshot {...snapshotProps} />
            {k2Metrics ? <K2MetricsCard metrics={k2Metrics} /> : null}
            <ContactsCard contacts={profile?.contacts ?? []} />
            <EventsTasksCard {...eventsTasksProps} />
            <MetadataCard {...metadataProps} />
          </div>
        </div>
      </div>
    </div>
  );
}
