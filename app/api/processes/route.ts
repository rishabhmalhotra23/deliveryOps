import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { createProcess, InvalidProcessInputError, type CreateProcessInput } from "@/lib/processes/store";

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

// POST /api/processes — create a new process. Always lands with
// migration_stage: not_required (new work isn't migration work by
// definition); everything else is a normal drawer edit after creation.
export async function POST(request: Request) {
  let body: CreateProcessInput;
  try {
    body = (await request.json()) as CreateProcessInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const who = await actor();

  try {
    const process = await createProcess(body, who);
    return NextResponse.json({ process }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidProcessInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
