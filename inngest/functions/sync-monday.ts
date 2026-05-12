import { inngest } from "../client";
import { runFullSync } from "@/lib/sync/runner";

// Monday-only sync. Triggered by event "delivery-ops/monday.sync.requested".
// Pulls the Customers/Projects/Activity Log/NPS boards into the monday_*
// cache tables and cascades lifecycle_group / custom_category changes back
// to customers.
export const syncMonday = inngest.createFunction(
  { id: "sync-monday", retries: 1 },
  { event: "delivery-ops/monday.sync.requested" },
  async ({ step }) => {
    return await step.run("run-monday-sync", async () => {
      return await runFullSync({ sources: ["monday"] });
    });
  }
);
