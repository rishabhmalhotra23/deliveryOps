import { notFound } from "next/navigation";

import { BackButton } from "@/app/_components/back-button";
import { PageHeader } from "@/app/_components/brand";
import { DevOutboxBanner } from "@/app/_components/dev-outbox-banner";
import { getCampaignById, listRecipients } from "@/lib/nps/campaigns";
import { listCustomers } from "@/lib/customers";
import { NpsCampaignClient } from "./nps-campaign-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NpsCampaignPage({ params }: Props) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  const [recipients, customers] = await Promise.all([listRecipients(id), listCustomers()]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const recipientRows = recipients.map((r) => ({
    ...r,
    customer_display_name: customerById.get(r.customer_id)?.display_name ?? "Unknown customer",
  }));

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/nps" label="NPS campaigns" />
      <PageHeader
        eyebrow={`NPS · ${campaign.quarter}`}
        title={campaign.quarter}
        subtitle="Preview recipients and templates, then send. Reminders fire automatically weekly (up to 3) once active."
      />
      <DevOutboxBanner />
      <NpsCampaignClient campaign={campaign} recipients={recipientRows} />
    </div>
  );
}
