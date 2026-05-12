import { inngest } from "../client";
import { runFullSync } from "@/lib/sync/runner";

// Kognitos v2 sync. Triggered by event "delivery-ops/kognitos-v2.sync.requested".
// Pulls workspace metadata, processes, and recent run history into the
// k2_workspaces / k2_processes / k2_runs cache tables.
export const syncKognitosV2 = inngest.createFunction(
  { id: "sync-kognitos-v2", retries: 1 },
  { event: "delivery-ops/kognitos-v2.sync.requested" },
  async ({ step }) => {
    return await step.run("run-kognitos-v2-sync", async () => {
      return await runFullSync({ sources: ["kognitos-v2"] });
    });
  }
);
