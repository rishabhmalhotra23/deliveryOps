import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import { createCampaignFromCsv, listCampaigns } from "@/lib/nps/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Best-effort attribution — see app/api/processes/[id]/route.ts's actor()
// for why a session-lookup failure falls back to "unknown" rather than
// failing the write.
async function actor(): Promise<string> {
  try {
    const session = await auth0.getSession();
    return session?.user?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST multipart/form-data: file (CSV), quarter, and optional template
// overrides. Creates the campaign (draft) + recipient rows (queued) for
// every CSV row that resolved to a real customer_key. No email sent here —
// that only happens via POST /api/nps/campaigns/[id]/send.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field." }, { status: 400 });
  }
  const quarter = String(form.get("quarter") ?? "").trim();
  if (!quarter) return NextResponse.json({ error: "Missing 'quarter' field." }, { status: 400 });

  const csvText = await file.text();
  const who = await actor();

  try {
    const result = await createCampaignFromCsv(
      {
        quarter,
        csvText,
        inviteSubject: optionalField(form, "inviteSubject"),
        inviteBody: optionalField(form, "inviteBody"),
        reminderSubject: optionalField(form, "reminderSubject"),
        reminderBody: optionalField(form, "reminderBody"),
      },
      who
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function optionalField(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}
