import { NextResponse } from "next/server";
import { updateTeamAsk, deleteTeamAsk } from "@/lib/tickets/team-asks";
import { parseBody, TeamAskUpdateSchema } from "@/lib/api/schemas";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
const log = logger("api/tickets/team-asks/[id]");

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, TeamAskUpdateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const ask = await updateTeamAsk(id, parsed.data);
    return NextResponse.json({ ask });
  } catch (err) {
    log.error("Failed to update team ask", { id, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update team ask." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    await deleteTeamAsk(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("Failed to delete team ask", { id, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete team ask." },
      { status: 500 }
    );
  }
}
