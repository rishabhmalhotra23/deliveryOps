// Middleware-only Supabase client. Reads + refreshes the session cookie on
// every request so server components downstream see a fresh user. Pulled out
// of `./server-cookies` because the middleware runs in the edge runtime and
// uses the NextRequest/NextResponse cookie API instead of next/headers.

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export interface SessionCheck {
  response: NextResponse;
  user: { id: string; email: string | null } | null;
}

export async function refreshSession(request: NextRequest): Promise<SessionCheck> {
  let response = NextResponse.next({ request });

  if (!url || !anonKey) {
    // No Supabase configured — let the request through; downstream code falls
    // back to the unauthenticated path. Local-boot only.
    return { response, user: null };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set({ name, value, ...options });
        }
      },
    },
  });

  // getUser() validates the JWT against the Supabase Auth server; getSession()
  // would only read the cookie locally without verification. Always use
  // getUser() for security-sensitive checks.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { response, user: null };

  return {
    response,
    user: { id: data.user.id, email: data.user.email ?? null },
  };
}
