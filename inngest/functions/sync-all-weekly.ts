import { inngest } from "../client";
import { runFullSync, type SyncSource } from "@/lib/sync/runner";

// On-demand combined sync — the union of every Phase 2 integration:
// Salesforce + Monday + Kognitos v2. Triggered by sending an event of name
// "delivery-ops/sync.requested" with optional
// { sources: [...], customer_key }. Each individual sync respects
// deliveryops_protected_fields, so manual edits via the operations chat
// are preserved.
//
// Production schedule is owned by the daily Vercel Cron at
// /api/cron/daily-sync (08:00 IST). The legacy Sunday 03:00 UTC trigger is
// retained as a belt-and-braces fallback — if Vercel Cron ever goes silent
// (paused project, billing issue, deploy in flight), Inngest keeps the
// cache from going stale beyond a week.
export const syncAllWeekly = inngest.createFunction(
  { id: "sync-all-weekly", retries: 1 },
  [
    { cron: "TZ=UTC 0 3 * * 0" }, // Sunday 03:00 UTC (fallback)
    { event: "delivery-ops/sync.requested" },
  ],
  async ({ event, step }) => {
    const sources =
      (event?.data as { sources?: SyncSource[] } | undefined)?.sources ??
      (["salesforce", "monday", "kognitos-v2"] as SyncSource[]);
    const customerKey = (event?.data as { customer_key?: string } | undefined)?.customer_key;

    return await step.run("run-full-sync", async () => {
      return await runFullSync({ sources, customerKey });
    });
  }
);
