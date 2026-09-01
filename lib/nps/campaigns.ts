// NPS campaign store — CRUD + CSV-based creation + the invite send.
// Service-role reads/writes; Auth0 gates access at the middleware/route layer,
// same model as lib/processes/store.ts.

import { requireAdmin } from "@/lib/supabase/server";
import { getCustomerById, listCustomers } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import { TABLES, type NpsCampaign, type NpsCampaignRecipient } from "@/lib/supabase/types";
import { parseNpsRecipientCsv } from "./csv";
import {
  DEFAULT_INVITE_SUBJECT,
  DEFAULT_INVITE_BODY,
  DEFAULT_REMINDER_SUBJECT,
  DEFAULT_REMINDER_BODY,
} from "./constants";
import { sendInviteEmail } from "./send";

export class NpsCampaignNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Unknown NPS campaign: ${id}`);
    this.name = "NpsCampaignNotFoundError";
  }
}

// ─── Creation ─────────────────────────────────────────────────────────────

export interface CreateCampaignFromCsvInput {
  quarter: string;
  csvText: string;
  inviteSubject?: string;
  inviteBody?: string;
  reminderSubject?: string;
  reminderBody?: string;
}

export interface CreateCampaignFromCsvResult {
  campaign: NpsCampaign;
  recipients: NpsCampaignRecipient[];
  errors: string[];
}

/** Creates the campaign (draft) + one recipient row (queued) per CSV row that
 *  resolved to a real customer_key. Unmatched/invalid rows are reported in
 *  `errors` and never inserted — no email sent here. */
export async function createCampaignFromCsv(
  input: CreateCampaignFromCsvInput,
  actor: string
): Promise<CreateCampaignFromCsvResult> {
  const sb = requireAdmin();
  const customers = await listCustomers();
  const customerKeyToId = new Map(customers.map((c) => [c.key, c.id]));

  const parsed = parseNpsRecipientCsv(input.csvText, new Set(customerKeyToId.keys()));

  const { data: campaignRow, error: campaignError } = await sb
    .from(TABLES.npsCampaigns)
    .insert({
      quarter: input.quarter,
      invite_subject: input.inviteSubject ?? DEFAULT_INVITE_SUBJECT,
      invite_body: input.inviteBody ?? DEFAULT_INVITE_BODY,
      reminder_subject: input.reminderSubject ?? DEFAULT_REMINDER_SUBJECT,
      reminder_body: input.reminderBody ?? DEFAULT_REMINDER_BODY,
      created_by: actor,
    })
    .select("*")
    .single();
  if (campaignError) throw campaignError;
  const campaign = campaignRow as NpsCampaign;

  let recipients: NpsCampaignRecipient[] = [];
  if (parsed.rows.length > 0) {
    const insertRows = parsed.rows.map((r) => ({
      campaign_id: campaign.id,
      customer_id: customerKeyToId.get(r.customerKey)!,
      email: r.email,
      respondent_name: r.respondentName,
      respondent_type: r.respondentType,
    }));
    const { data: recipientRows, error: recipientError } = await sb
      .from(TABLES.npsCampaignRecipients)
      .insert(insertRows)
      .select("*");
    if (recipientError) throw recipientError;
    recipients = (recipientRows as NpsCampaignRecipient[]) ?? [];
  }

  return { campaign, recipients, errors: parsed.errors };
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<NpsCampaign[]> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.npsCampaigns)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as NpsCampaign[]) ?? [];
}

export async function getCampaignById(id: string): Promise<NpsCampaign | null> {
  const sb = requireAdmin();
  const { data, error } = await sb.from(TABLES.npsCampaigns).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as NpsCampaign | null) ?? null;
}

export async function requireCampaignById(id: string): Promise<NpsCampaign> {
  const campaign = await getCampaignById(id);
  if (!campaign) throw new NpsCampaignNotFoundError(id);
  return campaign;
}

export async function listRecipients(campaignId: string): Promise<NpsCampaignRecipient[]> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.npsCampaignRecipients)
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as NpsCampaignRecipient[]) ?? [];
}

export async function getRecipientByToken(token: string): Promise<NpsCampaignRecipient | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.npsCampaignRecipients)
    .select("*")
    .eq("survey_token", token)
    .maybeSingle();
  if (error) throw error;
  return (data as NpsCampaignRecipient | null) ?? null;
}

export async function getRecipientById(id: string): Promise<NpsCampaignRecipient | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.npsCampaignRecipients)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as NpsCampaignRecipient | null) ?? null;
}

// ─── Writes ───────────────────────────────────────────────────────────────

const TEMPLATE_FIELDS = ["invite_subject", "invite_body", "reminder_subject", "reminder_body"] as const;

export async function updateCampaignTemplate(
  id: string,
  patch: Partial<Pick<NpsCampaign, (typeof TEMPLATE_FIELDS)[number]>>
): Promise<NpsCampaign> {
  const sb = requireAdmin();
  const existing = await requireCampaignById(id);
  if (existing.status !== "draft") {
    throw new Error("Templates can only be edited while the campaign is still a draft.");
  }
  const update: Record<string, unknown> = {};
  for (const f of TEMPLATE_FIELDS) {
    if (f in patch && patch[f] !== undefined) update[f] = patch[f];
  }
  if (Object.keys(update).length === 0) return existing;

  const { data, error } = await sb
    .from(TABLES.npsCampaigns)
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as NpsCampaign;
}

export async function closeCampaign(id: string): Promise<NpsCampaign> {
  const sb = requireAdmin();
  await requireCampaignById(id);
  const { data, error } = await sb
    .from(TABLES.npsCampaigns)
    .update({ status: "closed" })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as NpsCampaign;
}

// ─── Sending ──────────────────────────────────────────────────────────────

/** Sends every `queued` recipient's invite, flips each to `sent`/`failed`,
 *  then flips the campaign draft/sending -> active. Called from the
 *  send-nps-campaign job (app/api/jobs/send-nps-campaign/route.ts). */
export async function sendCampaignInvites(campaignId: string): Promise<{ sent: number; failed: number }> {
  const sb = requireAdmin();
  const campaign = await requireCampaignById(campaignId);
  const queued = (await listRecipients(campaignId)).filter((r) => r.status === "queued");

  let sent = 0;
  let failed = 0;

  for (const recipient of queued) {
    const customer = await getCustomerById(recipient.customer_id);
    if (!customer) {
      failed++;
      continue;
    }
    try {
      await sendInviteEmail({
        campaign,
        recipient,
        customerDisplayName: customer.display_name,
        customerKey: customer.key,
      });
      await sb
        .from(TABLES.npsCampaignRecipients)
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", recipient.id);
      await appendEvent(
        customer.key,
        "NPS_SURVEY_SENT",
        { campaign_id: campaignId, quarter: campaign.quarter },
        { summary: `NPS survey sent (${campaign.quarter})`, tags: ["nps"] }
      );
      sent++;
    } catch (err) {
      await sb.from(TABLES.npsCampaignRecipients).update({ status: "failed" }).eq("id", recipient.id);
      await appendEvent(
        customer.key,
        "NPS_SEND_FAILED",
        { campaign_id: campaignId, error: err instanceof Error ? err.message : String(err) },
        { summary: `NPS survey send failed (${campaign.quarter})`, tags: ["nps"] }
      ).catch(() => {});
      failed++;
    }
  }

  await sb.from(TABLES.npsCampaigns).update({ status: "active" }).eq("id", campaignId);
  return { sent, failed };
}
