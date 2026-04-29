import { inngest } from "../client";

// TODO Phase 2: Google Calendar sync — 30-day window, populate gcal_events,
// auto-create QBR follow-up tasks 2 days after meetings tagged "QBR".
export const syncCalendar = inngest.createFunction(
  { id: "sync-calendar" },
  { event: "delivery-ops/calendar.sync.requested" },
  async ({ step }) => {
    await step.run("noop", async () => ({ synced: 0 }));
    return { ok: true };
  }
);
