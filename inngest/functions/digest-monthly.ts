import { inngest } from "../client";

// TODO Phase 2: build the monthly digest — pull last-30-days events + K2 metrics
// + SF activity + Monday status, generate via Claude with brand-voice prompt,
// render MJML email, post draft to customer Slack for CSM approval before send.
export const digestMonthly = inngest.createFunction(
  { id: "digest-monthly" },
  { cron: "0 13 1 * *" }, // first of every month, 13:00 UTC — placeholder
  async ({ step }) => {
    await step.run("noop", async () => ({ generated: 0 }));
    return { ok: true };
  }
);
