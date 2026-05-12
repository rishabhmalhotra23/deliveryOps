import { inngest } from "../client";
import { runFullSync } from "@/lib/sync/runner";

// Salesforce-only sync. Triggered by event "delivery-ops/salesforce.sync.requested"
// with optional { customer_key } payload. Wraps lib/sync/runner.ts so all
// audit logging into sync_runs runs identically to the combined daily sync.
export const syncSalesforce = inngest.createFunction(
  { id: "sync-salesforce", retries: 1 },
  { event: "delivery-ops/salesforce.sync.requested" },
  async ({ event, step }) => {
    const customerKey =
      (event?.data as { customer_key?: string } | undefined)?.customer_key;

    return await step.run("run-salesforce-sync", async () => {
      return await runFullSync({ sources: ["salesforce"], customerKey });
    });
  }
);
