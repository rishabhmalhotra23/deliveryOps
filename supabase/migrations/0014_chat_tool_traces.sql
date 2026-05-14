-- Store agent tool traces alongside chat messages so you can audit
-- exactly what tools the agent called, with what inputs and outputs.
-- This is separate from the assistant text message so it doesn't
-- clutter the conversation UI but remains queryable for debugging.

alter table chat_messages
  add column if not exists tool_calls jsonb;

comment on column chat_messages.tool_calls is
  'Array of { name, input, result, duration_ms } objects for tool-use turns. Null for text-only turns.';
