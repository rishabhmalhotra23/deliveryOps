import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// /login is now a thin redirect. Auth0 handles the actual login UI
// (Universal Login page, Google OAuth, etc.).
//
// If the user is already signed in, send them to the dashboard.
// If not, send them to the Auth0 login flow. We keep this page so
// the middleware has a /login destination that isn't an Auth0 route
// (which prevents a redirect loop) and so the ?error=domain message
// can be displayed.

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const params = await searchParams;

  // Already signed in → go to dashboard.
  const user = await getCurrentUser();
  if (user) redirect(params.returnTo ?? "/dashboard");

  // Domain error — user signed in with a non-kognitos.com account.
  if (params.error === "domain") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--background)] px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="text-display text-3xl tracking-tighter font-semibold text-[color:var(--foreground)]">
            DeliveryOps
          </div>
          <div className="glass-card p-8 space-y-4">
            <div className="text-red-600 dark:text-red-400 text-sm font-medium">
              Access restricted to @kognitos.com accounts.
            </div>
            <p className="text-sm text-[color:var(--muted-foreground)]">
              The account you signed in with isn&apos;t a kognitos.com email. Sign out
              and try again with your kognitos.com Google account.
            </p>
            <a
              href="/api/auth/login"
              className="block btn-primary rounded-xl py-2.5 text-sm font-semibold text-center"
            >
              Sign in with Google
            </a>
          </div>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Trouble signing in? Ping <span className="font-medium">#deliveryops</span>.
          </p>
        </div>
      </div>
    );
  }

  // No session and no error → bounce directly to Auth0.
  redirect(`/api/auth/login${params.returnTo ? `?returnTo=${encodeURIComponent(params.returnTo)}` : ""}`);
}
