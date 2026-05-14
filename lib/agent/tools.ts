// Agent tool definitions — port of legacy/brain/tools.py CURATOR_TOOLS.
// Schemas are passed to Claude verbatim; handlers in lib/agent/handlers.ts
// dispatch each tool name to a TS implementation.

import type Anthropic from "@anthropic-ai/sdk";

export const DELIVERY_OPS_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_customer_docs",
    description:
      "Search a customer's document library. Tries exact match first, then semantic search. Use this to find contracts, SOPs, meeting notes, and other ingested files.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        scope: {
          type: "string",
          enum: ["all", "contracts", "meeting-notes", "sops", "events", "support"],
          description: "Limit search to a specific document category.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "log_event",
    description: "Log an event to the customer's event log.",
    input_schema: {
      type: "object",
      properties: {
        event_type: {
          type: "string",
          enum: [
            "EXCEPTION",
            "DOCUMENT_INGESTED",
            "HUMAN_NOTE",
            "ESCALATION",
            "MILESTONE",
            "CONTACT_CHANGE",
          ],
        },
        summary: { type: "string" },
        details: { type: "object" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["event_type", "summary"],
    },
  },
  {
    name: "get_customer_profile",
    description:
      "Get the customer-facing profile: company info, contract, adoption metrics, contacts, goals, and any custom fields. Does NOT include internal-only data (health score, churn risk).",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_customer_profile",
    description:
      "Update fields in the customer profile. You can update existing values or add new custom fields. You CANNOT delete or rename existing schema fields. Unknown keys are stored under 'custom'. Pass a flat object of field_name → new_value.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "object",
          description:
            "Object of field_name → new_value. Schema fields: industry, employee_count, website, headquarters, fiscal_year_end, tier, start_date, renewal_date, arr, credit_limit, billing_contact, deployment_stage, automations_live, active_users, credits_used_mtd, last_active_date, contacts (array of {name, role, email, phone, notes}), business_objectives, success_criteria, target_roi. Any other key goes into 'custom'.",
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "get_credit_usage",
    description: "Get credit consumption and utilisation for this customer.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "send_slack_message",
    description: "Send a message to the customer's Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string" },
        internal_only: {
          type: "boolean",
          description: "If true, post to the internal CS channel instead.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "send_email",
    description:
      "Draft an email from the customer's alias. The draft posts to the customer's Slack channel for human approval before sending. Reviewers can approve, reject, or reply in the thread to request changes.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description:
                  "Path relative to the customer's library, e.g. 'original_docs/contracts/sow.pdf'. Use search_customer_docs to find available files.",
              },
            },
            required: ["file_path"],
          },
          description: "Optional list of files from the knowledge base to attach.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "revise_email_draft",
    description:
      "Revise a pending email draft awaiting approval in Slack. Use this when someone replies in an email approval thread requesting changes. Provide the approval_id and any fields to update. A fresh preview is posted in the thread.",
    input_schema: {
      type: "object",
      properties: {
        approval_id: {
          type: "string",
          description: "The approval ID of the pending draft.",
        },
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        add_attachments: {
          type: "array",
          items: {
            type: "object",
            properties: { file_path: { type: "string" } },
            required: ["file_path"],
          },
        },
        remove_attachments: {
          type: "array",
          items: { type: "string" },
          description: "Filenames to remove from the draft.",
        },
      },
      required: ["approval_id"],
    },
  },
  {
    name: "revise_pending_action",
    description:
      "Revise a pending action (profile update, rules update) awaiting approval in Slack. Use this when someone replies in an action approval thread requesting changes. Provide the approval_id and the updates to merge.",
    input_schema: {
      type: "object",
      properties: {
        approval_id: { type: "string" },
        updates: {
          type: "object",
          description:
            "Fields to update. For update_customer_profile, merge into the profile updates. For update_customer_rules, provide { rules: '...' }.",
        },
      },
      required: ["approval_id", "updates"],
    },
  },
  {
    name: "escalate_to_human",
    description: "Flag something for human CS team attention in the internal channel.",
    input_schema: {
      type: "object",
      properties: {
        urgency: { type: "string", enum: ["low", "medium", "high"] },
        reason: { type: "string" },
        suggested_action: { type: "string" },
      },
      required: ["urgency", "reason"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a scheduled task or reminder. Can be a one-shot reminder, a recurring check, or a cron-style job. The task will fire at the specified time and execute the given action.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        schedule: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["once", "recurring", "cron"] },
            at: {
              type: "string",
              description:
                "ISO datetime for one-shot, e.g. '2026-02-18T09:00:00-08:00'.",
            },
            every: {
              type: "string",
              description: "For recurring: '1h', '4h', '1d', '1w'.",
            },
            cron: {
              type: "string",
              description: "Cron expression, e.g. '0 9 * * 1' for Monday 09:00 UTC.",
            },
            until: { type: "string", description: "Optional end date for recurring tasks." },
          },
          required: ["type"],
        },
        action: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["remind", "check", "run_prompt"] },
            channel: { type: "string", enum: ["slack", "email", "internal"] },
            prompt: {
              type: "string",
              description: "For 'run_prompt': what the agent should do when the task fires.",
            },
            message: {
              type: "string",
              description: "For 'remind': the reminder message to send.",
            },
          },
          required: ["type"],
        },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["description", "schedule", "action"],
    },
  },
  {
    name: "list_tasks",
    description: "List scheduled tasks and reminders for this customer.",
    input_schema: {
      type: "object",
      properties: {
        include_completed: {
          type: "boolean",
          description: "Whether to include completed/cancelled tasks.",
        },
      },
    },
  },
  {
    name: "cancel_task",
    description: "Cancel a scheduled task by ID.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "get_slack_history",
    description:
      "Fetch recent messages from the customer's Slack channel. Use this to understand prior conversation context.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Number of recent messages to fetch (default 25, max 100).",
        },
      },
    },
  },
  {
    name: "get_customer_rules",
    description:
      "Get the customer-specific rules (dos and don'ts) that guide your behavior for this customer. These rules are already injected into your system prompt — use this when you need to quote or edit them.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_customer_rules",
    description:
      "Replace the customer-specific rules with new content. Provide the complete updated markdown — this fully replaces the existing rules. Use when you learn new preferences, policies, or constraints about the customer that should guide all future interactions.",
    input_schema: {
      type: "object",
      properties: {
        rules: { type: "string", description: "The full updated rules as Markdown." },
      },
      required: ["rules"],
    },
    // Anthropic prompt caching: marking the LAST tool with cache_control
    // caches the entire tools block. Since tool definitions virtually never
    // change between calls, this is effectively a one-time cost per ~5 min
    // window. https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
    cache_control: { type: "ephemeral" },
  },
];

// Tools that mutate state on the customer side and need human approval when
// triggered by an inbound email. The Slack listener queues these instead of
// running them directly.
export const GATED_TOOLS_EMAIL = new Set<string>([
  "update_customer_profile",
  "update_customer_rules",
]);
