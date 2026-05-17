// Auth0 singleton. Every server-side auth call goes through this.
//
// Required env vars (add to .env.local for dev, Vercel dashboard for prod):
//   AUTH0_SECRET          — random 32+ char string (openssl rand -hex 32)
//   AUTH0_BASE_URL        — http://localhost:4001 (dev) or https://<domain> (prod)
//   AUTH0_ISSUER_BASE_URL — https://<tenant>.auth0.com
//   AUTH0_CLIENT_ID       — from Auth0 Application settings
//   AUTH0_CLIENT_SECRET   — from Auth0 Application settings
//
// Auth0 Application settings (configure in Auth0 dashboard):
//   Type:             Regular Web Application
//   Allowed callbacks: http://localhost:4001/api/auth/callback,
//                      https://delivery-ops-delta.vercel.app/api/auth/callback
//   Allowed logouts:  http://localhost:4001,
//                     https://delivery-ops-delta.vercel.app
//   Allowed web origins: (same as above)
//   Social connections: Google (enable, lock to kognitos.com via Action)
//
// To enforce @kognitos.com only, add this Auth0 Action to the Login flow:
//   exports.onExecutePostLogin = async (event, api) => {
//     const email = event.user.email ?? "";
//     if (!email.endsWith("@kognitos.com")) {
//       api.access.deny("Only @kognitos.com accounts are allowed.");
//     }
//   };

import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  // These are read from env vars automatically by the SDK.
  // Listed here for visibility; do NOT hardcode values.
  // AUTH0_SECRET, AUTH0_BASE_URL, AUTH0_ISSUER_BASE_URL,
  // AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
  //
  // Session config — 7-day absolute session, rolling.
  // See Auth0ClientOptions for full session configuration options.
  authorizationParameters: {
    // Request offline_access so we get a refresh token.
    scope: "openid profile email offline_access",
    // Hint to Google's account chooser to show kognitos.com accounts.
    // The real restriction is enforced by the Auth0 Action above.
    hd: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "kognitos.com",
  },
});

export const ALLOWED_DOMAIN =
  (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "kognitos.com").toLowerCase();

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}
