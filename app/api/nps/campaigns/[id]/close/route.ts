import { NextResponse } from "next/server";

import { closeCampaign, NpsCampaignNotFoundError } from "@/lib/nps/campaigns";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/nps/campaigns/[id]/close — winds a campaign down. Excludes it
// from the automatic reminder sweep (which only considers status='active')
// but leaves manual "remind" and the queue view open.
export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const campaign = await closeCampaign(id);
    return NextResponse.json({ campaign });
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
