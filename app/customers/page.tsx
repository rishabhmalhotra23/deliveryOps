import Link from "next/link";

import { listCustomers } from "@/lib/customers";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  let customers: Awaited<ReturnType<typeof listCustomers>> = [];
  let dataError: string | null = null;
  try {
    customers = await listCustomers();
  } catch (err) {
    dataError = err instanceof Error ? err.message : "Failed to load customers.";
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            <p className="text-sm text-[color:var(--brand-gray)] mt-1">
              Every customer DeliveryOps is operating. Click in to see profile, events, tasks, and chat.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]"
          >
            ← Home
          </Link>
        </header>

        {dataError ? (
          <div className="rounded-lg border border-[color:var(--brand-metal)] bg-white p-6 text-sm">
            <div className="font-medium mb-1">Can&rsquo;t reach Supabase yet.</div>
            <p className="text-[color:var(--brand-gray)]">
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{" "}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>.env.local</code>, then run the{" "}
              <code>0001_init.sql</code> migration. Error: <code>{dataError}</code>
            </p>
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[color:var(--brand-metal)] bg-white p-8 text-sm">
            <div className="font-medium mb-1">No customers yet.</div>
            <p className="text-[color:var(--brand-gray)] mb-4">
              Insert a row in the <code>customers</code> table or hit{" "}
              <code>POST /api/customers</code> with{" "}
              <code>{`{ key, display_name, slack_channel, email_alias }`}</code>.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {customers.map((c) => (
              <Link
                key={c.id}
                href={`/customers/${c.key}`}
                className="rounded-lg border border-[color:var(--brand-metal)] bg-white p-4 hover:border-[color:var(--brand-night)] transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{c.display_name}</div>
                    <div className="text-xs text-[color:var(--brand-gray)] mt-0.5">{c.key}</div>
                  </div>
                  <span className="size-2 rounded-full bg-[color:var(--brand-yellow)]" />
                </div>
                <div className="mt-3 space-y-1 text-xs text-[color:var(--brand-gray)]">
                  {c.slack_channel ? <div>Slack · #{c.slack_channel}</div> : null}
                  {c.email_alias ? <div>Email · {c.email_alias}</div> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
