// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Phase 3 will replace these with `supabase gen types typescript` output once
// the live project is wired up.

export type ContractTier = "starter" | "growth" | "enterprise";
export type DeploymentStage = "onboarding" | "pilot" | "scaling" | "mature";
export type ChurnRisk = "low" | "medium" | "high";
export type CustomerUserRole = "owner" | "csm" | "viewer";
export type TaskStatus = "active" | "paused" | "completed" | "failed";

export interface Customer {
  id: string;
  key: string;
  display_name: string;
  slack_channel: string | null;
  email_alias: string | null;
  drive_folder_id: string | null;
  monday_item_id: string | null;
  monday_workspace_id: string | null;
  salesforce_account_id: string | null;
  kognitos_v1_department_id: string | null;
  kognitos_v1_workspace_id: string | null;
  kognitos_v2_workspace_id: string | null;
  partner: string | null;
  ae_owner: string | null;
  lifecycle_group: string | null;        // raw Monday signal, kept for reference
  custom_category: string | null;        // DeliveryOps-owned bucket, the operational truth
  deliveryops_protected_fields: string[]; // field names locked from sync overwrite
  last_manually_edited_at: string | null;
  brand_color: string | null;  // hex e.g. "#E2231A" — drives hero accent
  logo_url: string | null;     // manual logo override; falls back to Clearbit
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// DeliveryOps's customer category vocabulary. Free-text in Postgres so the
// agent can mint new ones via chat ("create a category called Strategic
// Logos"); these constants drive the canonical sort order + tones.
export const CUSTOMER_CATEGORIES = [
  "At Risk",
  "Upcoming Renewals",
  "Strategic Growth",
  "Active",
  "Partner Managed",
  "POV",
  "To Drop",
  "Churned",
] as const;

export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export interface ContactRow {
  name: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
}

export interface Profile {
  id: string;
  customer_id: string;
  industry: string;
  employee_count: number;
  website: string;
  headquarters: string;
  fiscal_year_end: string;
  tier: ContractTier | null;
  start_date: string | null;
  renewal_date: string | null;
  arr: number;
  credit_limit: number;
  billing_contact: string;
  deployment_stage: DeploymentStage;
  automations_live: number;
  active_users: number;
  credits_used_mtd: number;
  last_active_date: string | null;
  contacts: ContactRow[];
  business_objectives: string[];
  success_criteria: string[];
  target_roi: string;
  custom: Record<string, unknown>;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InternalProfile {
  id: string;
  customer_id: string;
  health_score: number;
  nps_score: number;
  csat_score: number;
  last_qbr_date: string | null;
  next_qbr_date: string | null;
  churn_risk: ChurnRisk;
  strategic_notes: string;
  internal_notes: string;
  last_updated_by: string | null;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type EventType =
  | "EXCEPTION"
  | "DOCUMENT_INGESTED"
  | "HUMAN_NOTE"
  | "ESCALATION"
  | "MILESTONE"
  | "CONTACT_CHANGE"
  | "SLACK_CONVERSATION"
  | "EMAIL_RECEIVED"
  | "EMAIL_SENT"
  | "TASK_CREATED"
  | "TASK_EXECUTED"
  | "TASK_FAILED"
  | "PROFILE_UPDATED"
  | "RULES_UPDATED";

export interface CuratorEvent {
  id: string;
  customer_id: string;
  event_type: EventType | string;
  summary: string;
  details: Record<string, unknown>;
  tags: string[];
  week_key: string;
  ts: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Rules {
  id: string;
  customer_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type TaskScheduleKind = "once" | "recurring" | "cron";

export interface TaskSchedule {
  type: TaskScheduleKind;
  at?: string;
  every?: string;
  cron?: string;
  until?: string;
}

export type TaskActionKind = "remind" | "check" | "run_prompt";
export type TaskChannel = "slack" | "email" | "internal";

export interface TaskAction {
  type: TaskActionKind;
  channel?: TaskChannel;
  prompt?: string;
  message?: string;
}

export interface CuratorTask {
  id: string;
  customer_id: string;
  name: string;
  description: string | null;
  schedule: TaskSchedule;
  action: TaskAction;
  status: TaskStatus;
  last_run: string | null;
  next_run: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Conversation {
  id: string;
  customer_id: string;
  channel: string;
  user_id: string;
  user_name: string;
  user_message: string;
  bot_response: string;
  ts: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerUser {
  id: string;
  customer_id: string;
  user_id: string;
  role: CustomerUserRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call: Record<string, unknown> | null;
  created_at: string;
}

// Table name constants — single source of truth. Update here when migrations
// rename tables.
export const TABLES = {
  customers: "customers",
  profiles: "profiles",
  internalProfiles: "internal_profiles",
  events: "events",
  rules: "rules",
  tasks: "tasks",
  conversations: "conversations",
  customerUsers: "customer_users",
  chatSessions: "chat_sessions",
  chatMessages: "chat_messages",
  pendingApprovals: "pending_approvals",
} as const;

// ── pending_approvals ──────────────────────────────────────────────────────

export type ApprovalKind = "email_draft" | "gated_action";
export type ApprovalState = "pending" | "approved" | "rejected" | "revised" | "expired";

export interface PendingApprovalRevision {
  at: string;
  by: string;
  kind: "user_edit" | "agent_revise";
  patch: Record<string, unknown>;
}

export interface PendingApproval {
  id: string;
  customer_id: string;
  kind: ApprovalKind;
  state: ApprovalState;
  tool_name: string;
  tool_input: Record<string, unknown>;
  email_to: string[] | null;
  email_subject: string | null;
  email_body: string | null;
  email_in_reply_to: string | null;
  email_references: string | null;
  email_gmail_thread_id: string | null;
  slack_channel: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  revisions: PendingApprovalRevision[];
  updated_at: string;
}
