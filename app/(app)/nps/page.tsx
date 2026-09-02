import { BackButton } from "@/app/_components/back-button";
import { PageHeader } from "@/app/_components/brand";
import { DevOutboxBanner } from "@/app/_components/dev-outbox-banner";
import { listCampaigns, listRecipients } from "@/lib/nps/campaigns";
import { loadNpsHistory } from "@/lib/nps/history";
import { NpsClient } from "./nps-client";
import { ScoreHistory } from "./_components/score-history";

export const dynamic = "force-dynamic";

export default async function NpsPage() {
  const [campaigns, history] = await Promise.all([listCampaigns(), loadNpsHistory()]);
  const withCounts = await Promise.all(
    campaigns.map(async (campaign) => {
      const recipients = await listRecipients(campaign.id);
      return {
        campaign,
        counts: {
          total: recipients.length,
          queued: recipients.filter((r) => r.status === "queued").length,
          sent: recipients.filter((r) => r.status === "sent").length,
          responded: recipients.filter((r) => r.status === "responded").length,
          failed: recipients.filter((r) => r.status === "failed").length,
        },
      };
    })
  );

  return (
    <div className="px-6 lg:px-8 py-8 max-w-[1600px] mx-auto space-y-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <PageHeader
        eyebrow="NPS"
        title="Quarterly NPS campaigns."
        subtitle="Upload a recipient list, send the survey, and track responses and reminders per quarter."
      />
      <DevOutboxBanner />
      <ScoreHistory history={history} />
      <NpsClient campaigns={withCounts} />
    </div>
  );
}
