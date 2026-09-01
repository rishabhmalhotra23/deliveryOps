import { NextResponse } from "next/server";

import { getCampaignById, listRecipients, updateCampaignTemplate, NpsCampaignNotFoundError } from "@/lib/nps/campaigns";
import type { NpsCampaign } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const campaign = await getCampaignById(id);
    if (!campaign) return NextResponse.json({ error: "Unknown NPS campaign." }, { status: 404 });
    const recipients = await listRecipients(id);
    return NextResponse.json({ campaign, recipients });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// PATCH { invite_subject?, invite_body?, reminder_subject?, reminder_body? }
// Draft-only — see updateCampaignTemplate.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: Partial<NpsCampaign>;
  try {
    body = (await request.json()) as Partial<NpsCampaign>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const campaign = await updateCampaignTemplate(id, body);
    return NextResponse.json({ campaign });
  } catch (err) {
    if (err instanceof NpsCampaignNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
