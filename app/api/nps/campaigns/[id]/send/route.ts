import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/types";
import { getCampaignById, NpsCampaignNotFoundError } from "@/lib/nps/campaigns";
import { dispatchJob } from "@/lib/jobs/dispatch";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/nps/campaigns/[id]/send — the explicit "Send" click after the
// preview screen. Requires status === "draft" so a campaign can only ever
// be sent once from this route; flips to "sending" immediately (before the
// job even starts) so a double-click can't fire two send jobs.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const campaign = await getCampaignById(id);
    if (!campaign) return NextResponse.json({ error: "Unknown NPS campaign." }, { status: 404 });
    if (campaign.status !== "draft") {
      return NextResponse.json(
        { error: `Campaign is already '${campaign.status}' — it can only be sent from 'draft'.` },
        { status: 409 }
      );
    }

    const sb = requireAdmin();
    const { error } = await sb.from(TABLES.npsCampaigns).update({ status: "sending" }).eq("id", id);
    if (error) throw error;

    await dispatchJob("send-nps-campaign", { campaignId: id });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    if (err instanceof NpsCampaignNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
