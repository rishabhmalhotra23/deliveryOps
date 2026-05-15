"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

const ALLOWED_DOMAIN = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "kognitos.com").toLowerCase();

interface Props {
  next: string;
}

export function LoginForm({ next }: Props) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : "/auth/callback";

  async function signInWithGoogle() {
    if (!supabase) {
      setEmailError("Supabase isn't configured. Check the README for local-dev setup.");
      return;
    }
    setPending("google");
    setEmailError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        // Hint to Google's chooser that we want a kognitos.com account.
        // Server-side enforcement is in /auth/callback.
        queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
      },
    });
    if (error) {
      setPending(null);
      setEmailError(error.message);
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    if (!supabase) {
      setEmailError("Supabase isn't configured.");
      return;
    }
    if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
      setEmailError(`Use your @${ALLOWED_DOMAIN} email.`);
      return;
    }
    setPending("email");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl, shouldCreateUser: true },
    });
    setPending(null);
    if (error) {
      setEmailError(error.message);
      return;
    }
    setEmailSent(true);
  }

  if (emailSent) {
    return (
      <div className="rounded-lg border border-[var(--glass-border)] px-4 py-5 text-sm">
        <div className="font-semibold text-[color:var(--foreground)] mb-1">Check your email</div>
        <p className="text-[color:var(--muted-foreground)]">
          A sign-in link is on its way to <span className="font-medium">{email}</span>. It expires in 60 minutes.
        </p>
        <p className="text-[color:var(--muted-foreground)] mt-2">
          Local dev: open Supabase Inbucket at{" "}
          <a className="underline" href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
            localhost:54324
          </a>{" "}
          to grab it.
        </p>
        <button
          onClick={() => { setEmailSent(false); setEmail(""); }}
          className="mt-3 text-xs text-[color:var(--muted-foreground)] underline"
        >
          Try a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        onClick={signInWithGoogle}
        disabled={pending !== null}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--glass-border)] bg-white dark:bg-[color:var(--brand-night-soft)] px-4 py-2.5 text-sm font-medium text-[color:var(--foreground)] hover:bg-[color:var(--brand-seasalt)] dark:hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 transition-colors"
      >
        <GoogleGlyph />
        {pending === "google" ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        <div className="flex-1 h-px bg-[var(--glass-border)]" />
        or
        <div className="flex-1 h-px bg-[var(--glass-border)]" />
      </div>

      <form onSubmit={signInWithEmail} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder={`you@${ALLOWED_DOMAIN}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-[var(--glass-border)] bg-[color:var(--background)] px-3 py-2.5 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]/40"
        />
        <button
          type="submit"
          disabled={pending !== null || !email}
          className="w-full btn-primary inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {pending === "email" ? "Sending link…" : "Email me a sign-in link"}
        </button>
        {emailError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{emailError}</p>
        ) : null}
      </form>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.997 3.018v2.504h3.232c1.89-1.74 2.983-4.305 2.983-7.345Z" fill="#4285F4"/>
      <path d="M12 22c2.7 0 4.964-.895 6.617-2.428l-3.232-2.504c-.895.6-2.04.955-3.385.955-2.605 0-4.81-1.76-5.595-4.123H3.064v2.586A9.996 9.996 0 0 0 12 22Z" fill="#34A853"/>
      <path d="M6.405 13.9A6 6 0 0 1 6.09 12c0-.66.114-1.302.314-1.9V7.514H3.064A9.996 9.996 0 0 0 2 12c0 1.614.386 3.14 1.064 4.486l3.341-2.586Z" fill="#FBBC05"/>
      <path d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C16.96 2.99 14.696 2 12 2A9.996 9.996 0 0 0 3.064 7.514l3.341 2.586C7.19 7.736 9.395 5.977 12 5.977Z" fill="#EA4335"/>
    </svg>
  );
}
