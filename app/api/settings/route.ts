import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import {
  listSettings,
  setSetting,
  InvalidSettingError,
  SETTING_DEFAULTS,
} from "@/lib/settings/store";

export const dynamic = "force-dynamic";

async function actor(): Promise<string> {
  try {
    const session = await auth0.getSession();
    return session?.user?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

// GET /api/settings — every tunable, with its description and the compiled
// default, so the UI can show what a value would revert to.
export async function GET() {
  try {
    const settings = await listSettings();
    return NextResponse.json({ settings, defaults: SETTING_DEFAULTS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// PATCH /api/settings — set one tunable. Shape-checked against its compiled
// default in the store, so a number can't become a string that every reader
// then does arithmetic on.
export async function PATCH(request: Request) {
  let body: { key?: string; value?: unknown };
  try {
    body = (await request.json()) as { key?: string; value?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.key) return NextResponse.json({ error: "key is required." }, { status: 400 });

  try {
    const setting = await setSetting(body.key, body.value, await actor());
    return NextResponse.json({ setting });
  } catch (err) {
    if (err instanceof InvalidSettingError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
