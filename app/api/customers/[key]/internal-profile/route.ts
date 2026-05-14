import { NextResponse } from "next/server";

import { getInternalProfile, updateInternalProfile } from "@/lib/profile/profile";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  try {
    const internalProfile = await getInternalProfile(key);
    return NextResponse.json({ internalProfile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load internal profile." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  let body: { updates?: Record<string, unknown>; updated_by?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const updates = body.updates ?? {};
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }
  try {
    const internalProfile = await updateInternalProfile(key, updates, {
      updatedBy: body.updated_by ?? "dashboard",
    });
    return NextResponse.json({ internalProfile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update internal profile." },
      { status: 500 }
    );
  }
}
