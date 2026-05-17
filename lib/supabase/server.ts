// Server-side Supabase clients.
// Authentication is handled by Auth0. These clients are used for data
// operations only — never for auth flows.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let warnedMissing = false;
function warnOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    "Supabase credentials missing — data calls disabled. " +
      "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY."
  );
}

if (!url || !anonKey) warnOnce();

// Service-role client. Bypasses RLS — server-only, never send to the browser.
export const supabaseAdmin: SupabaseClient | null =
  url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false } })
    : null;

// Anon client — kept for any public reads; Auth0 sessions are separate.
export const supabaseServer: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { auth: { persistSession: false } })
    : null;

export function requireAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client unavailable — set SUPABASE_SERVICE_ROLE_KEY.");
  }
  return supabaseAdmin;
}
