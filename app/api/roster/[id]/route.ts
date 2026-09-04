import { NextResponse } from "next/server";

import {
  updateRosterEntry,
  renameRosterEntry,
  getRosterEntry,
  RosterEntryNotFoundError,
  InvalidRosterInputError,
  type UpdateRosterEntryInput,
} from "@/lib/roster/store";
import { ROSTER_ROLES } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface PatchBody extends UpdateRosterEntryInput {
  display_name?: string;
}

// PATCH /api/roster/[id] — rename, change roles, or mark someone as having
// left. Backs the Configure -> Roster tab's inline editor.
//
// A rename is dispatched to renameRosterEntry rather than folded into the
// column write: it also has to rewrite the denormalized owner text on every
// process pointing at this entry, in one transaction, without disturbing
// updated_at. See lib/roster/store.ts and migration 0038.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (body.roles !== undefined) {
    if (!Array.isArray(body.roles)) {
      return NextResponse.json({ error: "roles must be an array." }, { status: 400 });
    }
    const unknown = body.roles.filter((r) => !ROSTER_ROLES.includes(r as never));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown role(s): ${unknown.join(", ")}. Valid roles: ${ROSTER_ROLES.join(", ")}.` },
        { status: 400 }
      );
    }
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active must be a boolean." }, { status: 400 });
  }

  try {
    let processesRelabelled = 0;
    const before = await getRosterEntry(id);
    if (!before) throw new RosterEntryNotFoundError(id);

    // Rename first: the roles/active write re-reads nothing, but doing the
    // transactional half up front means a failure there leaves the entry
    // entirely untouched rather than half-applied.
    if (body.display_name !== undefined && body.display_name.trim() !== before.display_name) {
      ({ processesRelabelled } = await renameRosterEntry(id, body.display_name));
    }

    const entry = await updateRosterEntry(id, { roles: body.roles, active: body.active });
    return NextResponse.json({ entry, processesRelabelled });
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
