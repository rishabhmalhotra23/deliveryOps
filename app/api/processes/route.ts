import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import {
  createProcess,
  InvalidProcessInputError,
  bulkUpdateProcesses,
  bulkDeleteProcesses,
  TooManyIdsError,
  type CreateProcessInput,
} from "@/lib/processes/store";
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

interface BulkBody {
  ids: string[];
  action?: "delete";
  patch?: Partial<Process>;
}

// PATCH /api/processes — bulk update or bulk delete.
//   body: { ids: string[], action: "delete" }
//   body: { ids: string[], patch: Partial<Process> }
//
// Loops the same single-row primitives every drawer edit uses (see
// lib/processes/store.ts), so bulk behavior never diverges from a one-row
// edit. Response always reports both updated and failed ids — a bad id in
// a large selection doesn't fail the rest.
export async function PATCH(request: Request) {
  let body: BulkBody;
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array." }, { status: 400 });
  }

  const who = await actor();

  try {
    const result =
      body.action === "delete"
        ? await bulkDeleteProcesses(body.ids, who)
        : await bulkUpdateProcesses(body.ids, body.patch ?? {}, who);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TooManyIdsError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
