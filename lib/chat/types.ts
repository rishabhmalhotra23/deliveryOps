export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call?: ToolCallData | null;
  created_at: string;
}

export interface ToolCallData {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result?: string;
}

export interface ChatStreamEvent {
  type: "text" | "tool_use" | "tool_result" | "done" | "error" | "title";
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}
