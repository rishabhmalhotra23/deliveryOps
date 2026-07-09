import { NextResponse } from "next/server";

import { runFullSync } from "@/lib/sync/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — covers ~40 customers across SF + Monday + K2.

// Daily sync entrypoint — pulls the latest from every Phase 2 integration
// (Salesforce + Monday + Kognitos v2 + Linear tickets) into the *_cache
// tables. Wired to Vercel Cron at 02:30 UTC = 08:00 IST every day (see
// vercel.json).
//
// Auth model (mirrors /api/cron/run-tasks):
//   - In production, Vercel sets `Authorization: Bearer <CRON_SECRET>`. We
//     also accept `?token=<CRON_SECRET>` so this can be triggered manually
//     during incident response without curl-with-headers gymnastics.
//   - If CRON_SECRET is unset, we allow unauthenticated invocations only
//     outside of production — convenient for local dev.
//   - In production with CRON_SECRET unset we 500 loudly to avoid
//     accidentally leaving the endpoint open.
//
// Per-source failures don't abort the rest of the run: the runner collects
// errors per source, surfaces them in the JSON response, and flips the
// HTTP status to 207 (multi-status). Vercel still considers the cron
// "succeeded" because the function returns — that's intentional. Retry
// semantics live in the runner itself; cron just kicks the work off.
export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const auth = request.headers.get("authorization");
    const url = new URL(request.url);
    const tokenOk =
      auth === `Bearer ${expectedSecret}` ||
      url.searchParams.get("token") === expectedSecret;
    if (!tokenOk) {
      return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET not configured." },
      { status: 500 }
    );
  }

  const startedAt = new Date().toISOString();
  const result = await runFullSync({
    sources: ["salesforce", "monday", "kognitos-v2", "linear-tickets"],
  });

  return NextResponse.json(
    {
      ok: result.ok,
      started_at: startedAt,
      duration_ms: result.duration_ms,
      salesforce: result.salesforce ?? null,
      monday: result.monday ?? null,
      kognitos_v2: result.kognitos_v2 ?? null,
      linear_tickets: result.linear_tickets ?? null,
      errors: result.errors,
    },
    { status: result.ok ? 200 : 207 }
  );
}
