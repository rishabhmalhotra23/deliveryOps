import { inngest } from "../client";

// TODO Phase 2: jsforce client + sync sf_accounts / sf_opportunities / sf_cases.
export const syncSalesforce = inngest.createFunction(
  { id: "sync-salesforce" },
  { event: "delivery-ops/salesforce.sync.requested" },
  async ({ step }) => {
    await step.run("noop", async () => ({ synced: 0 }));
    return { ok: true };
  }
);
