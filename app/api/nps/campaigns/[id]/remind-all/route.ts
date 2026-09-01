import { NextResponse } from "next/server";

import { dispatchJob } from "@/lib/jobs/dispatch";
import { getCampaignById } from "@/lib/nps/campaigns";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/nps/campaigns/[id]/remind-all — manual "remind all pending".
// Dispatched as a job (not synchronous) since a campaign can have up to
// 1000 recipients; ignores the automatic cap/interval entirely.
export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const campaign = await getCampaignById(id);
    if (!campaign) return NextResponse.json({ error: "Unknown NPS campaign." }, { status: 404 });

    await dispatchJob("send-nps-reminders", { mode: "manual", campaignId: id });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
