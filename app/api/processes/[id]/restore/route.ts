import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { restoreProcess, ProcessNotFoundError } from "@/lib/processes/store";

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

// POST /api/processes/[id]/restore — undo a soft delete.
export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const who = await actor();
  try {
    const process = await restoreProcess(id, who);
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
