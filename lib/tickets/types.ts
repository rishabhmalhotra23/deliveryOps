// Shared types for the Linear ticket tracker (see supabase/migrations/
// 0017_linear_tickets.sql). Two concerns, kept separate throughout this
// module: raw Linear fields (kept fresh by lib/sync/linear-tickets.ts) and
// the judgment layer (classification/confidence/rationale/domain/in_scope),
// which is filled in by a periodic Claude-assisted review, not computed.

export type TicketClassification =
  | "hard_blocker"
  | "workaround_exists"
  | "transient_retry"
  | "just_a_bug";

export type TicketConfidence = "certain" | "likely" | "guessing";

export type TicketDomain =
  | "idp_document_processing"
  | "browser_automation"
  | "integrations_connectors"
  | "drafts_quill_ux"
  | "live_automations_runtime"
  | "platform_infra"
  | "other";

export type AskPriorityTier = "now" | "soon" | "later";
export type AskStatus = "open" | "in_progress" | "done";

export interface TicketRow {
  id: string; // Linear identifier, e.g. "KOG-11842"
  title: string;
  url: string;
  team: string | null;
  project: string | null;
  source: string;
  priority: string | null;
  linear_status: string;
  status_type: string;
  linear_created_at: string;
  closed_at: string | null;
  in_scope: boolean;
  classification: TicketClassification | null;
  confidence: TicketConfidence | null;
  rationale: string | null;
  domain: TicketDomain | null;
  classified_at: string | null;
  manual_override: boolean;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface TeamAsk {
  id: string;
  ask_text: string;
  requester: string;
  priority_tier: AskPriorityTier;
  status: AskStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Tickets linked via team_ask_tickets, resolved to id + title for display. */
  tickets: Array<{ id: string; title: string }>;
}

export const CLASSIFICATION_LABELS: Record<TicketClassification, string> = {
  hard_blocker: "Hard blocker",
  workaround_exists: "Workaround exists",
  transient_retry: "Transient / retry",
  just_a_bug: "Just a bug",
};

export const DOMAIN_LABELS: Record<TicketDomain, string> = {
  idp_document_processing: "IDP / document processing",
  browser_automation: "Browser automation",
  integrations_connectors: "Integrations / connectors",
  drafts_quill_ux: "Drafts / Quill UX",
  live_automations_runtime: "Live automations / runtime",
  platform_infra: "Platform / infra",
  other: "Other",
};
