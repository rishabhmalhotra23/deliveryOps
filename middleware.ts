// Root middleware — gates the dashboard behind a Supabase Auth session.
//
// Webhooks (slack/events, gmail/push, inngest, cron/*) bypass the session
// check entirely — they're authenticated by signature/secret instead and a
// 302-to-login response would break the integration.
//
// Local-dev safety: if Supabase isn't configured (anon key missing) we let
// every request through. The server-side code falls back to the unauth path
// and the dev console keeps working without env vars set.

import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/supabase/middleware";
import { isAllowedEmail } from "@/lib/auth/server";

// Routes that must skip auth: webhooks, the auth flow itself, and static
// assets. Anything not matched here goes through the gate.
const PUBLIC_PREFIXES = [
  "/login",
  "/auth/",            // /auth/callback, /auth/sign-out
  "/api/slack/",       // signed by SLACK_SIGNING_SECRET
  "/api/gmail/",       // signed by GMAIL_PUBSUB_VERIFICATION_TOKEN
  "/api/inngest",      // signed by INNGEST_SIGNING_KEY
  "/api/cron/",        // gated by CRON_SECRET (Vercel-injected)
  "/api/monday/",      // signed by Monday webhook secret (legacy + new)
  "/_next/",
  "/favicon.ico",
];

// Local-dev-only bypass for the dev/import/sync APIs. The recovery runbook
// (docs/RUNBOOK.md) uses these endpoints to re-import customers from Monday
// after a wipe — they need to be reachable without a session in dev.
//
// In production these stay gated. The `/dev` UI pages and the `/api/dev/`
// routes are meant for the local dev console, not the live dashboard.
const DEV_ONLY_PUBLIC_PREFIXES = ["/api/dev/", "/dev/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (process.env.NODE_ENV !== "production") {
    if (DEV_ONLY_PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    // Even on public routes we refresh the session cookie so the user pill
    // stays current after navigation. Result is discarded.
    const { response } = await refreshSession(request);
    return response;
  }

  const { response, user } = await refreshSession(request);

  // Local-dev escape hatch: if Supabase Auth isn't configured we don't have
  // anywhere meaningful to redirect to, so let the request through. In prod
  // this branch never fires — env vars are mandatory at deploy time.
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseConfigured) return response;

  // No session, or wrong email domain → bounce to login. Preserve the
  // requested path so we can redirect back after sign-in.
  if (!user || !isAllowedEmail(user.email)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/" && pathname !== "/login") {
      url.searchParams.set("next", pathname + search);
    }
    if (user && !isAllowedEmail(user.email)) {
      url.searchParams.set("error", "domain");
    }
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Match everything except Next internals and static assets — the function
    // body decides which paths skip auth via PUBLIC_PREFIXES.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
