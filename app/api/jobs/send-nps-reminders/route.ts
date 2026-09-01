// POST /api/jobs/send-nps-reminders
//
// Background job, two modes:
//   { mode: "auto" }                      -- the daily automatic sweep, fired
//                                             once per run-tasks cron tick
//                                             (app/api/cron/run-tasks/route.ts).
//   { mode: "manual", campaignId }        -- "remind all pending" for one
//                                             campaign, fired from
//                                             POST /api/nps/campaigns/[id]/remind-all.

import { NextResponse } from "next/server";
import { assertJobAuth } from "@/lib/jobs/dispatch";
import { sweepAutoReminders, remindAllPending } from "@/lib/nps/reminders";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = logger("jobs.send-nps-reminders");

type Body = { mode: "auto" } | { mode: "manual"; campaignId: string };

export async function POST(request: Request) {
  const authErr = await assertJobAuth(request);
  if (authErr) return authErr;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    if (body.mode === "manual") {
      if (!body.campaignId) {
        return NextResponse.json({ error: "Missing campaignId for manual mode." }, { status: 400 });
      }
      const result = await remindAllPending(body.campaignId);
      return NextResponse.json({ ok: true, mode: "manual", ...result });
    }
    const result = await sweepAutoReminders();
    return NextResponse.json({ ok: true, mode: "auto", ...result });
  } catch (err) {
    log.error("reminder sweep failed", { mode: body.mode, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
