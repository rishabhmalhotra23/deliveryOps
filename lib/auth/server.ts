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

export async function getCurrentUser(): Promise<CurrentUser | null> {
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
}

// Use in server components / route handlers that require auth. Redirects
// to Auth0 Universal Login if there's no session.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/login");
  return user;
}
