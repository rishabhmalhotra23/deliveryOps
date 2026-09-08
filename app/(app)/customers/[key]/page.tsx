import { notFound } from "next/navigation";

import { getCustomerByKey, listCustomers } from "@/lib/customers";
import { getProfile, getInternalProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";
import { loadCustomerEnrichment } from "@/lib/cache/integrations";
import { loadK2Metrics } from "@/lib/customers/k2-metrics";
import { formatPersonName, isDelivered as txIsDelivered } from "@/lib/delivery/taxonomy";

import { loadOverrideMap, listOverrides } from "@/lib/overrides/store";
import { CustomerRecordCard } from "./_components/customer-record-card";
import type { OverrideInfo } from "@/app/_components/editable-value";
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
  const arrOverrides = (await loadOverrideMap("confirmed_arr")) as Record<string, number>;

  // Every live correction for THIS customer, keyed by field, so the record
  // card can show provenance ("Salesforce still says $689,000") rather than
  // just the corrected number.
  const overridesByField: Record<string, OverrideInfo> = {};
  for (const o of await listOverrides("customer")) {
    if (o.entity_id !== customer.id) continue;
    overridesByField[o.field] = {
      value: o.value,
      synced_value: o.synced_value,
      reason: o.reason,
      set_by: o.set_by,
      set_at: o.set_at,
    };
  }
  const arrStatProps = buildArrStatProps(opps, profile, customer.key, arrOverrides);
  const npsStatProps = buildNpsStatProps(npsResponses);
  const projectsStatProps = buildProjectsStatProps(enrichment?.projects ?? []);
  const arrPoints = buildArrPoints(opps);
  const npsTrendPoints = buildNpsTrendPoints(npsResponses);
  const opportunitiesCardProps = buildOpportunitiesCardProps(customer, enrichment ?? null);
  const projectsCardProps = buildProjectsCardProps(customer, enrichment ?? null);
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
              eventsTasksProps={eventsTasksProps}
            />
          </div>

          {/* Right rail: sticky (4 cols) */}
          <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-[72px] self-start">
            {/* First in the rail: it's the only card here that accepts input,
                and the 360 previously had no editing at all. */}
            <CustomerRecordCard
              customerKey={key}
              customerId={customer.id}
              displayName={customer.display_name}
              category={customer.custom_category}
              aeOwner={customer.ae_owner}
              partner={customer.partner}
              active={customer.active}
              arr={arrStatProps.currentArr}
              renewalDate={heroProps.renewalDate}
              salesforceAccountId={customer.salesforce_account_id}
              slackChannel={customer.slack_channel}
              industry={profile?.industry ?? null}
              tier={profile?.tier ?? null}
              headquarters={profile?.headquarters ?? null}
              overrides={overridesByField}
            />
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
