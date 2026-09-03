import { NextResponse } from "next/server";

import {
  searchRosterEntries,
  createRosterEntry,
  InvalidRosterInputError,
  type CreateRosterEntryInput,
} from "@/lib/roster/store";
import type { RosterKind } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// GET /api/roster?kind=person&role=fde&q=kar — autocomplete/search, backs
// the owner/partner pickers. Matches on alias as well as display name (see
// searchRosterEntries) so old spellings keep resolving.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as RosterKind | null;
  const role = url.searchParams.get("role") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  try {
    const entries = await searchRosterEntries({ kind: kind ?? undefined, role, q, active: true });
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST /api/roster — add a person or partner org directly, rather than only
// ever getting created as a side effect of a free-text process edit.
export async function POST(request: Request) {
  let body: CreateRosterEntryInput;
  try {
    body = (await request.json()) as CreateRosterEntryInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const entry = await createRosterEntry(body);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidRosterInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return NextResponse.json({ error: "A roster entry with that name already exists." }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
