import { NextResponse } from "next/server";
import { getBoard, listBoardItems } from "@/lib/integrations/monday";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dev/probe/monday/board/[id]
//   ?limit=N  (default 50, max 500)
//
// Returns the board metadata + the first N items on it. Each item carries
// its column values so we can see the customer's name, status, owner, etc.
interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 500);

  try {
    const [board, items] = await Promise.all([getBoard(id), listBoardItems(id, { limit })]);
    if (!board) {
      return NextResponse.json({ error: "Board not found." }, { status: 404 });
    }
    return NextResponse.json({ board, items, count: items.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
