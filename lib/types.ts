export type RunState =
  | "completed"
  | "awaiting_guidance"
  | "failed"
  | "executing"
  | "pending"
  | "stopped";

export interface RunOutput {
  table?: { inline?: { data?: string } };
}

export interface RawRun {
  name: string;
  create_time: string;
  update_time?: string;
  state: {
    completed?: {
      outputs?: Record<string, RunOutput>;
      update_time?: string;
    };
    awaiting_guidance?: {
      exception?: string;
      description?: string;
    };
    failed?: {
      error?: string;
      description?: string;
    };
    executing?: Record<string, unknown>;
    pending?: Record<string, unknown>;
    stopped?: Record<string, unknown>;
  };
  user_inputs?: Record<string, { text?: string }>;
  invocation_details?: {
    invocation_source?: string;
    user_id?: string;
  };
}
