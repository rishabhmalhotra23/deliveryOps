// Public-facing survey submission: validation (pure) + the DB write (insert
// nps_responses + nps_response_details, mark the recipient responded), plus
// the in-email one-click score stamp.

import { requireAdmin } from "@/lib/supabase/server";
import { getCustomerById } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import {
  TABLES,
  PRODUCT_SATISFACTION_LABELS,
  AUTOMATION_TARGET_RANGES,
  AUTOMATION_FUNCTIONS,
  type NpsResponse,
  type NpsCampaignRecipient,
  type AutomationTargetRange,
} from "@/lib/supabase/types";
import { getRecipientByToken, getCampaignById } from "./campaigns";

export class InvalidSurveySubmissionError extends Error {}
export class SurveyTokenNotFoundError extends Error {}
export class SurveyAlreadySubmittedError extends Error {}

export interface SurveySubmissionInput {
  respondentName: string;
  companyName: string;
  score: number;
  productSatisfaction: 1 | 2 | 3 | 4 | 5;
  automationTargetRange: AutomationTargetRange;
  automationFunctions: string[];
  automationFunctionsOther: string | null;
  easeCreatingAutomation: number;
  easeBusinessUserAcceptance: number;
  easeBusinessCase: number;
  easeIdentifyingProcesses: number;
  easeSelfSufficiency: number;
  easeSupportGuidance: number;
  journeySuccessAgreement: number;
  feedback: string;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new InvalidSurveySubmissionError(`${field} is required.`);
  return s;
}

function requireScale1to5(value: unknown, field: string): 1 | 2 | 3 | 4 | 5 {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new InvalidSurveySubmissionError(`${field} must be an integer between 1 and 5.`);
  }
  return n as 1 | 2 | 3 | 4 | 5;
}

/** Pure: validates + normalizes a raw form submission. Throws
 *  InvalidSurveySubmissionError with a human-readable message on the first
 *  failing field. Exported for unit testing without Supabase. */
export function validateSurveySubmission(body: Record<string, unknown>): SurveySubmissionInput {
  const respondentName = requireNonEmptyString(body.respondentName, "Name");
  const companyName = requireNonEmptyString(body.companyName, "Company name");

  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new InvalidSurveySubmissionError("Recommend score must be an integer between 0 and 10.");
  }

  const productSatisfaction = requireScale1to5(body.productSatisfaction, "Product satisfaction");

  const automationTargetRange = requireNonEmptyString(body.automationTargetRange, "Automation target range");
  if (!(AUTOMATION_TARGET_RANGES as readonly string[]).includes(automationTargetRange)) {
    throw new InvalidSurveySubmissionError("Automation target range is not a valid option.");
  }

  const automationFunctions = Array.isArray(body.automationFunctions)
    ? body.automationFunctions.filter((f): f is string => typeof f === "string" && f.trim() !== "")
    : [];
  if (automationFunctions.length === 0) {
    throw new InvalidSurveySubmissionError("Select at least one company function.");
  }
  for (const f of automationFunctions) {
    if (!(AUTOMATION_FUNCTIONS as readonly string[]).includes(f)) {
      throw new InvalidSurveySubmissionError(`'${f}' is not a valid company function.`);
    }
  }
  const automationFunctionsOther =
    typeof body.automationFunctionsOther === "string" ? body.automationFunctionsOther.trim() : "";
  if (automationFunctions.includes("Other") && !automationFunctionsOther) {
    throw new InvalidSurveySubmissionError("Please specify the 'Other' company function.");
  }

  const easeCreatingAutomation = requireScale1to5(body.easeCreatingAutomation, "Ease of creating an automation");
  const easeBusinessUserAcceptance = requireScale1to5(
    body.easeBusinessUserAcceptance,
    "Ease of managing business user acceptance"
  );
  const easeBusinessCase = requireScale1to5(body.easeBusinessCase, "Ease of creating a business case");
  const easeIdentifyingProcesses = requireScale1to5(
    body.easeIdentifyingProcesses,
    "Ease of identifying suitable processes"
  );
  const easeSelfSufficiency = requireScale1to5(body.easeSelfSufficiency, "Ease of building self sufficiency");
  const easeSupportGuidance = requireScale1to5(body.easeSupportGuidance, "Ease of getting support & guidance");
  const journeySuccessAgreement = requireScale1to5(body.journeySuccessAgreement, "Automation journey agreement");

  const feedback = requireNonEmptyString(body.feedback, "Feedback");

  return {
    respondentName,
    companyName,
    score,
    productSatisfaction,
    automationTargetRange: automationTargetRange as AutomationTargetRange,
    automationFunctions,
    automationFunctionsOther: automationFunctionsOther || null,
    easeCreatingAutomation,
    easeBusinessUserAcceptance,
    easeBusinessCase,
    easeIdentifyingProcesses,
    easeSelfSufficiency,
    easeSupportGuidance,
    journeySuccessAgreement,
    feedback,
  };
}

