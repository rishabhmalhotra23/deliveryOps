// Google Calendar client — Phase 1 ships read-only "list upcoming/past events"
// helpers. Full Calendar sync ports in Phase 2 (sync-calendar Inngest function).
//
// Dev-mode behaviour: when Google OAuth env vars are missing, listEvents
// returns a small canned set of upcoming meetings so the dashboard has
// something to render.

import { getGoogleAccessToken } from "./auth";
import { calendarEnabled } from "@/lib/dev/mode";

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
  if (!calendarEnabled()) {
    return mockEvents(opts.timeMin, opts.timeMax);
  }
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

function mockEvents(timeMin: Date, timeMax: Date): CalEvent[] {
  const now = Date.now();
  const candidates: CalEvent[] = [
    {
      id: "mock-1",
      summary: "Acme weekly check-in",
      description: "Standing weekly with the Acme FDE team.",
      start: { dateTime: new Date(now + 24 * 3600_000).toISOString() },
      end: { dateTime: new Date(now + 24 * 3600_000 + 30 * 60_000).toISOString() },
      attendees: [{ email: "csm@kognitos.com", responseStatus: "accepted" }],
      htmlLink: "mock://calendar/mock-1",
    },
    {
      id: "mock-2",
      summary: "Acme QBR",
      description: "Quarterly business review.",
      start: { dateTime: new Date(now + 7 * 24 * 3600_000).toISOString() },
      end: { dateTime: new Date(now + 7 * 24 * 3600_000 + 60 * 60_000).toISOString() },
      htmlLink: "mock://calendar/mock-2",
    },
  ];
  return candidates.filter((e) => {
    const start = new Date(e.start.dateTime ?? e.start.date ?? 0).getTime();
    return start >= timeMin.getTime() && start <= timeMax.getTime();
  });
}
