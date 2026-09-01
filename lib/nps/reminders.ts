// Automatic + manual NPS reminder sending.
//
// isDueForAutoReminder is the one rule that matters here, kept pure and unit
// tested (tests/nps/reminders.test.ts) — same split as withDerivedFields in
// lib/processes/store.ts. The manual paths (sendManualReminder,
// remindAllPending) never call it: a manual reminder is never blocked by the
// cap or the 7-day interval.

import { requireAdmin } from "@/lib/supabase/server";
import { getCustomerById } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import {
  TABLES,
  type NpsCampaign,
  type NpsCampaignRecipient,
  type NpsCampaignRecipientStatus,
} from "@/lib/supabase/types";
import { MAX_AUTO_REMINDERS, REMINDER_INTERVAL_DAYS } from "./constants";
import { sendReminderEmail } from "./send";
import { getCampaignById, requireCampaignById, getRecipientById } from "./campaigns";

export interface ReminderDueInput {
  status: NpsCampaignRecipientStatus;
  reminder_count: number;
  sent_at: string | null;
  last_reminder_at: string | null;
}

/** Pure: is this recipient due for an AUTOMATIC reminder right now? */
export function isDueForAutoReminder(r: ReminderDueInput, now: Date): boolean {
  if (r.status !== "sent") return false; // not yet sent, already responded, or failed
  if (r.reminder_count >= MAX_AUTO_REMINDERS) return false; // cap only gates the automatic path
  const base = r.last_reminder_at ?? r.sent_at;
  if (!base) return false;
  return now.getTime() - new Date(base).getTime() >= REMINDER_INTERVAL_DAYS * 86_400_000;
}

// Cheap SQL prefilter — status='sent' and reminder_count<3, joined to active
// campaigns via nps_campaign_recipients_due_idx — before isDueForAutoReminder
// does the date math in JS.
async function fetchAutoReminderCandidates(): Promise<NpsCampaignRecipient[]> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.npsCampaignRecipients)
    .select("*, nps_campaigns!inner(status)")
    .eq("status", "sent")
    .lt("reminder_count", MAX_AUTO_REMINDERS)
    .eq("nps_campaigns.status", "active");
  if (error) throw error;
  return (data as NpsCampaignRecipient[]) ?? [];
}

async function sendOneReminder(recipient: NpsCampaignRecipient, campaign: NpsCampaign): Promise<boolean> {
  const sb = requireAdmin();
  const customer = await getCustomerById(recipient.customer_id);
  if (!customer) return false;

  try {
    await sendReminderEmail({
      campaign,
      recipient,
      customerDisplayName: customer.display_name,
      customerKey: customer.key,
    });
    await sb
      .from(TABLES.npsCampaignRecipients)
      .update({ reminder_count: recipient.reminder_count + 1, last_reminder_at: new Date().toISOString() })
      .eq("id", recipient.id);
    await appendEvent(
      customer.key,
      "NPS_REMINDER_SENT",
      { campaign_id: campaign.id, quarter: campaign.quarter },
      { summary: `NPS reminder sent (${campaign.quarter})`, tags: ["nps"] }
    );
    return true;
  } catch (err) {
    await appendEvent(
      customer.key,
      "NPS_SEND_FAILED",
      { campaign_id: campaign.id, error: err instanceof Error ? err.message : String(err), reminder: true },
      { summary: `NPS reminder send failed (${campaign.quarter})`, tags: ["nps"] }
    ).catch(() => {});
    return false;
  }
}

/** Called once per daily run-tasks cron tick (mode: "auto"). Never blocked by
 *  campaign status other than "active" — closed campaigns are excluded. */
export async function sweepAutoReminders(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const candidates = await fetchAutoReminderCandidates();
  const due = candidates.filter((r) => isDueForAutoReminder(r, now));

  let sent = 0;
  let failed = 0;
  const campaignCache = new Map<string, NpsCampaign>();

  for (const recipient of due) {
    let campaign = campaignCache.get(recipient.campaign_id);
    if (!campaign) {
      const found = await getCampaignById(recipient.campaign_id);
      if (!found) {
        failed++;
        continue;
      }
      campaign = found;
      campaignCache.set(found.id, found);
    }
    const ok = await sendOneReminder(recipient, campaign);
    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}

/** Manual "remind all pending" — every sent-but-not-yet-responded recipient
 *  in the campaign, ignoring the cap and the 7-day interval entirely. */
export async function remindAllPending(campaignId: string): Promise<{ sent: number; failed: number }> {
  const sb = requireAdmin();
  const campaign = await requireCampaignById(campaignId);
  const { data, error } = await sb
    .from(TABLES.npsCampaignRecipients)
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("status", "sent");
  if (error) throw error;
  const recipients = (data as NpsCampaignRecipient[]) ?? [];

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const ok = await sendOneReminder(recipient, campaign);
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Manual single "Remind" — never checks the cap or the interval. */
export async function sendManualReminder(recipientId: string): Promise<NpsCampaignRecipient> {
  const recipient = await getRecipientById(recipientId);
  if (!recipient) throw new Error(`Unknown NPS campaign recipient: ${recipientId}`);

  const campaign = await requireCampaignById(recipient.campaign_id);
  const ok = await sendOneReminder(recipient, campaign);
  if (!ok) throw new Error("Reminder send failed — check the events feed for detail.");

  const updated = await getRecipientById(recipientId);
  if (!updated) throw new Error(`Unknown NPS campaign recipient: ${recipientId}`);
  return updated;
}
