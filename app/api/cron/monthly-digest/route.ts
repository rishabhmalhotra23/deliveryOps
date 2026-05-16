// GET /api/cron/monthly-digest
//
// Monthly customer digest entrypoint. Vercel cron fires this on the 1st of
// each month at 13:00 UTC. Same auth pattern as the other cron routes.
//
// Placeholder for now — the digest generator lands once Gmail send-as
// aliases are wired (Google Workspace access pending). The route stays
// active so the cron entry in vercel.json validates and metrics are
// recorded.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = logger("cron.monthly-digest");

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    const url = new URL(request.url);
    const ok = auth === `Bearer ${expected}` || url.searchParams.get("token") === expected;
    if (!ok) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 500 });
  }

  log.info("monthly digest tick — generator not yet implemented");
  return NextResponse.json({
    ok: true,
    generated: 0,
    note: "Monthly digest generator pending — Gmail send-as aliases required.",
  });
}
