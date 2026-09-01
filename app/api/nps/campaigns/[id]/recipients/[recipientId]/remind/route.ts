import { NextResponse } from "next/server";

import { sendManualReminder } from "@/lib/nps/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Ctx {
  params: Promise<{ id: string; recipientId: string }>;
}

// POST /api/nps/campaigns/[id]/recipients/[recipientId]/remind — manual
// single "Remind". Synchronous (one email, fast, immediate UI feedback) and
// never blocked by the automatic cap or the 7-day interval.
export async function POST(_request: Request, ctx: Ctx) {
  const { recipientId } = await ctx.params;
  try {
    const recipient = await sendManualReminder(recipientId);
    return NextResponse.json({ recipient });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
