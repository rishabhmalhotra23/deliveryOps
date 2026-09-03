import { NextResponse } from "next/server";

import { mergeRosterEntries, RosterEntryNotFoundError, InvalidRosterInputError } from "@/lib/roster/store";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/roster/[id]/merge  body: { into: string }
//
// Repoints every alias and every processes.*_id FK from [id] to `into`, then
// deactivates [id]. The cleanup mechanism for whatever the conservative,
// reviewable roster backfill (0033) didn't catch.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let body: { into?: string };
  try {
    body = (await request.json()) as { into?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.into) {
    return NextResponse.json({ error: "into is required." }, { status: 400 });
  }

  try {
    const entry = await mergeRosterEntries(id, body.into);
    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof RosterEntryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidRosterInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
