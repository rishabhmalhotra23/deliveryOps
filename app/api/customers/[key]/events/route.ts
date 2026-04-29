import { NextResponse } from "next/server";

import { appendEvent, listEvents } from "@/lib/events/events";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

export async function GET(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const eventType = url.searchParams.get("event_type") ?? undefined;
  const weekKey = url.searchParams.get("week_key") ?? undefined;

  try {
    const events = await listEvents(key, { limit, eventType, weekKey });
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load events." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  let body: {
    event_type?: string;
    summary?: string;
    details?: Record<string, unknown>;
    tags?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.event_type) {
    return NextResponse.json({ error: "Missing event_type." }, { status: 400 });
  }
  try {
    const event = await appendEvent(key, body.event_type, body.details ?? {}, {
      summary: body.summary,
      tags: body.tags,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to log event." },
      { status: 500 }
    );
  }
}
