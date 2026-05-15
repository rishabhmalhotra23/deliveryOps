import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { LoginForm } from "./_components/login-form";

export const dynamic = "force-dynamic";

interface LoginSearchParams {
  next?: string;
  error?: string;
  message?: string;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const existing = await getCurrentUser();
  if (existing) redirect(params.next ?? "/dashboard");

  const errorCopy: Record<string, string> = {
    domain:
      "Sign-in is restricted to @kognitos.com email addresses. You're signed in with a different account — sign out of Google there and try again.",
    callback: "Sign-in failed. Try again, or ping the team if it keeps happening.",
    expired: "Your sign-in link expired. Request a new one below.",
  };
  const errorMsg = params.error ? (errorCopy[params.error] ?? params.error) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--background)] px-4">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="text-display text-3xl tracking-tighter font-semibold text-[color:var(--foreground)]">
            DeliveryOps
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)] mt-2">
            Kognitos · delivery
          </div>
        </div>

        <div className="glass-card p-8">
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)] mb-1">
            Sign in
          </h1>
          <p className="text-sm text-[color:var(--muted-foreground)] mb-6">
            Restricted to <span className="font-medium">@kognitos.com</span> accounts.
          </p>

          {errorMsg ? (
            <div className="mb-5 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {errorMsg}
            </div>
          ) : null}

          {params.message ? (
            <div className="mb-5 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
              {params.message}
            </div>
          ) : null}

          <LoginForm next={params.next ?? "/dashboard"} />
        </div>

        <div className="mt-8 text-center text-xs text-[color:var(--muted-foreground)]">
          Trouble signing in? Ping <span className="font-medium">#deliveryops</span>.
        </div>
      </div>
    </div>
  );
}
