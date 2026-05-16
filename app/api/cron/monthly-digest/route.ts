// GET /api/cron/monthly-digest
//
// Monthly customer digest entrypoint. NOT currently auto-scheduled by Vercel
// because Hobby plan caps cron entries at 2 (daily-sync + run-tasks took
// the slots). Trigger manually with CRON_SECRET when needed:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://<domain>/api/cron/monthly-digest
//
// To restore as a real monthly cron on the 1st at 13:00 UTC, upgrade Vercel
// to Pro and add this entry back to vercel.json:
//   { "path": "/api/cron/monthly-digest", "schedule": "0 13 1 * *" }
//
// Placeholder body — the digest generator lands once Gmail send-as
// aliases are wired (Google Workspace access pending).

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
