import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { listProcessTickets, attachTicket, detachTicket } from "@/lib/processes/tickets";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// Best-effort attribution — see app/api/processes/[id]/route.ts for why a
// session lookup failure falls back to "unknown" instead of failing the write.
async function actor(): Promise<string> {
  try {
    const session = await auth0.getSession();
    return session?.user?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

// GET /api/processes/[id]/tickets — the process's attached tickets, with
// live title/status from the linear_tickets cache.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const tickets = await listProcessTickets(id);
    return NextResponse.json({ tickets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST /api/processes/[id]/tickets  body: { ticket_id: string }
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let body: { ticket_id?: string };
  try {
    body = (await request.json()) as { ticket_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.ticket_id) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }

  const who = await actor();
  try {
    await attachTicket(id, body.ticket_id, who);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE /api/processes/[id]/tickets?ticket_id=... — detach one ticket.
export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ticketId = new URL(request.url).searchParams.get("ticket_id");
  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id query param is required." }, { status: 400 });
  }

  const who = await actor();
  try {
    await detachTicket(id, ticketId, who);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
