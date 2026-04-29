import { NextResponse } from "next/server";

import { listDueTasks, cronIsDue } from "@/lib/tasks/tasks";
import { inngest } from "@/inngest/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron entrypoint. Configure in vercel.json:
//   { "crons": [{ "path": "/api/cron/run-tasks", "schedule": "* * * * *" }] }
//
// Vercel sends an "Authorization: Bearer <CRON_SECRET>" header (or the URL
// is hit by Vercel's internal IP). We accept either ?token=… for manual
// trigger during dev (gated on CRON_SECRET).
export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const auth = request.headers.get("authorization");
    const url = new URL(request.url);
    const tokenOk = auth === `Bearer ${expectedSecret}` || url.searchParams.get("token") === expectedSecret;
    if (!tokenOk) {
      return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 500 });
  }

  const now = new Date();

  // 1. Due once + recurring tasks (next_run <= now).
  const due = await listDueTasks(now);

  // 2. Cron tasks: next_run is null (we don't compute next_run for cron — see
  //    lib/tasks/tasks.ts::computeNextRun). Enumerate active cron tasks and
  //    filter by cronIsDue on this minute.
  const { requireAdmin } = await import("@/lib/supabase/server");
  const sb = requireAdmin();
  const { data: cronTasks } = await sb
    .from("tasks")
    .select("*")
    .eq("status", "active")
    .is("deleted_at", null)
    .filter("schedule->>type", "eq", "cron");

  const cronDue = ((cronTasks as Array<typeof due[number]>) ?? []).filter((t) =>
    cronIsDue(t.schedule.cron ?? "", now)
  );

  const allDue = [...due, ...cronDue];
  let dispatched = 0;

  for (const task of allDue) {
    try {
      await inngest.send({ name: "delivery-ops/task.run", data: task });
      dispatched++;
    } catch (err) {
      console.warn("[cron] failed to dispatch task %s:", task.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    candidates: allDue.length,
    dispatched,
  });
}
