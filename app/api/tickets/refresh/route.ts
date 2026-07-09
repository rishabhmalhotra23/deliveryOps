import { NextResponse } from "next/server";
import { syncLinearTickets } from "@/lib/sync/linear-tickets";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = logger("api/tickets/refresh");

// Manual "Refresh" button on the Open Tickets report — pulls raw fields
// from Linear on demand, on top of the daily cron. Never touches
// classification (see lib/sync/linear-tickets.ts).
export async function POST() {
  try {
    const result = await syncLinearTickets();
    const ok = result.errors.length === 0;
    return NextResponse.json(result, { status: ok ? 200 : 207 });
  } catch (err) {
    log.error("Linear tickets refresh failed", errorCtx(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh failed." },
      { status: 500 }
    );
  }
}
