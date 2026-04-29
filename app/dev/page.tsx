import Link from "next/link";

import { integrationStatus } from "@/lib/dev/mode";
import { listCustomers } from "@/lib/customers";

export const dynamic = "force-dynamic";

export default async function DevStatusPage() {
  const status = integrationStatus();
  let customers: Awaited<ReturnType<typeof listCustomers>> = [];
  let supabaseError: string | null = null;
  try {
    customers = await listCustomers();
  } catch (err) {
    supabaseError = err instanceof Error ? err.message : String(err);
  }

  const liveCount = status.filter((s) => s.live).length;
  const totalCount = status.length;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-medium">Integrations</h2>
          <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
            {liveCount}/{totalCount} live · {totalCount - liveCount} mocked
          </span>
        </div>
        <ul className="space-y-2">
          {status.map((s) => (
            <li
              key={s.name}
              className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm flex items-start gap-3"
            >
              <span
                className={`mt-1 size-2 rounded-full shrink-0 ${
                  s.live ? "bg-[color:var(--brand-yellow)]" : "bg-[color:var(--brand-metal)]"
                }`}
              />
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">
                    {s.live ? "live" : "mocked"}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--brand-gray)] mt-0.5">{s.hint}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-medium">Customers</h2>
          {customers.length > 0 ? (
            <Link
              href="/customers"
              className="text-xs text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]"
            >
              Open dashboard →
            </Link>
          ) : null}
        </div>
        {supabaseError ? (
          <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
            <div className="font-medium mb-1">Supabase isn&rsquo;t reachable.</div>
            <p className="text-[color:var(--brand-gray)] mb-3">
              Run <code>npm run db:start</code> to launch a local Supabase stack via the CLI, then{" "}
              <code>npm run db:reset</code> to apply the migrations and seed.
            </p>
            <p className="text-xs text-[color:var(--brand-gray)]">{supabaseError}</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-4 text-sm">
            <div className="font-medium mb-1">No customers seeded yet.</div>
            <p className="text-[color:var(--brand-gray)] mb-3">
              <code>npm run db:reset</code> applies <code>supabase/seed.sql</code> which inserts a demo
              &ldquo;Acme&rdquo; customer. Or:
            </p>
            <form action="/api/dev/seed" method="post">
              <button
                type="submit"
                className="rounded-md bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] px-3 py-1.5 text-sm font-medium hover:opacity-90"
              >
                Seed demo customer (Acme)
              </button>
            </form>
          </div>
        ) : (
          <ul className="space-y-2">
            {customers.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm flex items-baseline justify-between"
              >
                <div>
                  <span className="font-medium">{c.display_name}</span>
                  <span className="text-xs text-[color:var(--brand-gray)] ml-2">{c.key}</span>
                </div>
                <Link
                  href={`/customers/${c.key}`}
                  className="text-xs text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]"
                >
                  open →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <h2 className="font-medium mb-2">What&rsquo;s next</h2>
        <ol className="list-decimal pl-5 space-y-1 text-[color:var(--brand-gray)]">
          <li>
            Make sure <code>npm run db:start</code> is running (Supabase CLI) and{" "}
            <code>npm run inngest:dev</code> is in another terminal.
          </li>
          <li>
            Drop your <code>ANTHROPIC_API_KEY</code> into <code>.env.local</code>.
          </li>
          <li>
            Hit <Link href="/dev/simulate" className="underline">Simulate inbound</Link> to send a fake
            Slack message, drop a fake file, or simulate a fake email — all using the real route
            handlers.
          </li>
          <li>
            Watch the agent respond, see the response in{" "}
            <Link href="/dev/outbox" className="underline">Outbox</Link>, and the structured event in
            the customer&rsquo;s events feed.
          </li>
        </ol>
      </section>
    </div>
  );
}
