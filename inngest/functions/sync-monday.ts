import { inngest } from "../client";

// TODO Phase 2: Monday.com GraphQL client — sync customer board into
// monday_items with status / owner / due.
export const syncMonday = inngest.createFunction(
  { id: "sync-monday" },
  { event: "delivery-ops/monday.sync.requested" },
  async ({ step }) => {
    await step.run("noop", async () => ({ synced: 0 }));
    return { ok: true };
  }
);
