import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.warn("Supabase credentials missing — chat persistence disabled");
}

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const supabaseAdmin = url && serviceKey ? createClient(url, serviceKey) : null;

/**
 * Project-specific table names. Rename this prefix to match your automation
 * (e.g. "invoice_processing_sessions") so multiple apps can share one
 * Supabase project without collisions.
 */
export const TABLES = {
  sessions: "chat_sessions",
  messages: "chat_messages",
} as const;
