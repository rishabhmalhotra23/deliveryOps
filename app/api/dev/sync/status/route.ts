import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/dev/sync/status — last 20 sync runs across all sources, plus
// per-source row counts in the cache tables. Used by the dev console + the
// dashboard to show "synced X minutes ago".
export async function GET() {
  const sb = requireAdmin();

  const [runs, sf, opps, cases, projects, activities, nps] = await Promise.all([
    sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(20),
    sb.from("sf_accounts").select("id", { count: "exact", head: true }),
    sb.from("sf_opportunities").select("id", { count: "exact", head: true }),
    sb.from("sf_cases").select("id", { count: "exact", head: true }),
    sb.from("monday_projects").select("id", { count: "exact", head: true }),
    sb.from("monday_activities").select("id", { count: "exact", head: true }),
    sb.from("monday_nps_responses").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    runs: runs.data ?? [],
    counts: {
      sf_accounts: sf.count ?? 0,
      sf_opportunities: opps.count ?? 0,
      sf_cases: cases.count ?? 0,
      monday_projects: projects.count ?? 0,
      monday_activities: activities.count ?? 0,
      monday_nps_responses: nps.count ?? 0,
    },
  });
}
