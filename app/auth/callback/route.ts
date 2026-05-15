// OAuth + magic-link callback. Exchanges the auth code for a session, then
// enforces the email-domain restriction server-side. The client-side `hd`
// hint to Google is just UX — this is the actual gate.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAllowedEmail } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next") ?? "/dashboard";
  // Defend against open-redirect: only allow same-origin paths.
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/dashboard";

  if (!code) {
    url.pathname = "/login";
    url.search = "?error=callback";
    return NextResponse.redirect(url);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    url.pathname = "/login";
    url.search = "?error=callback";
    return NextResponse.redirect(url);
  }

  // Build the response first so the cookie helpers below can mutate its
  // Set-Cookie headers as the SDK refreshes the session.
  let response = NextResponse.redirect(new URL(next, request.url));

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set({ name, value, ...(options as CookieOptions) });
        }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    const fail = request.nextUrl.clone();
    fail.pathname = "/login";
    fail.search = "?error=callback";
    return NextResponse.redirect(fail);
  }

  // Enforce the email-domain restriction. If somebody slipped through Google's
  // hd hint with a non-kognitos.com account, sign them out immediately and
  // bounce them back to login with an explanatory error.
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    const fail = request.nextUrl.clone();
    fail.pathname = "/login";
    fail.search = "?error=domain";
    return NextResponse.redirect(fail);
  }

  return response;
}
