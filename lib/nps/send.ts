// Thin wrapper around lib/integrations/google/gmail.ts's sendEmail() — builds
// the survey link + quick-score links, renders the campaign's template, and
// sends. No DB writes here; callers (lib/nps/campaigns.ts, lib/nps/reminders.ts)
// stamp sent_at/reminder_count/etc. themselves after a successful send.

import { sendEmail, type SendEmailResult } from "@/lib/integrations/google/gmail";
import type { NpsCampaign, NpsCampaignRecipient } from "@/lib/supabase/types";
import { NPS_FROM_ADDRESS, renderTemplate, renderQuickScoreLinksMarkdown } from "./constants";

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:4001"
  );
}

export function surveyLink(token: string): string {
  return `${appUrl()}/nps/respond/${token}`;
}

interface SendToRecipientArgs {
  campaign: NpsCampaign;
  recipient: NpsCampaignRecipient;
  customerDisplayName: string;
  customerKey: string;
}

async function sendTemplated(
  { campaign, recipient, customerDisplayName, customerKey }: SendToRecipientArgs,
  kind: "invite" | "reminder"
): Promise<SendEmailResult> {
  const subject = kind === "invite" ? campaign.invite_subject : campaign.reminder_subject;
  const bodyTpl = kind === "invite" ? campaign.invite_body : campaign.reminder_body;
  const link = surveyLink(recipient.survey_token);
  const scoreLinks = renderQuickScoreLinksMarkdown(recipient.survey_token, appUrl());

  const body = renderTemplate(bodyTpl, {
    name: recipient.respondent_name ?? "there",
    company: customerDisplayName,
    link,
    scoreLinks,
  });

  return sendEmail({
    fromAddr: NPS_FROM_ADDRESS,
    to: [recipient.email],
    subject,
    bodyMarkdown: body,
    customerKey,
  });
}

export function sendInviteEmail(args: SendToRecipientArgs): Promise<SendEmailResult> {
  return sendTemplated(args, "invite");
}

export function sendReminderEmail(args: SendToRecipientArgs): Promise<SendEmailResult> {
  return sendTemplated(args, "reminder");
}
