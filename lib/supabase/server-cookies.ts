// Cookie-aware Supabase clients used in server components and route handlers
// where the request is on behalf of a signed-in user. These talk to the anon
// endpoint with the user's JWT — RLS applies as that user.
//
// For background work (Inngest functions, cron, sync runners, the agent's
// tools) keep using `supabaseAdmin` from `./server` — it bypasses RLS via the
// service-role key.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Use inside server components, server actions, and route handlers in the
// (app) group. Returns null if Supabase isn't configured (local boot before
// .env.local is wired) so callers can fall back to a no-auth path.
export async function createServerSupabase(): Promise<SupabaseClient | null> {
  if (!url || !anonKey) return null;
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set({ name, value, ...(options as CookieOptions) });
          }
        } catch {
          // Server components can't set cookies — that's fine, the middleware
          // refreshes the session on the next request anyway.
        }
      },
    },
  });
}
