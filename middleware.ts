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

// Auth0 is not configured until AUTH0_SECRET + AUTH0_DOMAIN are set.
// Without them the SDK throws — let the request through so local dev works
// without Auth0 credentials (same pattern as the old Supabase bypass).
const auth0Configured = Boolean(
  process.env.AUTH0_SECRET && process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID
);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Local-dev escape hatch: if Auth0 isn't configured, let everything through.
  // In production AUTH0_SECRET is mandatory — the missing-var check below
  // will throw at build time if it's absent.
  if (!auth0Configured) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Auth0 not configured. Set AUTH0_SECRET, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET.", { status: 500 });
    }
    return NextResponse.next();
  }

  try {
    if (isPublic(pathname)) {
      return await auth0.middleware(request);
    }

    // Check for a valid Auth0 session.
    const response = await auth0.middleware(request);
    const session = await auth0.getSession(request);

    if (!session?.user) {
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
  } catch (err) {
    // Log to Vercel runtime logs so we can see the actual auth0 error.
    console.error("[middleware] error on", pathname, "—",
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err));
    // For auth callbacks, redirect to /login with the error so the user
    // sees something useful rather than a generic 500.
    if (pathname.startsWith("/api/auth/")) {
      const url = new URL("/login", request.url);
      url.searchParams.set("error", "auth_flow");
      url.searchParams.set("detail", err instanceof Error ? err.message : "unknown");
      return NextResponse.redirect(url);
    }
    throw err;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
