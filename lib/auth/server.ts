// Auth helpers used by server components, server actions, and route handlers
// inside the (app) group. Centralises the "who's signed in" + "is it allowed"
// checks so route code never reads cookies or env vars directly.

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server-cookies";

// Email-domain restriction. Production: only @kognitos.com (the VISION rule).
// In local dev (no NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN set), defaults to
// kognitos.com — keeping the same gate as prod by default. Override via env if
// a contractor / partner needs in temporarily.
const ALLOWED_DOMAIN = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "kognitos.com").toLowerCase();

export interface CurrentUser {
  id: string;
  email: string;
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;
  if (!isAllowedEmail(data.user.email)) return null;
  return { id: data.user.id, email: data.user.email };
}

// Convenience wrapper for server components / route handlers that should
// 401 / redirect when there's no signed-in user. Middleware handles the
// happy-path redirect already; this is the second line of defence in case a
// route gets registered without going through the matcher.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export { ALLOWED_DOMAIN };
