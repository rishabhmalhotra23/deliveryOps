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
  // Renamed from "migration_processes" by migration 0021, which widened the table
  // from a V2-migration tracker into the record for every delivery process. The
  // key stays `migrationProcesses` for now so lib/migrations/store.ts keeps
  // compiling; it is renamed alongside the process/project vocabulary sweep.
  migrationProcesses: "processes",
  processes: "processes",
  processSuggestions: "process_suggestions",
  npsResponses: "nps_responses",
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

// ── migration_processes (0019) ──────────────────────────────────────────────
// The live V2 migration tracker. Source of truth for the weekly report V2 tile
// and the Slack status-change notifier. See lib/migrations/.

export const MIGRATION_STAGES = [
  "not_required",
  "in_development",
  "engg_pending",
  "parity_testing",
  "customer_validation",
  "live_on_v2",
  "v2_native",
  "migrated_pending_commercial",
] as const;

export type MigrationStage = (typeof MIGRATION_STAGES)[number];

export const MIGRATION_STAGE_LABELS: Record<MigrationStage, string> = {
  not_required: "Not required",
  in_development: "In development",
  engg_pending: "Engg pending",
  parity_testing: "Parity testing",
  customer_validation: "Customer validation",
  live_on_v2: "Live on v2",
  v2_native: "V2 native",
  migrated_pending_commercial: "Migrated, pending commercial",
};

// Stages that count as actively migrating — drives the "in flight" metric.
export const IN_FLIGHT_STAGES: MigrationStage[] = [
  "in_development",
  "engg_pending",
  "parity_testing",
  "customer_validation",
];

// Entering this stage fires the Slack notifier (once, guarded by went_live_at).
export const MIGRATION_DONE_STAGE: MigrationStage = "live_on_v2";

export interface MigrationProcess {
  id: string;
  account: string;
  customer_key: string | null;
  process_name: string;
  process_status: string | null;
  platform: string | null;
  migration_stage: MigrationStage;
  is_blocked: boolean;
  priority: string | null;
  fde_owner: string | null;
  engg_owner: string | null;
  date_parity_complete: string | null;
  date_customer_handover: string | null;
  date_customer_validation: string | null;
  go_live_date: string | null;
  completion_pct: number | null;
  effort_required: string | null;
  went_live_at: string | null;
  active_usage: string | null;
  customer_notified: string | null;
  customer_contact: string | null;
  blockers: string | null;
  notes: string | null;
  feature_delta: string | null;
  linear_ticket_ids: string[];
  v2_workspace_url: string | null;
  arr: number | null;
  company_size: string | null;
  source_phase: string | null;
  source_board: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── processes (0021) ────────────────────────────────────────────────────────
// 0021 renamed migration_processes -> processes and widened it into the record
// for every delivery process, not just the V2 ones. The orthogonal taxonomy
// below replaces Monday's blended columns: `Current Phase` mixed milestones with
// terminal and waiting states across 15 values, and `Health` was 91-of-146
// "Finished", which is a lifecycle value, not a health value.
//
// Docs: docs/PROCESSES-SCHEMA-PROPOSAL.md, docs/MONDAY-DECOMMISSION-LOG.md

export const PROCESS_LIFECYCLES = [
  "backlog",
  "upcoming",
  "discovery",
  "in_development",
  "uat",
  "live",
  "on_hold",
  "cancelled",
  "churned",
  "retired",
] as const;
export type ProcessLifecycle = (typeof PROCESS_LIFECYCLES)[number];

export const PROCESS_PHASES = [
  "pre_kickoff",
  "m1_discovery",
  "m2_development",
  "m3_testing_uat",
  "m4_deployment",
  "m5_exception_handling",
] as const;
export type ProcessPhase = (typeof PROCESS_PHASES)[number];

export const PROCESS_HEALTHS = ["on_track", "at_risk", "off_track"] as const;
export type ProcessHealth = (typeof PROCESS_HEALTHS)[number];

export const PROCESS_BLOCKED_ON = [
  "none",
  "customer",
  "kognitos_engg",
  "kognitos_delivery",
  "partner",
] as const;
export type ProcessBlockedOn = (typeof PROCESS_BLOCKED_ON)[number];

export const PROCESS_WORK_MODES = [
  "steady_state",
  "exception_handling",
  "enhancement",
  "support",
] as const;
export type ProcessWorkMode = (typeof PROCESS_WORK_MODES)[number];

export const PROCESS_PLATFORMS = ["v1", "v2", "custom"] as const;
export type ProcessPlatform = (typeof PROCESS_PLATFORMS)[number];

// The three views of `processes` approved at step 1.5. Active work is one screen
// covering everything the team is actively doing, including V2 migration effort.
// Counts at import time: active 30, delivered 71, archive 45 (146 total).
export const ACTIVE_LIFECYCLES: ProcessLifecycle[] = [
  "backlog",
  "upcoming",
  "discovery",
  "in_development",
  "uat",
  "on_hold",
];
export const DELIVERED_LIFECYCLES: ProcessLifecycle[] = ["live"];
export const ARCHIVE_LIFECYCLES: ProcessLifecycle[] = ["cancelled", "churned", "retired"];

export type ProcessView = "active" | "delivered" | "archive";

export const LIFECYCLES_BY_VIEW: Record<ProcessView, ProcessLifecycle[]> = {
  active: ACTIVE_LIFECYCLES,
  delivered: DELIVERED_LIFECYCLES,
  archive: ARCHIVE_LIFECYCLES,
};

// `platform` is narrowed and non-null after 0021's enum conversion, so it is
// replaced rather than intersected.
export interface Process extends Omit<MigrationProcess, "platform"> {
  platform: ProcessPlatform;

