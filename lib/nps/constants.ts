// Shared constants + template rendering for NPS campaigns. Hardcoded rather
// than per-campaign config columns — matches the "for now, weekly, 3
// reminders" framing from the request; trivial to promote to columns later
// if a future campaign needs a different cadence.

export const MAX_AUTO_REMINDERS = 3;
export const REMINDER_INTERVAL_DAYS = 7;
export const NPS_FROM_ADDRESS = "ai.cx@kognitos.com";

export const DEFAULT_INVITE_SUBJECT = "Quick feedback on your Kognitos experience?";
export const DEFAULT_INVITE_BODY = `Hi {{name}},

We'd love to hear how things are going with Kognitos. It only takes a couple of minutes.

How likely are you to recommend us to colleagues and friends?

{{scoreLinks}}

Or answer the full survey here: {{link}}

Thanks,
The Kognitos Team`;

export const DEFAULT_REMINDER_SUBJECT = "Reminder: we'd still love your feedback";
export const DEFAULT_REMINDER_BODY = `Hi {{name}},

Just a friendly reminder — we'd still love to hear from you.

How likely are you to recommend us to colleagues and friends?

{{scoreLinks}}

Or answer the full survey here: {{link}}

Thanks,
The Kognitos Team`;

export interface TemplateVars {
  name: string;
  company: string;
  link: string;
  scoreLinks?: string;
}

/** {{name}}/{{company}}/{{link}}/{{scoreLinks}} substitution. {{name}} falls
 *  back to "there" when the CSV carried no respondent_name hint. */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl
    .replace(/\{\{name\}\}/g, vars.name.trim() || "there")
    .replace(/\{\{company\}\}/g, vars.company)
    .replace(/\{\{link\}\}/g, vars.link)
    .replace(/\{\{scoreLinks\}\}/g, vars.scoreLinks ?? "");
}

/**
 * A markdown snippet — 11 clickable score links (0-10), grouped into 3 emoji
 * buckets on the exact thresholds npsCategory() (lib/supabase/types.ts) uses
 * elsewhere in the app, so a click in this email and a Customer-360
 * detractor/passive/promoter badge always agree.
 *
 * Plain markdown `[N](url)` links, not raw HTML: sendEmail()'s bodyMarkdown
 * is rendered to HTML by lib/integrations/google/gmail.ts's own
 * markdownToHtml() (link syntax -> <a href>), so this works with zero
 * changes to the email-sending code, and degrades to readable-enough plain
 * text in the text/plain MIME part.
 */
export function renderQuickScoreLinksMarkdown(token: string, appUrl: string): string {
  const linkFor = (score: number) => `[${score}](${appUrl}/api/nps/quick/${token}?score=${score})`;
  const detractors = Array.from({ length: 7 }, (_, score) => linkFor(score)).join(" ");
  const passives = [linkFor(7), linkFor(8)].join(" ");
  const promoters = [linkFor(9), linkFor(10)].join(" ");
  return `😞 ${detractors}   😐 ${passives}   😊 ${promoters}`;
}

// nps_responses.quarter is stored "<quarter-digit>Q<2-digit-year>" (e.g.
// "4Q25", "1Q26") — same format lib/analytics/loader.ts,
// lib/dashboard/stats-drilldown.ts, and lib/customers/view-model.ts already
// sort by. Lives here (not lib/nps/history.ts, which imports the server-only
// Supabase admin client) so the client-side New Campaign modal can import it
// without pulling service-role code into the browser bundle.
/** Pure. Exported for unit testing. */
export function quarterSortKey(s: string): number {
  const m = /^(\d)Q(\d{2})$/.exec(s);
  return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
}

// Kognitos's fiscal year runs Feb-Jan, named after the calendar year it ends
// in (FY26 = Feb 2025-Jan 2026). Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct,
// Q4=Nov-Jan. This is the exact rule the 2026-09-02 historical backfill used
// (relabeling 2Q24-4Q24 -> 2Q25-4Q25 and splitting a mixed "4Q26" bucket
// into 4Q26/1Q27/2Q27 by response_date) — mirrored here so the New Campaign
// modal's quarter picker defaults to the fiscal quarter Kognitos is
// currently in, instead of a raw calendar year that would immediately
// reintroduce the same mislabeling for the next campaign.
/** The fiscal quarter an arbitrary date falls in, as the same "<n>Q<yy>"
 *  string currentFiscalQuarter() and nps_responses.quarter use.
 *
 *  Generalised out of currentFiscalQuarter (2026-09-04) so Delivery's
 *  Historical section can group processes by go-live quarter without
 *  inventing a second quarter convention — the Q-on-Q aggregate in
 *  lib/processes/loader.ts keyed on CALENDAR quarters ("2026 Q1"), which
 *  would have put the same piece of work in a different quarter than every
 *  NPS chart and the team's own Excel tracker. Returns null for a null or
 *  unparseable date so callers can render an explicit "no date" group rather
 *  than silently bucketing it somewhere wrong. */
export function fiscalQuarterOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // UTC throughout: these are date-only columns, and reading them in a
  // local timezone west of UTC shifts 2026-02-01 back into January — across
  // a fiscal-year boundary, not just a quarter one.
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  let quarterNum: 1 | 2 | 3 | 4;
  let fy: number;
  if (month === 1) {
    quarterNum = 4;
    fy = year;
  } else if (month >= 11) {
    quarterNum = 4;
    fy = year + 1;
  } else if (month <= 4) {
    quarterNum = 1;
    fy = year + 1;
  } else if (month <= 7) {
    quarterNum = 2;
    fy = year + 1;
  } else {
    quarterNum = 3;
    fy = year + 1;
  }
  return `${quarterNum}Q${String(fy % 100).padStart(2, "0")}`;
}

/** Pure. Exported for unit testing. */
export function currentFiscalQuarter(now: Date = new Date()): { quarterNum: 1 | 2 | 3 | 4; year: number } {
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  if (month === 1) return { quarterNum: 4, year };
  if (month === 11 || month === 12) return { quarterNum: 4, year: year + 1 };
  if (month <= 4) return { quarterNum: 1, year: year + 1 };
  if (month <= 7) return { quarterNum: 2, year: year + 1 };
  return { quarterNum: 3, year: year + 1 };
}
