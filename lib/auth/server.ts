// Auth helpers used by server components + route handlers.
// All calls go through Auth0 — never Supabase Auth.

import { redirect } from "next/navigation";
import { auth0, isAllowedEmail, ALLOWED_DOMAIN } from "@/lib/auth/auth0";

export { isAllowedEmail, ALLOWED_DOMAIN };

export interface CurrentUser {
  id: string;       // Auth0 subject (sub)
  email: string;
  name: string | null;
  picture: string | null;
}

const auth0Configured = Boolean(
  process.env.AUTH0_SECRET && process.env.AUTH0_ISSUER_BASE_URL && process.env.AUTH0_CLIENT_ID
);

export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Return null gracefully when Auth0 isn't configured (local dev without credentials).
  if (!auth0Configured) return null;
  try {
    const session = await auth0.getSession();
    if (!session?.user) return null;
    const email = session.user.email ?? null;
    if (!isAllowedEmail(email)) return null;
    return {
      id: session.user.sub,
      email: email!,
      name: session.user.name ?? null,
      picture: session.user.picture ?? null,
    };
  } catch {
    return null;
  }
}

// Use in server components / route handlers that require auth. Redirects
// to Auth0 Universal Login if there's no session.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/login");
  return user;
}
