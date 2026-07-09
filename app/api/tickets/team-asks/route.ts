import { NextResponse } from "next/server";
import { createTeamAsk } from "@/lib/tickets/team-asks";
import { parseBody, TeamAskCreateSchema } from "@/lib/api/schemas";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
const log = logger("api/tickets/team-asks");

// POST /api/tickets/team-asks — create a team ask, optionally linking one
// or more linear_tickets rows up front. Reads happen via loadTicketsBundle
// on the report page itself (see lib/tickets/loader.ts) — this route only
// handles writes.
export async function POST(request: Request) {
  const parsed = await parseBody(request, TeamAskCreateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const ask = await createTeamAsk(parsed.data);
    return NextResponse.json({ ask }, { status: 201 });
  } catch (err) {
    log.error("Failed to create team ask", errorCtx(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create team ask." },
      { status: 500 }
    );
  }
}
