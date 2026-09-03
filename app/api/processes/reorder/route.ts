import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { bulkApply, updateProcess, MAX_BULK_IDS, TooManyIdsError } from "@/lib/processes/store";
import type { Process } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

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

interface ReorderBody {
  positions: { id: string; board_position: number }[];
}

// POST /api/processes/reorder — set board_position on several rows at once.
//
// Distinct from PATCH /api/processes, which applies ONE patch to many ids;
// a reorder needs a different value per row. Normally this carries a single
// row (the dragged card takes the midpoint of its neighbours), and only
// renumbers a whole lane when the midpoint can't be expressed — the first
// drag in a lane where every position is still null, or a gap that has been
// halved until it ran out of float precision.
export async function POST(request: Request) {
  let body: ReorderBody;
  try {
    body = (await request.json()) as ReorderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const positions = Array.isArray(body.positions) ? body.positions : [];
  if (positions.length === 0) {
    return NextResponse.json({ error: "positions must be a non-empty array." }, { status: 400 });
  }
  if (positions.some((p) => typeof p?.id !== "string" || !Number.isFinite(p?.board_position))) {
    return NextResponse.json(
      { error: "Every position needs an id and a finite board_position." },
      { status: 400 }
    );
  }
  if (positions.length > MAX_BULK_IDS) {
    return NextResponse.json(
      { error: new TooManyIdsError(positions.length).message },
      { status: 400 }
    );
  }

  const who = await actor();
  const byId = new Map(positions.map((p) => [p.id, p.board_position]));

  try {
    const result = await bulkApply(Array.from(byId.keys()), (id) =>
      updateProcess(id, { board_position: byId.get(id) } as Partial<Process>, who)
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
