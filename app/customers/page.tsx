import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import type { Customer } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const LIFECYCLE_ORDER = [
  "High Risk",
  "Upcoming Renewal",
  "Growth / Focus",
  "Tier 2 - Secondary Priority",
  "Partner Managed",
  "POV",
  "Churned/Dropped",
];

const LIFECYCLE_TONE: Record<string, { dot: string; chip: string }> = {
  "High Risk": { dot: "bg-red-500", chip: "bg-red-50 text-red-800 border-red-200" },
  "Upcoming Renewal": { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 border-amber-200" },
  "Growth / Focus": { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  "Tier 2 - Secondary Priority": { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800 border-sky-200" },
  "Partner Managed": { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-800 border-violet-200" },
  POV: { dot: "bg-yellow-400", chip: "bg-yellow-50 text-yellow-800 border-yellow-200" },
  "Churned/Dropped": { dot: "bg-neutral-400", chip: "bg-neutral-50 text-neutral-700 border-neutral-200" },
};

function tone(group: string | null) {
  if (!group) return { dot: "bg-neutral-400", chip: "bg-neutral-50 text-neutral-700 border-neutral-200" };
  return LIFECYCLE_TONE[group] ?? LIFECYCLE_TONE["Tier 2 - Secondary Priority"];
}

export default async function CustomersPage() {
  let customers: Customer[] = [];
  let dataError: string | null = null;
  try {
    customers = await listCustomers();
  } catch (err) {
    dataError = err instanceof Error ? err.message : "Failed to load customers.";
  }

  // Group + sort
  const grouped = new Map<string, Customer[]>();
  for (const group of LIFECYCLE_ORDER) grouped.set(group, []);
  for (const c of customers) {
    const k = c.lifecycle_group ?? "Other";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(c);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  const total = customers.length;
  const byPartner = new Map<string, number>();
  for (const c of customers) {
    const p = c.partner ?? "(direct)";
    byPartner.set(p, (byPartner.get(p) ?? 0) + 1);
  }
  const partners = Array.from(byPartner.entries()).sort((a, b) => b[1] - a[1]);

  const withSf = customers.filter((c) => c.salesforce_account_id).length;
  const withMondayWs = customers.filter((c) => c.monday_workspace_id).length;

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            <p className="text-sm text-[color:var(--brand-gray)] mt-1">
              {total} post-sales customer{total === 1 ? "" : "s"} in DeliveryOps. Roster source: Monday
              &ldquo;Customers&rdquo; board.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dev/import"
              className="text-sm rounded-md border border-[color:var(--brand-metal)] px-3 py-1.5 hover:border-[color:var(--brand-night)]"
            >
              Re-import from Monday
            </Link>
            <Link
              href="/"
              className="text-sm text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)] px-2 py-1.5"
            >
              ← Home
            </Link>
          </div>
        </header>

        {dataError ? (
          <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-6 text-sm">
            <div className="font-medium mb-1">Can&rsquo;t reach Supabase yet.</div>
            <p className="text-[color:var(--brand-gray)]">{dataError}</p>
          </div>
        ) : total === 0 ? (
          <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-8 text-sm">
            <div className="font-medium mb-1">No customers yet.</div>
            <p className="text-[color:var(--brand-gray)] mb-3">
              Run <Link href="/dev/import" className="underline">/dev/import</Link> to pull the 41
              customers from your Monday roster.
            </p>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <section className="grid gap-3 md:grid-cols-4">
              <Stat label="Total" value={String(total)} sub="post-sales customers" />
              <Stat
                label="Need attention"
                value={String(
                  (grouped.get("High Risk")?.length ?? 0) + (grouped.get("Upcoming Renewal")?.length ?? 0)
                )}
                sub="High Risk + Upcoming Renewal"
              />
              <Stat
                label="With Salesforce"
                value={`${withSf}/${total}`}
                sub={`${total - withSf} unmapped`}
              />
              <Stat
                label="With Monday workspace"
                value={`${withMondayWs}/${total}`}
                sub={`${total - withMondayWs} need workspace`}
              />
            </section>

            {/* Lifecycle distribution */}
            <section>
              <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                Lifecycle distribution
              </h2>
              <div className="flex flex-wrap gap-2">
                {LIFECYCLE_ORDER.map((g) => {
                  const count = grouped.get(g)?.length ?? 0;
                  if (count === 0) return null;
                  const t = tone(g);
                  return (
                    <span
                      key={g}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${t.chip}`}
                    >
                      <span className={`size-2 rounded-full ${t.dot}`} />
                      <span className="font-medium">{g}</span>
                      <span>{count}</span>
                    </span>
                  );
                })}
              </div>
            </section>

            {/* Partner breakdown */}
            {partners.length > 1 ? (
              <section>
                <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                  By partner
                </h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  {partners.map(([p, n]) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-metal)] bg-white px-3 py-1"
                    >
                      <span className="font-medium">{p}</span>
                      <span className="text-[color:var(--brand-gray)]">{n}</span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Customer list — grouped */}
            <section className="space-y-6">
              {LIFECYCLE_ORDER.map((g) => {
                const list = grouped.get(g);
                if (!list || list.length === 0) return null;
                const t = tone(g);
                return (
                  <div key={g}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`size-2 rounded-full ${t.dot}`} />
                      <h2 className="text-sm font-medium">{g}</h2>
                      <span className="text-xs text-[color:var(--brand-gray)]">{list.length}</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {list.map((c) => (
                        <CustomerCard key={c.id} customer={c} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Anything not in LIFECYCLE_ORDER */}
              {Array.from(grouped.entries())
                .filter(([g, list]) => !LIFECYCLE_ORDER.includes(g) && list.length > 0)
                .map(([g, list]) => (
                  <div key={g}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="size-2 rounded-full bg-neutral-400" />
                      <h2 className="text-sm font-medium">{g || "Unclassified"}</h2>
                      <span className="text-xs text-[color:var(--brand-gray)]">{list.length}</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {list.map((c) => (
                        <CustomerCard key={c.id} customer={c} />
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <Link
      href={`/customers/${customer.key}`}
      className="block rounded-md border border-[color:var(--brand-metal)] bg-white p-3 hover:border-[color:var(--brand-night)] transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{customer.display_name}</div>
        {customer.salesforce_account_id ? (
          <span
            title="Has Salesforce account mapped"
            className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-[color:var(--brand-yellow)]/40 text-[color:var(--brand-night)]"
          >
            SF
          </span>
        ) : null}
      </div>
      <div className="text-xs text-[color:var(--brand-gray)] mt-1 space-y-0.5">
        {customer.ce_owner ? <div>CE: {customer.ce_owner}</div> : null}
        {customer.partner ? <div>Partner: {customer.partner}</div> : null}
        {customer.monday_workspace_id ? (
          <div className="text-[color:var(--brand-night)]">
            Monday workspace · {customer.monday_workspace_id}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-[color:var(--brand-gray)] mt-1">{sub}</div> : null}
    </div>
  );
}
