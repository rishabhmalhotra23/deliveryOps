import { NextResponse } from "next/server";

import { getRules, updateRules } from "@/lib/rules/rules";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  try {
    const rules = await getRules(key);
    return NextResponse.json({ rules });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load rules." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  let body: { rules?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (typeof body.rules !== "string" || !body.rules.trim()) {
    return NextResponse.json({ error: "Missing or empty rules." }, { status: 400 });
  }
  try {
    const rules = await updateRules(key, body.rules);
    return NextResponse.json({ rules });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update rules." },
      { status: 500 }
    );
  }
}
