import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { listProcessNotes, addProcessNote } from "@/lib/processes/notes";
import { ProcessNotFoundError } from "@/lib/processes/store";
import type { ProcessNoteKind } from "@/lib/supabase/types";

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

// GET /api/processes/[id]/notes — the activity feed, newest first.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const notes = await listProcessNotes(id);
    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST /api/processes/[id]/notes  body: { body: string, kind?: "note" | "blocker" }
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let body: { body?: string; kind?: ProcessNoteKind };
  try {
    body = (await request.json()) as { body?: string; kind?: ProcessNoteKind };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.body || !body.body.trim()) {
    return NextResponse.json({ error: "body is required." }, { status: 400 });
  }

  const who = await actor();

  try {
    const note = await addProcessNote(id, body.body, body.kind ?? "note", who);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
