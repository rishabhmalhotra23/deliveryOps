-- DeliveryOps chat persistence — sessions + messages for the agent chat UI.
-- Inherited from kognitos-app-template (supabase/migrations/00000000000001_chat.sql).
-- These back the existing app/api/chat/* routes and lib/chat/chat-context.tsx.
--
-- In Phase 1, sessions get scoped to a customer (customer_id fk) when the
-- agent loop is fully wired into the dashboard. For now, prefix stays generic.

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text default 'default',
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_call jsonb,
  created_at timestamptz default now()
);

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create policy chat_sessions_open on chat_sessions for all using (true) with check (true);
create policy chat_messages_open on chat_messages for all using (true) with check (true);