/** Resolves token -> recipient -> campaign, validates the body, writes
 *  nps_responses + nps_response_details, and marks the recipient responded.
 *  Sequential inserts with an app-level compensating delete on failure --
 *  consistent with this repo not using stored procedures elsewhere. */
export async function submitNpsResponse(token: string, rawBody: Record<string, unknown>): Promise<NpsResponse> {
  const sb = requireAdmin();
  const recipient = await getRecipientByToken(token);
  if (!recipient) throw new SurveyTokenNotFoundError("Unknown survey token.");
  if (recipient.response_id) throw new SurveyAlreadySubmittedError("This survey has already been submitted.");

  const campaign = await getCampaignById(recipient.campaign_id);
  if (!campaign) throw new Error(`Campaign not found for recipient ${recipient.id}`);

  const input = validateSurveySubmission(rawBody);

  const { data: responseRow, error: responseError } = await sb
    .from(TABLES.npsResponses)
    .insert({
      customer_id: recipient.customer_id,
      respondent_name: input.respondentName,
      respondent_type: recipient.respondent_type,
      quarter: campaign.quarter,
      response_date: new Date().toISOString().slice(0, 10),
      score: input.score,
      product_satisfaction: PRODUCT_SATISFACTION_LABELS[input.productSatisfaction],
      feedback: input.feedback,
      source_item_id: `nps-campaign-recipient:${recipient.id}`,
    })
    .select("*")
    .single();
  if (responseError) throw responseError;
  const response = responseRow as NpsResponse;

  try {
    const { error: detailsError } = await sb.from(TABLES.npsResponseDetails).insert({
      nps_response_id: response.id,
      company_name_submitted: input.companyName,
      automation_target_range: input.automationTargetRange,
      automation_functions: input.automationFunctions,
      automation_functions_other: input.automationFunctionsOther,
      ease_creating_automation: input.easeCreatingAutomation,
      ease_business_user_acceptance: input.easeBusinessUserAcceptance,
      ease_business_case: input.easeBusinessCase,
      ease_identifying_processes: input.easeIdentifyingProcesses,
      ease_self_sufficiency: input.easeSelfSufficiency,
      ease_support_guidance: input.easeSupportGuidance,
      journey_success_agreement: input.journeySuccessAgreement,
    });
    if (detailsError) throw detailsError;

    const { error: recipientError } = await sb
      .from(TABLES.npsCampaignRecipients)
      .update({ status: "responded", response_id: response.id })
      .eq("id", recipient.id);
    if (recipientError) throw recipientError;
  } catch (err) {
    // Compensating delete -- a response row should only exist if the whole
    // submission (details + recipient update) succeeded.
    await sb.from(TABLES.npsResponses).delete().eq("id", response.id);
    throw err;
  }

  const customer = await getCustomerById(recipient.customer_id);
  if (customer) {
    await appendEvent(
      customer.key,
      "NPS_RESPONSE_RECEIVED",
      { campaign_id: campaign.id, quarter: campaign.quarter, score: input.score },
      { summary: `NPS response received (${campaign.quarter}) — score ${input.score}`, tags: ["nps"] }
    ).catch(() => {});
  }

  return response;
}

/** GET /api/nps/quick/[token]?score=N -- the in-email click target. A
 *  convenience prefill, NOT a completed response: never touches
 *  nps_responses, never flips the recipient's status. */
export async function recordQuickScore(token: string, score: number): Promise<NpsCampaignRecipient> {
  const sb = requireAdmin();
  const recipient = await getRecipientByToken(token);
  if (!recipient) throw new SurveyTokenNotFoundError("Unknown survey token.");
  if (recipient.response_id) throw new SurveyAlreadySubmittedError("This survey has already been submitted.");
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new InvalidSurveySubmissionError("score must be an integer between 0 and 10.");
  }

  const { data, error } = await sb
    .from(TABLES.npsCampaignRecipients)
    .update({ quick_score: score, quick_score_at: new Date().toISOString() })
    .eq("id", recipient.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as NpsCampaignRecipient;
}
