import { NextResponse } from "next/server";

import {
  recordQuickScore,
  SurveyTokenNotFoundError,
  SurveyAlreadySubmittedError,
  InvalidSurveySubmissionError,
} from "@/lib/nps/responses";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ token: string }>;
}

// GET /api/nps/quick/[token]?score=N — the in-email one-click score link.
// Public, no login, works in any email client (plain hyperlink, no JS).
// Stamps quick_score on the recipient as a convenience prefill and 302s to
// the full form — it does NOT create an nps_responses row or mark the
// recipient responded; the form submission is still required.
export async function GET(request: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const url = new URL(request.url);
  const score = Number(url.searchParams.get("score"));

  const respondUrl = new URL(`/nps/respond/${token}`, url.origin);

  try {
    await recordQuickScore(token, score);
  } catch (err) {
    if (err instanceof SurveyAlreadySubmittedError) {
      // Already fully submitted — send them to the same page, which shows
      // the "already submitted" state instead of the form.
      return NextResponse.redirect(respondUrl, { status: 302 });
    }
    if (err instanceof SurveyTokenNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidSurveySubmissionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  respondUrl.searchParams.set("score", String(score));
  return NextResponse.redirect(respondUrl, { status: 302 });
}
