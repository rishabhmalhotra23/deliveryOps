import { NextResponse } from "next/server";
import { getCurrentWorkspace, listProcesses } from "@/lib/integrations/kognitos/v2";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dev/probe/kognitos/workspace
//   ?limit=N  (process count, default 10)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "10"), 1), 50);
  try {
    const [workspace, processes] = await Promise.all([
      getCurrentWorkspace(),
      listProcesses({ limit }).catch((err) => {
        console.warn("[kognitos probe] listProcesses failed:", err);
        return [];
      }),
    ]);
    return NextResponse.json({ workspace, processes, processes_count: processes.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
