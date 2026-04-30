import { inngest } from "../client";
import { runFullSync } from "@/lib/sync/runner";

// Weekly sync — every Sunday at 03:00 UTC. Refreshes the Salesforce +
// Monday cache so the dashboard stays accurate without anyone clicking
// /dev/sync. Each individual sync respects deliveryops_protected_fields,
// so manual edits via the operations chat are preserved.
//
// Trigger an out-of-cycle run by sending an event of name
// "delivery-ops/sync.requested" with optional { sources: [...], customer_key }.
export const syncAllWeekly = inngest.createFunction(
  { id: "sync-all-weekly", retries: 1 },
  [
    { cron: "TZ=UTC 0 3 * * 0" }, // Sunday 03:00 UTC
    { event: "delivery-ops/sync.requested" },
  ],
  async ({ event, step }) => {
    const sources =
      (event?.data as { sources?: Array<"salesforce" | "monday"> } | undefined)?.sources ??
      ["salesforce", "monday"];
    const customerKey = (event?.data as { customer_key?: string } | undefined)?.customer_key;

    return await step.run("run-full-sync", async () => {
      return await runFullSync({ sources, customerKey });
    });
  }
);
