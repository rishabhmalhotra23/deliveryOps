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

// Whitelisted, because this value reaches a column name in an UPDATE. Never
// widen it to an arbitrary string from the body.
const POSITION_FIELDS = ["board_position", "table_position"] as const;
type PositionField = (typeof POSITION_FIELDS)[number];

interface ReorderBody {
  /** Which manual order to write. Defaults to board_position for older
   *  callers; the Delivery table sends table_position. The two are separate
   *  columns because board positions are numbered per lane and so cannot
   *  express a flat table order — see lib/delivery/reorder.ts. */
  field?: string;
  positions: { id: string; position: number }[];
}

// POST /api/processes/reorder — set a manual position on several rows at once.
//
// Distinct from PATCH /api/processes, which applies ONE patch to many ids;
// a reorder needs a different value per row. Normally this carries a single
// row (the dragged row takes the midpoint of its neighbours), and only
// renumbers the whole list when the midpoint can't be expressed — the first
// drag where every position is still null, or a gap that has been halved
// until it ran out of float precision.
export async function POST(request: Request) {
  let body: ReorderBody;
  try {
    body = (await request.json()) as ReorderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const field = (body.field ?? "board_position") as PositionField;
  if (!POSITION_FIELDS.includes(field)) {
    return NextResponse.json(
      { error: `field must be one of: ${POSITION_FIELDS.join(", ")}.` },
      { status: 400 }
    );
  }

  const positions = Array.isArray(body.positions) ? body.positions : [];
  if (positions.length === 0) {
    return NextResponse.json({ error: "positions must be a non-empty array." }, { status: 400 });
  }
  if (positions.some((p) => typeof p?.id !== "string" || !Number.isFinite(p?.position))) {
    return NextResponse.json(
      { error: "Every position needs an id and a finite position." },
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
  const byId = new Map(positions.map((p) => [p.id, p.position]));

  try {
    const result = await bulkApply(Array.from(byId.keys()), (id) =>
      updateProcess(id, { [field]: byId.get(id) } as Partial<Process>, who)
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
