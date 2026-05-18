// Auth0 singleton. Every server-side auth call goes through this.
//
// Required env vars (add to .env.local for dev, Vercel dashboard for prod):
//   AUTH0_SECRET        — random 32+ char string (openssl rand -hex 32)
//   APP_BASE_URL        — http://localhost:4001 (dev) or https://<domain> (prod)
//   AUTH0_DOMAIN        — <tenant>.us.auth0.com  (no https://)
//   AUTH0_CLIENT_ID     — from Auth0 Application settings
//   AUTH0_CLIENT_SECRET — from Auth0 Application settings
//
// Auth0 Application settings (configure in Auth0 dashboard):
//   Type:             Regular Web Application
//   Allowed callbacks: http://localhost:4001/api/auth/callback,
//                      https://delivery-ops-delta.vercel.app/api/auth/callback
//   Allowed logouts:  http://localhost:4001,
//                     https://delivery-ops-delta.vercel.app
//   Allowed web origins: (same as above)
//   Social connections: Google (enable)
//
// Auth0 Action (Login flow) — enforce @kognitos.com only:
//   exports.onExecutePostLogin = async (event, api) => {
//     if (!(event.user.email ?? "").toLowerCase().endsWith("@kognitos.com")) {
//       api.access.deny("Only @kognitos.com accounts are allowed.");
//     }
//   };

import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  // Override the default /auth/* paths to /api/auth/* so auth routes live
  // alongside API routes. Must match the Allowed Callback URLs in Auth0.
  routes: {
    login:    "/api/auth/login",
    logout:   "/api/auth/logout",
    callback: "/api/auth/callback",
  },
  authorizationParameters: {
    scope: "openid profile email offline_access",
    // Hint Google's chooser to kognitos.com accounts first.
    // The Auth0 Action enforces this server-side.
    hd: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "kognitos.com",
  },
});

export const ALLOWED_DOMAIN =
  (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "kognitos.com").toLowerCase();

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}
