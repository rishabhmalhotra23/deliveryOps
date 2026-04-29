import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let warnedMissing = false;
function warnOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    "Supabase credentials missing — the app will run with all data calls disabled. " +
      "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
}

if (!url || !anonKey) {
  warnOnce();
}

// Service-role client. Bypasses RLS — use only in server-side code (route
// handlers, Inngest functions, server components). Never ship to the browser.
export const supabaseAdmin: SupabaseClient | null =
  url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

// Anon client for server components that need RLS-scoped reads on behalf of
// the signed-in user. Sessions are passed via cookies in Phase 3.
export const supabaseServer: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null;

export function requireAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    throw new Error(
      "Supabase admin client unavailable — set SUPABASE_SERVICE_ROLE_KEY in the environment."
    );
  }
  return supabaseAdmin;
}
