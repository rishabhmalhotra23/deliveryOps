import { inngest } from "../client";

// TODO Phase 2: Kognitos v2 client (Bearer kgn_pat_, /api/v1/...) — sync
// k2_workspaces / k2_processes / k2_runs.
export const syncKognitosV2 = inngest.createFunction(
  { id: "sync-kognitos-v2" },
  { event: "delivery-ops/kognitos-v2.sync.requested" },
  async ({ step }) => {
    await step.run("noop", async () => ({ synced: 0 }));
    return { ok: true };
  }
);
