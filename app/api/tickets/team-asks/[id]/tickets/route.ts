import { NextResponse } from "next/server";
import { linkTickets, unlinkTicket } from "@/lib/tickets/team-asks";
import { parseBody, TeamAskLinkTicketSchema } from "@/lib/api/schemas";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
const log = logger("api/tickets/team-asks/[id]/tickets");

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST — link a linear_tickets row to this ask.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, TeamAskLinkTicketSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await linkTickets(id, [parsed.data.ticket_id]);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    log.error("Failed to link ticket to ask", { id, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to link ticket." },
      { status: 500 }
    );
  }
}

// DELETE — unlink a ticket (ticket_id passed as a query param).
export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ticketId = new URL(request.url).searchParams.get("ticket_id");
  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id query param is required." }, { status: 400 });
  }
  try {
    await unlinkTicket(id, ticketId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("Failed to unlink ticket from ask", { id, ticketId, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to unlink ticket." },
      { status: 500 }
    );
  }
}
