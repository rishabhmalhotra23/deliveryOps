import { NextResponse } from "next/server";

import { getProfile, updateProfile } from "@/lib/profile/profile";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  try {
    const profile = await getProfile(key);
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load profile." },
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
    const profile = await updateProfile(key, updates, { updatedBy: body.updated_by ?? "dashboard" });
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update profile." },
      { status: 500 }
    );
  }
}
