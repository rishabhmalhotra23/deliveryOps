// Dev-mode helpers — auto-detect which integrations are live by checking for
// their required env vars. Anything not configured falls back to a local mock
// (events written to the dev outbox, see lib/dev/outbox.ts).
//
// Set DELIVERY_OPS_DEV_MODE=on to force every integration into mock regardless
// of env vars. Set DELIVERY_OPS_DEV_MODE=off to error loudly when an integration
// is missing creds (useful in production CI).

export type DevModeFlag = "auto" | "on" | "off";

const overrideFlag = (): DevModeFlag => {
  const v = (process.env.DELIVERY_OPS_DEV_MODE ?? "auto").toLowerCase();
  return v === "on" || v === "off" ? v : "auto";
};

const has = (...keys: string[]): boolean => keys.every((k) => Boolean(process.env[k]?.trim()));

export function slackEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("SLACK_BOT_TOKEN");
}

export function gmailEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN");
}

export function driveEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN");
}

export function calendarEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN");
}

export function anthropicEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("ANTHROPIC_API_KEY");
}

export function supabaseEnabled(): boolean {
  return has("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
}

export function inngestEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY");
}

export function salesforceEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_INSTANCE_URL");
}

export function mondayEnabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("MONDAY_API_TOKEN");
}

export function kognitosV2Enabled(): boolean {
  if (overrideFlag() === "on") return false;
  if (overrideFlag() === "off") return true;
  return has("KOGNITOS_V2_TOKEN", "KOGNITOS_V2_BASE_URL", "KOGNITOS_V2_ORG_ID", "KOGNITOS_V2_WORKSPACE_ID");
}

export interface IntegrationStatus {
  name: string;
  live: boolean;
  hint: string;
}

export function integrationStatus(): IntegrationStatus[] {
  return [
    {
      name: "Supabase",
      live: supabaseEnabled(),
      hint: "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.",
    },
    {
      name: "Anthropic (Claude)",
      live: anthropicEnabled(),
      hint: "Set ANTHROPIC_API_KEY. Required for the agent and document extraction.",
    },
    {
      name: "Slack",
      live: slackEnabled(),
      hint: "Set SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET. Outbound messages route to /dev/outbox until set.",
    },
    {
      name: "Gmail",
      live: gmailEnabled(),
      hint: "Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN. Outbound emails route to /dev/outbox until set.",
    },
    {
      name: "Google Drive",
      live: driveEnabled(),
      hint: "Same Google credentials as Gmail. Drive uploads route to /dev/outbox until set.",
    },
    {
      name: "Google Calendar",
      live: calendarEnabled(),
      hint: "Same Google credentials as Gmail. listEvents returns mock data until set.",
    },
    {
      name: "Inngest (cloud)",
      live: inngestEnabled(),
      hint: "Set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY. The dev server at localhost:8288 picks up /api/inngest automatically without these.",
    },
    {
      name: "Salesforce",
      live: salesforceEnabled(),
      hint: "Set SALESFORCE_CLIENT_ID + SALESFORCE_CLIENT_SECRET + SALESFORCE_INSTANCE_URL. Powers Phase 2 sf_accounts / sf_opportunities / sf_cases sync.",
    },
    {
      name: "Monday.com",
      live: mondayEnabled(),
      hint: "Set MONDAY_API_TOKEN. Powers Phase 2 customer-board sync into monday_items.",
    },
    {
      name: "Kognitos v2",
      live: kognitosV2Enabled(),
      hint: "Set KOGNITOS_V2_TOKEN + _BASE_URL + _ORG_ID + _WORKSPACE_ID. Powers credit usage / runs / exceptions data.",
    },
  ];
}
