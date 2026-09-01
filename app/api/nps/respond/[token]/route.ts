import { NextResponse } from "next/server";

import {
  submitNpsResponse,
  SurveyTokenNotFoundError,
  SurveyAlreadySubmittedError,
  InvalidSurveySubmissionError,
} from "@/lib/nps/responses";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Ctx {
  params: Promise<{ token: string }>;
}

// POST /api/nps/respond/[token] — public, no login. survey_token is the
// sole authentication (see middleware.ts PUBLIC_PREFIXES).
export async function POST(request: Request, ctx: Ctx) {
  const { token } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const response = await submitNpsResponse(token, body);
    return NextResponse.json({ ok: true, response }, { status: 201 });
  } catch (err) {
    if (err instanceof SurveyTokenNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof SurveyAlreadySubmittedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof InvalidSurveySubmissionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
