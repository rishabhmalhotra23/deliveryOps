-- Pending approvals — Slack-mediated human approval for email drafts +
-- gated agent actions. Port of legacy/approvals/email_approval.py and
-- legacy/approvals/action_approval.py, but persisted in Postgres so the
-- flow survives serverless cold starts.
--
-- Each row represents one approval card posted in Slack. The card carries
-- the approval_id as its button value; the interactive handler looks the
-- row up here, runs the underlying tool on approve, and updates state.

create type approval_kind as enum ('email_draft', 'gated_action');
create type approval_state as enum ('pending', 'approved', 'rejected', 'revised', 'expired');

create table pending_approvals (
  id                          text primary key,
  customer_id                 uuid not null references customers(id) on delete cascade,
  kind                        approval_kind not null,
  state                       approval_state not null default 'pending',

  -- The tool the agent originally invoked. For gated_action this is the
  -- target tool (e.g. update_customer_profile). For email_draft it's
  -- always "send_email" so the same execute path runs on approve.
  tool_name                   text not null,
  tool_input                  jsonb not null default '{}'::jsonb,

  -- Email-draft denormalised preview fields (faster Slack render).
  email_to                    text[],
  email_subject               text,
  email_body                  text,
  -- When this is a reply, threading metadata from the original inbound
  -- Gmail message so the outbound preserves the conversation.
  email_in_reply_to           text,
  email_references            text,
  email_gmail_thread_id       text,

  -- Slack card placement — where to update / where threads route back from.
  slack_channel               text,
  slack_message_ts            text,
  slack_thread_ts             text,

  -- Audit.
  created_by                  text default 'agent',
  created_at                  timestamptz not null default now(),
  decided_by                  text,
  decided_at                  timestamptz,
  decision_note               text,

  -- Revisions: append-only history. Each entry is
  --   { at, by, kind ('user_edit' | 'agent_revise'), patch }.
  revisions                   jsonb not null default '[]'::jsonb,
  updated_at                  timestamptz not null default now()
);

create trigger pending_approvals_set_updated_at before update on pending_approvals
for each row execute function set_updated_at();

create index pending_approvals_state_idx on pending_approvals (state, created_at desc);
create index pending_approvals_slack_thread_idx
  on pending_approvals (slack_thread_ts) where slack_thread_ts is not null;
create index pending_approvals_customer_idx
  on pending_approvals (customer_id, state, created_at desc);

alter table pending_approvals enable row level security;
-- Phase-1: keep open. Locks down with the rest of the RLS in Phase 3.
create policy pending_approvals_all on pending_approvals for all using (true);

comment on table pending_approvals is
  'Slack-mediated approval queue for email drafts and gated agent actions. One row per approval card.';
