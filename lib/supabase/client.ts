"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Browser client from @supabase/ssr. Defaults to the PKCE flow, which makes
// OAuth + magic-link redirects come back with `?code=...` in the query string
// (server-readable) instead of `#access_token=...` in the fragment (which the
// /auth/callback server route cannot see). Critical for our auth flow — the
// raw createClient() from supabase-js defaults to the implicit flow and would
// silently break magic-link sign-in.
export const supabase: SupabaseClient | null =
  url && anonKey ? createBrowserClient(url, anonKey) : null;
