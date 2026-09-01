"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NpsCampaign } from "@/lib/supabase/types";
import { NewCampaignModal } from "./_components/new-campaign-modal";

interface CampaignWithCounts {
  campaign: NpsCampaign;
  counts: { total: number; queued: number; sent: number; responded: number; failed: number };
}

const STATUS_LABEL: Record<NpsCampaign["status"], string> = {
  draft: "Draft",
  sending: "Sending…",
  active: "Active",
  closed: "Closed",
};

export function NpsClient({ campaigns }: { campaigns: CampaignWithCounts[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-[color:var(--muted-foreground)]">
          {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="btn-primary rounded-full px-4 py-2 text-sm font-semibold"
        >
          New campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-6 text-sm text-[color:var(--muted-foreground)]">
          No NPS campaigns yet — click &quot;New campaign&quot; to upload a recipient list.
        </div>
      ) : (
        <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 overflow-hidden">
          <div className="overflow-x-auto p-2 dark:p-2.5">
            <table className="w-full text-sm dark:border-separate dark:[border-spacing:0_4px]">
              <thead className="bg-[var(--glass-bg)] dark:bg-transparent text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Quarter</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Status</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Recipients</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Sent</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Responded</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(({ campaign, counts }) => {
                  const td = "dark:bg-[color:var(--surface-2)]";
                  return (
                    <tr
                      key={campaign.id}
                      className="border-t border-[var(--glass-border)] dark:border-0 hover:bg-[var(--glass-bg)] dark:hover:[&>td]:brightness-125 transition-colors cursor-pointer"
                      onClick={() => router.push(`/nps/campaigns/${campaign.id}`)}
                    >
                      <td className={`px-3 py-2 font-medium text-[color:var(--foreground)] dark:rounded-l-lg ${td}`}>
                        {campaign.quarter}
                      </td>
                      <td className={`px-3 py-2 ${td}`}>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)]">
                          {STATUS_LABEL[campaign.status]}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${td}`}>{counts.total}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${td}`}>{counts.sent}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${td}`}>{counts.responded}</td>
                      <td className={`px-3 py-2 text-right tabular-nums dark:rounded-r-lg ${td}`}>{counts.failed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? (
        <NewCampaignModal
          onClose={() => setCreating(false)}
          onContinue={(campaignId) => {
            setCreating(false);
            router.push(`/nps/campaigns/${campaignId}`);
          }}
        />
      ) : null}
    </div>
  );
}
