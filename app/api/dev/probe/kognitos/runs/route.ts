import { NextResponse } from "next/server";
import { listRuns } from "@/lib/integrations/kognitos/v2";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dev/probe/kognitos/runs
//   ?limit=N (default 25, max 100)
//   ?process_id=...  (optional — scope to a single process)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 100);
  const processId = url.searchParams.get("process_id") ?? undefined;
  try {
    const runs = await listRuns({ limit, processId });
    return NextResponse.json({ runs, count: runs.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
