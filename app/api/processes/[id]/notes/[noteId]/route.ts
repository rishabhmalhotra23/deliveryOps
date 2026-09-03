import { NextResponse } from "next/server";

import { softDeleteProcessNote, ProcessNoteNotFoundError } from "@/lib/processes/notes";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; noteId: string }>;
}

// DELETE /api/processes/[id]/notes/[noteId] — soft delete.
export async function DELETE(_request: Request, ctx: Ctx) {
  const { noteId } = await ctx.params;
  try {
    const note = await softDeleteProcessNote(noteId);
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
