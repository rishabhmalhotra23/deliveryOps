// Google Calendar client — Phase 1 ships read-only "list upcoming/past events"
// helpers. Full Calendar sync ports in Phase 2 (sync-calendar Inngest function).

import { getGoogleAccessToken } from "./auth";

const CAL_API = "https://www.googleapis.com/calendar/v3";

async function calFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${CAL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`Calendar API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export interface CalEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
  htmlLink?: string;
}

export async function listEvents(opts: {
  calendarId?: string;
  timeMin: Date;
  timeMax: Date;
  q?: string;
  maxResults?: number;
}): Promise<CalEvent[]> {
  const calendarId = encodeURIComponent(opts.calendarId ?? "primary");
  const params = new URLSearchParams({
    timeMin: opts.timeMin.toISOString(),
    timeMax: opts.timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(opts.maxResults ?? 50),
  });
  if (opts.q) params.set("q", opts.q);

  const data = await calFetch<{ items: CalEvent[] }>(
    `/calendars/${calendarId}/events?${params.toString()}`
  );
  return data.items ?? [];
}
