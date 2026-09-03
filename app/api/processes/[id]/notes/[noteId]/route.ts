import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { softDeleteProcessNote, ProcessNoteNotFoundError } from "@/lib/processes/notes";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; noteId: string }>;
}

// Best-effort attribution — see app/api/processes/[id]/route.ts.
async function actor(): Promise<string> {
  try {
    const session = await auth0.getSession();
    return session?.user?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

// DELETE /api/processes/[id]/notes/[noteId] — soft delete. Also re-derives
// the notes/blockers mirror, so removing a blocker note lowers its flag.
export async function DELETE(_request: Request, ctx: Ctx) {
  const { noteId } = await ctx.params;
  try {
    const note = await softDeleteProcessNote(noteId, await actor());
    return NextResponse.json({ note });
  } catch (err) {
    if (err instanceof ProcessNoteNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
