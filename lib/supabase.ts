// Back-compat shim. New code imports directly from `lib/supabase/server` or
// `lib/supabase/client`. This file keeps the inherited template's chat routes
// working without a sweep.

export { supabaseAdmin, supabaseServer as supabase, requireAdmin } from "./supabase/server";
export { TABLES as TABLES_FULL } from "./supabase/types";

// Existing chat routes look up `TABLES.sessions` / `TABLES.messages`.
import { TABLES as ALL_TABLES } from "./supabase/types";
export const TABLES = {
  sessions: ALL_TABLES.chatSessions,
  messages: ALL_TABLES.chatMessages,
} as const;
