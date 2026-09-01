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
