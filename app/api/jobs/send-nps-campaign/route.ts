// POST /api/jobs/send-nps-campaign
//
// Background job: send every `queued` recipient's invite for one campaign,
// then flip the campaign to `active`. Triggered fire-and-forget by
// POST /api/nps/campaigns/[id]/send.

import { NextResponse } from "next/server";
import { assertJobAuth } from "@/lib/jobs/dispatch";
import { sendCampaignInvites } from "@/lib/nps/campaigns";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = logger("jobs.send-nps-campaign");

export async function POST(request: Request) {
  const authErr = await assertJobAuth(request);
  if (authErr) return authErr;

  let body: { campaignId?: string };
  try {
    body = (await request.json()) as { campaignId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.campaignId) {
    return NextResponse.json({ error: "Missing campaignId in payload." }, { status: 400 });
  }

  try {
    const result = await sendCampaignInvites(body.campaignId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("campaign send failed", { campaignId: body.campaignId, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
