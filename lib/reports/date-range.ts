// Shared date-range resolution for every report that supports a week /
// month / quarter / custom picker. Moved out of weekly-loader.ts so the
// All-Hands and Weekly Delivery Review reports don't duplicate it.

export type RangePreset = "week" | "month" | "quarter" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
  preset: RangePreset;
  label: string;       // "May 9 – May 15, 2026"
  cadenceLabel: string; // "Weekly" | "Monthly" | "Quarterly" | "Custom"
}

export interface RangeRequest {
  preset?: RangePreset;
  from?: string; // ISO date
  to?: string;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Snap a date to midnight UTC so go-live dates (which are stored date-only
// and parse to 00:00 UTC) are always >= the range start.
function startOfDayUTC(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function resolveRange(req: RangeRequest = {}, now: Date = new Date()): DateRange {
  // Custom range: needs both from + to to be valid.
  if (req.preset === "custom" && req.from && req.to) {
    const start = startOfDayUTC(new Date(req.from));
    const end = new Date(req.to);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      end.setUTCHours(23, 59, 59, 999);
      return { start, end, preset: "custom", label: `${fmtShort(start)} – ${fmtShort(end)}, ${end.getUTCFullYear()}`, cadenceLabel: "Custom" };
    }
  }

  if (req.preset === "month") {
    const start = startOfDayUTC(new Date(now));
    start.setUTCDate(start.getUTCDate() - 30);
    return { start, end: now, preset: "month", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Monthly" };
  }

  if (req.preset === "quarter") {
    const start = startOfDayUTC(new Date(now));
    start.setUTCDate(start.getUTCDate() - 90);
    return { start, end: now, preset: "quarter", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Quarterly" };
  }

  // Default: rolling last 7 days, start snapped to midnight.
  const start = startOfDayUTC(new Date(now));
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end: now, preset: "week", label: `${fmtShort(start)} – ${fmtShort(now)}, ${now.getUTCFullYear()}`, cadenceLabel: "Weekly" };
}
