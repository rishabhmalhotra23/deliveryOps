// Root middleware — gates the dashboard behind an Auth0 session.
//
// Auth0 session comes from the cookie set by /api/auth/callback. The SDK
// validates it on every request without hitting Auth0's servers (JWT local
// verification).
//
// Public routes that bypass the gate:
//   /login                 — the "click here to sign in" page
//   /api/auth/*            — Auth0 login/logout/callback handlers
//   /api/slack/            — webhook, signature-authed
//   /api/gmail/            — webhook, token-authed
//   /api/cron/             — Vercel cron, CRON_SECRET-authed
//   /api/jobs/             — internal fire-and-forget, JOBS_SECRET-authed
//   /api/monday/           — webhook, secret-authed
//   /_next/, /favicon.ico  — static assets

import { type NextRequest, NextResponse } from "next/server";
import { auth0, isAllowedEmail } from "@/lib/auth/auth0";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",        // Auth0 login / logout / callback
  "/api/slack/",
  "/api/gmail/",
  "/api/cron/",
  "/api/jobs/",
  "/api/monday/",
  "/_next/",
  "/favicon.ico",
];

// /dev/* stays public in development so the recovery runbook works without
// needing a session. In production it gets blocked by auth.
const DEV_ONLY_PUBLIC = ["/api/dev/", "/dev/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (process.env.NODE_ENV !== "production") {
    if (DEV_ONLY_PUBLIC.some((p) => pathname.startsWith(p))) return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    // Let Auth0 handle session cookie refresh on public paths too.
    return await auth0.middleware(request);
  }

  // Check for a valid Auth0 session.
  const response = await auth0.middleware(request);
  const session = await auth0.getSession(request);

  if (!session?.user) {
    // No session → send to Auth0 Universal Login.
    const loginUrl = new URL("/api/auth/login", request.url);
    loginUrl.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Extra domain check in case the Auth0 Action isn't set up yet.
  if (!isAllowedEmail(session.user.email)) {
    const logoutUrl = new URL("/api/auth/logout", request.url);
    logoutUrl.searchParams.set("returnTo", "/login?error=domain");
    return NextResponse.redirect(logoutUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
