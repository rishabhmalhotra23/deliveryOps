import { NextResponse } from "next/server";

import {
  listRosterAliases,
  addRosterAlias,
  removeRosterAlias,
  RosterEntryNotFoundError,
  InvalidRosterInputError,
} from "@/lib/roster/store";

export const dynamic = "force-dynamic";

// Aliases for one roster entry. `roster_aliases` (0032) is what keeps an old
// spelling resolving on import and in the picker; it was written implicitly on
// create and rename with no way to see, add or remove one, so a wrong alias
// was permanent and silently mis-attributed processes. Backs the Aliases
// section of Configure -> Roster.

function errorResponse(err: unknown) {
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

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ aliases: await listRosterAliases(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { alias?: unknown };
  try {
    body = (await request.json()) as { alias?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (typeof body.alias !== "string") {
    return NextResponse.json({ error: "alias must be a string." }, { status: 400 });
  }
  try {
    return NextResponse.json({ aliases: await addRosterAlias(id, body.alias) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const alias = new URL(request.url).searchParams.get("alias");
  if (!alias) {
    return NextResponse.json({ error: "alias query parameter is required." }, { status: 400 });
  }
  try {
    return NextResponse.json({ aliases: await removeRosterAlias(id, alias) });
  } catch (err) {
    return errorResponse(err);
  }
}