  lifecycle: ProcessLifecycle;
  phase: ProcessPhase | null;
  health: ProcessHealth | null;
  blocked_on: ProcessBlockedOn;
  work_mode: ProcessWorkMode | null;
  complexity: string | null;

  customer_id: string | null;
  k2_process_id: string | null;
  k2_workspace_id: string | null;

  kickoff_date: string | null;
  /** Generated column. Read-only — writes are rejected by Postgres. */
  ttv_days: number | null;

  tam_owner: string | null;
  partner: string | null;

  total_effort_hours: number | null;
  value_minutes_saved_per_run: number | null;
  value_basis: string | null;
  value_confirmed_by: string | null;
  value_confirmed_at: string | null;

  reviewed_at: string | null;
  reviewed_by: string | null;
  field_provenance: Record<string, { by: string; at: string }>;

  source_system: string | null;
  source_item_id: string | null;
  source_raw: Record<string, unknown>;

  needs_attention: boolean;
  needs_attention_reason: string | null;
}

/** Columns Postgres computes. Never send these in an insert or update. */
export const PROCESS_GENERATED_COLUMNS = ["ttv_days"] as const;

// ── process_suggestions (0021) ──────────────────────────────────────────────
// Slack, Linear, Gmail, Kognitos and the agent propose; a human accepts. Nothing
// external writes to `processes` directly, because a wrong auto-update is worse
// than a stale row — a stale row is at least visibly stale.
//
// Rule (Rishabh, 2026-08-03): conflicts ALWAYS surface both values. A suggestion
// is never dropped just because a human recently set the field; the human may be
// the one who is out of date.

export const SUGGESTION_STATUSES = ["open", "accepted", "rejected", "superseded"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_SOURCES = ["slack", "linear", "gmail", "k2", "agent"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export interface ProcessSuggestion {
  id: string;
  process_id: string;
  field: string;
  current_value: string | null;
  suggested_value: string | null;
  source: SuggestionSource;
  source_ref: string | null;
  rationale: string | null;
  /** 0-1, or null when the source has no confidence signal. */
  confidence: number | null;
  status: SuggestionStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── nps_responses (0021) ────────────────────────────────────────────────────
// 87 responses imported from the Monday NPS Tracking board, Q2'24 to Q4'25.
// The surface is deferred; the table exists so the data has a home.

export interface NpsResponse {
  id: string;
  customer_id: string;
  respondent_name: string;
  respondent_type: string | null;
  quarter: string;
  response_date: string;
  score: number;
  product_satisfaction: string | null;
  feedback: string | null;
  source_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export type NpsCategory = "promoter" | "passive" | "detractor";

/**
 * Derived from the score, never stored. Monday stored this alongside the score,
 * which let the two disagree.
 */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

// ── customers / internal_profiles additions (0021) ──────────────────────────
// Monday's single "Account Type" column conflated two orthogonal axes. Account
// type is Direct or Partner-managed; deal type is Long-term or POV.

export const ACCOUNT_TYPES = ["direct", "partner_managed"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const DEAL_TYPES = ["long_term", "pov"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

/**
 * The four-axis health scorecard on internal_profiles. 1 = critical,
 * 2 = moderate, 3 = strong, null = not assessed (Monday's "Evaluating").
 *
 * These replace `internal_profiles.health_score`, an int 0-100 nobody can
 * defend. Overall customer health becomes auto-derived from cross-system signals
 * later; these four stay as human judgment, because champion strength and
 * exec-sponsor engagement are not derivable from any system.
 */
export const HEALTH_AXES = [
  "renewal_health",
  "pipeline_health",
  "champion_health",
  "exec_sponsor_health",
] as const;
export type HealthAxis = (typeof HEALTH_AXES)[number];
export type HealthAxisScore = 1 | 2 | 3;

export const HEALTH_AXIS_LABELS: Record<HealthAxis, string> = {
  renewal_health: "Renewal",
  pipeline_health: "Pipeline",
  champion_health: "Champion",
  exec_sponsor_health: "Exec sponsor",
};

export const HEALTH_SCORE_LABELS: Record<HealthAxisScore, string> = {
  1: "critical",
  2: "moderate",
  3: "strong",
};
