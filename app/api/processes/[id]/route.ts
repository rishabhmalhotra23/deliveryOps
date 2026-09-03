import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import {
  updateProcess,
  markReviewed,
  deleteProcess,
  ProcessNotFoundError,
} from "@/lib/processes/store";
import type { Process } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// Best-effort attribution (see docs/mockups/ia-step-1.5.html panel 3: "whole
// team edits, attribution best-effort"). Falls back to "unknown" rather than
// failing the write — matches middleware.ts's own local-dev-without-Auth0
// tolerance, and a session lookup failing should never block a field save.
async function actor(): Promise<string> {
  try {
    const session = await auth0.getSession();
    return session?.user?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

// PATCH /api/processes/[id]
//   body: { action: "mark-reviewed" } | Partial<Process>
//
// Two distinct writes (see docs/mockups/ia-step-1.5.html panel 3): a field
// edit stamps field_provenance per changed key; "mark reviewed" only touches
// reviewed_at/reviewed_by and is not treated as an edit.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const who = await actor();

  try {
    if (body.action === "mark-reviewed") {
      const process = await markReviewed(id, who);
      return NextResponse.json({ process });
    }
    const process = await updateProcess(id, body as Partial<Process>, who);
    return NextResponse.json({ process });
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

// DELETE /api/processes/[id] — soft delete. The row survives in the
// database; it just stops appearing anywhere until restored.
export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const who = await actor();
  try {
    const process = await deleteProcess(id, who);
    return NextResponse.json({ process });
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

// POST /api/processes/[id]/restore is handled by the sibling route file, not
// here — see app/api/processes/[id]/restore/route.ts.
