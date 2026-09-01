-- NPS campaigns: quarterly bulk-invite + automatic/manual reminder tracking.
-- Rishabh, 2026-08-31: FDE team runs one campaign per quarter, uploads a CSV
-- of {customer_key, email, respondent_name?, respondent_type?}, previews the
-- parsed list + template in-app, then explicitly sends. Reminders: 3 automatic
-- (1/week) plus unlimited manual — the manual button never checks the auto cap.
--
-- Deliberately NOT reusing `tasks` (customer_id is NOT NULL there, and a
-- campaign spans many customers) and NOT adding a third vercel.json cron —
-- the daily reminder sweep rides the existing run-tasks 08:00 UTC tick via
-- dispatchJob("send-nps-reminders", { mode: "auto" }).
--
-- nps_responses (0021) is intentionally left alone: it is read by Customer 360,
-- the dashboard NPS charts, and the list_customer_nps/list_recent_nps agent
-- tools. Every new survey question lives on nps_response_details instead.

create type nps_campaign_status as enum ('draft', 'sending', 'active', 'closed');

create table nps_campaigns (
  id                uuid primary key default gen_random_uuid(),
  quarter           text not null,              -- e.g. "Q4'25", matches nps_responses.quarter style

  -- Two templates, not one shared one: the reminder ("just checking in") is a
  -- different message from the invite, and the preview-then-send screen shows
  -- and lets you edit both independently before anything sends.
  invite_subject    text not null,
  invite_body       text not null,               -- markdown; {{name}}/{{company}}/{{link}} placeholders
  reminder_subject  text not null,
  reminder_body     text not null,

  status            nps_campaign_status not null default 'draft',
  created_by        text not null,               -- actor email, "unknown" on session-lookup failure

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger nps_campaigns_set_updated_at before update on nps_campaigns
for each row execute function set_updated_at();

create index nps_campaigns_status_idx on nps_campaigns (status);
create index nps_campaigns_quarter_idx on nps_campaigns (quarter);

comment on table nps_campaigns is
  'One row per quarterly NPS send. draft = created from a CSV upload, not yet sent. sending = Send clicked, invite job in flight. active = invites attempted, now in the response/reminder-collection window -- the automatic reminder sweep only considers active campaigns. closed = manually wound down; excluded from the automatic sweep but still open to manual "remind" and still browsable in the queue view.';

comment on column nps_campaigns.invite_body is
  'Markdown, rendered to HTML by the existing gmail.ts sendEmail() path. Placeholders {{name}}, {{company}}, {{link}} are substituted per-recipient at send time by lib/nps/send.ts -- {{name}} falls back to "there" if the CSV had no respondent_name hint. The invite body also gets the clickable 0-10 quick-score link row appended (lib/nps/constants.ts renderQuickScoreLinksHtml) -- see app/api/nps/quick/[token].';


-- ─── nps_campaign_recipients ─────────────────────────────────────────────────
-- One row per CSV row that resolved to a real customer. Rows whose
-- customer_key didn't match anything in `customers` are NEVER inserted here --
-- they only ever exist as an error entry in the upload response.

create type nps_campaign_recipient_status as enum ('queued', 'sent', 'responded', 'failed');

create table nps_campaign_recipients (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references nps_campaigns(id) on delete cascade,
  customer_id       uuid not null references customers(id) on delete cascade,

  email             text not null,
  respondent_name   text,                        -- CSV prefill hint only; NOT the source of truth for the eventual response's respondent_name
  respondent_type   text,                        -- carried verbatim into nps_responses.respondent_type on submission

  -- Unguessable per-recipient link -- the sole authentication for the public
  -- /nps/respond/[token] page and /api/nps/quick/[token]. Hex, not a uuid, so
  -- it's visually distinct from `id` in logs/URLs.
  survey_token      text not null unique default encode(gen_random_bytes(32), 'hex'),

  status            nps_campaign_recipient_status not null default 'queued',
  sent_at           timestamptz,                  -- set when the initial invite actually sent (or mock-sent to the dev outbox)
  reminder_count    smallint not null default 0,  -- incremented by BOTH automatic and manual reminders
  last_reminder_at  timestamptz,

  -- One-click score from the invite email (see app/api/nps/quick/[token]).
  -- A convenience prefill, NOT a completed response -- reminders keep firing
  -- until the full form (below) is actually submitted.
  quick_score       smallint check (quick_score between 0 and 10),
  quick_score_at    timestamptz,

  response_id       uuid references nps_responses(id),  -- set on submission; recipient row is otherwise never deleted, so this is the audit trail back to the response

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger nps_campaign_recipients_set_updated_at before update on nps_campaign_recipients
for each row execute function set_updated_at();

create index nps_campaign_recipients_campaign_idx on nps_campaign_recipients (campaign_id);

-- Defensive dedup at the DB layer, in addition to the CSV parser's own
-- duplicate-email check -- belt and suspenders against an app-layer bug.
create unique index nps_campaign_recipients_campaign_email_idx
  on nps_campaign_recipients (campaign_id, lower(email));

-- Supports the automatic reminder sweep's prefilter: "give me every sent-but-
-- not-yet-responded recipient with reminder_count < 3", cheaply, before the
-- pure isDueForAutoReminder() function does the date math in JS.
create index nps_campaign_recipients_due_idx
  on nps_campaign_recipients (status, reminder_count)
  where status = 'sent';

comment on table nps_campaign_recipients is
  'One row per resolved (customer_key matched) CSV recipient. survey_token is the sole authentication for the public /nps/respond/[token] page and its submit route -- there is no login for respondents. reminder_count/last_reminder_at are shared between the automatic sweep and the manual "remind" button; the automatic sweep additionally checks reminder_count < 3 and a 7-day interval, the manual button checks neither.';


-- ─── nps_response_details ────────────────────────────────────────────────────
-- 1:1 companion to nps_responses, holding every question on the rebuilt survey
-- that isn't already a column on nps_responses. Deliberately not merged into
-- nps_responses so Customer 360 / dashboard / agent-tool readers of that table
-- need zero changes.
--
-- product_satisfaction (on nps_responses, unchanged) uses these 5 labels for
-- the survey's 1-5 scale, confirmed against the 84 historical rows:
--   1 Very unsatisfied · 2 Somewhat unsatisfied · 3 Neutral ·
--   4 Somewhat satisfied · 5 Very satisfied

create table nps_response_details (
  id                              uuid primary key default gen_random_uuid(),
  nps_response_id                uuid not null unique references nps_responses(id) on delete cascade,

  -- Shown pre-filled from customers.display_name (via the token's resolved
  -- recipient row), editable by the respondent. What they actually typed is
  -- stored here for audit/mismatch detection -- it is NEVER used to set
  -- nps_responses.customer_id, which always comes from the survey token.
  company_name_submitted         text not null,

  automation_target_range        text not null
    check (automation_target_range in ('1-5', '6-10', '11-25', '26-50', '50+')),

  automation_functions           text[] not null default '{}',
  automation_functions_other     text,   -- populated only when 'Other' is in automation_functions

  ease_creating_automation        smallint not null check (ease_creating_automation between 1 and 5),
  ease_business_user_acceptance   smallint not null check (ease_business_user_acceptance between 1 and 5),
  ease_business_case              smallint not null check (ease_business_case between 1 and 5),
  ease_identifying_processes      smallint not null check (ease_identifying_processes between 1 and 5),
  ease_self_sufficiency           smallint not null check (ease_self_sufficiency between 1 and 5),
  ease_support_guidance           smallint not null check (ease_support_guidance between 1 and 5),

  journey_success_agreement       smallint not null check (journey_success_agreement between 1 and 5),

  created_at                      timestamptz not null default now()
  -- No updated_at / trigger: a submitted survey response is never edited.
  -- This is deliberately append-only, unlike most tables in this schema.
);

comment on table nps_response_details is
  'Companion 1:1 table to nps_responses holding every survey question that is not a native nps_responses column, plus the respondent-submitted company name for audit against customers.display_name. Written once, at submission time, by the public /api/nps/respond/[token] route. Never read by Customer 360, the dashboard, or the agent tools -- those all read nps_responses only.';


-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- No policies, matching 0016/0021: every read/write goes through server routes
-- using the service-role client. The public survey page/route also uses the
-- service role -- survey_token is the auth, not RLS.

alter table nps_campaigns            enable row level security;
alter table nps_campaign_recipients  enable row level security;
alter table nps_response_details     enable row level security;
