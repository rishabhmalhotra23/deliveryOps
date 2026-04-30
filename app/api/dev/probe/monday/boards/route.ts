import { NextResponse } from "next/server";
import { gql, listBoards } from "@/lib/integrations/monday";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dev/probe/monday/boards
//   ?limit=N  (default 25, max 100)
//
// Lists Monday boards the API token can see, plus workspaces (so the
// user can identify whether customers are tracked at the workspace level
// or board level). Includes item counts so a "Customers" board with 50
// rows is easy to spot.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 100);

  try {
    // Boards
    const boards = await listBoards({ limit });

    // Workspaces (separate query — Monday's API exposes them at the top level)
    let workspaces: Array<{ id: string; name: string; kind?: string; description?: string | null }> = [];
    try {
      const wsRes = await gql<{ workspaces: Array<{ id: string; name: string; kind?: string; description?: string | null }> }>(
        `query { workspaces (limit: 25) { id name kind description } }`
      );
      workspaces = wsRes.workspaces ?? [];
    } catch (err) {
      // Workspaces query can fail on accounts without Enterprise — don't crash.
      console.warn("[monday probe] workspaces query failed:", err);
    }

    return NextResponse.json({
      boards,
      workspaces,
      summary: {
        boards_count: boards.length,
        workspaces_count: workspaces.length,
        biggest_board:
          boards.reduce<{ name: string; items_count: number | null } | null>(
            (best, b) => (b.items_count != null && (!best || b.items_count > (best.items_count ?? 0)) ? b : best),
            null
          ),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
