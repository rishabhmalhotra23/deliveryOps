import { describe, it, expect } from "vitest";
import { isDueForAutoReminder, type ReminderDueInput } from "@/lib/nps/reminders";

const DAY = 86_400_000;
const now = new Date("2026-09-01T00:00:00Z");

function recipient(overrides: Partial<ReminderDueInput> = {}): ReminderDueInput {
  return {
    status: "sent",
    reminder_count: 0,
    sent_at: new Date(now.getTime() - 8 * DAY).toISOString(),
    last_reminder_at: null,
    ...overrides,
  };
}

describe("isDueForAutoReminder", () => {
  it("is not due before 7 days have passed", () => {
    const r = recipient({ sent_at: new Date(now.getTime() - 3 * DAY).toISOString() });
    expect(isDueForAutoReminder(r, now)).toBe(false);
  });

  it("is due at exactly 7 days", () => {
    const r = recipient({ sent_at: new Date(now.getTime() - 7 * DAY).toISOString() });
    expect(isDueForAutoReminder(r, now)).toBe(true);
  });

  it("is due well past 7 days", () => {
    expect(isDueForAutoReminder(recipient(), now)).toBe(true);
  });

  it("is blocked once reminder_count reaches the cap", () => {
    const r = recipient({ reminder_count: 3 });
    expect(isDueForAutoReminder(r, now)).toBe(false);
  });

  it("is never due for a recipient that hasn't been sent the initial invite yet", () => {
    const r = recipient({ status: "queued", sent_at: null });
    expect(isDueForAutoReminder(r, now)).toBe(false);
  });

  it("is never due once the recipient has responded", () => {
    const r = recipient({ status: "responded" });
    expect(isDueForAutoReminder(r, now)).toBe(false);
  });

  it("is never due for a failed send", () => {
    const r = recipient({ status: "failed" });
    expect(isDueForAutoReminder(r, now)).toBe(false);
  });

  it("uses last_reminder_at over sent_at once a reminder has already gone out", () => {
    // sent 30 days ago, but reminded only 2 days ago -- not due yet.
    const r = recipient({
      sent_at: new Date(now.getTime() - 30 * DAY).toISOString(),
      last_reminder_at: new Date(now.getTime() - 2 * DAY).toISOString(),
      reminder_count: 1,
    });
    expect(isDueForAutoReminder(r, now)).toBe(false);
  });

  it("is due again 7 days after the last reminder", () => {
    const r = recipient({
      sent_at: new Date(now.getTime() - 30 * DAY).toISOString(),
      last_reminder_at: new Date(now.getTime() - 7 * DAY).toISOString(),
      reminder_count: 1,
    });
    expect(isDueForAutoReminder(r, now)).toBe(true);
  });
});
