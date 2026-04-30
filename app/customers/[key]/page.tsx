import { getCustomerByKey } from "@/lib/customers";
import { getProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";
import { getAccount, listOpportunities, listCases } from "@/lib/integrations/salesforce";
import { gql } from "@/lib/integrations/monday";
import { listProjectRows, findMatchingProjects } from "@/lib/import/monday-customers";
import type { Customer } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function CustomerOverview({ params }: Props) {
  const { key } = await params;

  const customer = await getCustomerByKey(key);
  if (!customer) {
    return (
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <div className="font-medium">Customer not found.</div>
      </div>
    );
  }

  // Fetch everything else concurrently and tolerate failures gracefully so a
  // single dead integration doesn't blank the whole page.
  const [profile, events, tasks, sf, mondayItem, projects] = await Promise.all([
    safe(getProfile(key)),
    safe(listEvents(key, { limit: 12 })),
    safe(listTasks(key)),
    safe(loadSalesforce(customer)),
    safe(loadMondayCustomerItem(customer)),
    safe(loadMondayProjects(customer)),
  ]);

  const sfAccount = sf.value?.account ?? null;
  const sfOpps = sf.value?.opportunities ?? [];
  const sfCases = sf.value?.cases ?? [];
  const md = mondayItem.value;
  const arr = sfAccount?.AnnualRevenue ?? null;
  const renewalDate = sfOpps.find((o) => !o.IsClosed)?.CloseDate ?? null;

  return (
    <div className="space-y-6">
      {/* Hero — what makes this customer this customer */}
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">Lifecycle</div>
          <div className="mt-1 font-medium">{customer.lifecycle_group ?? "—"}</div>
          {md?.topic ? (
            <div className="mt-2 text-xs text-[color:var(--brand-gray)] italic">
              &ldquo;{md.topic}&rdquo;
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">Owners</div>
          {customer.ce_owner ? (
            <div className="mt-1">
              CE · <span className="font-medium">{customer.ce_owner}</span>
            </div>
          ) : null}
          {md?.primary_owner ? (
            <div className="text-xs text-[color:var(--brand-gray)]">Primary · {md.primary_owner}</div>
          ) : null}
          {md?.secondary_owner ? (
            <div className="text-xs text-[color:var(--brand-gray)]">Secondary · {md.secondary_owner}</div>
          ) : null}
          {customer.partner ? (
            <div className="text-xs text-[color:var(--brand-gray)]">Partner · {customer.partner}</div>
          ) : null}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">External IDs</div>
          <div className="mt-1 text-xs space-y-0.5">
            {customer.salesforce_account_id ? (
              <div>SF · <code className="text-[11px]">{customer.salesforce_account_id}</code></div>
            ) : (
              <div className="text-[color:var(--brand-gray)]">SF · not mapped</div>
            )}
            {customer.monday_item_id ? (
              <div>Monday item · <code className="text-[11px]">{customer.monday_item_id}</code></div>
            ) : null}
            {customer.monday_workspace_id ? (
              <div>
                Monday workspace · <code className="text-[11px]">{customer.monday_workspace_id}</code>
              </div>
            ) : (
              <div className="text-[color:var(--brand-gray)]">Workspace · none</div>
            )}
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          label="Annual revenue"
          value={
            arr != null
              ? `$${(arr / 1_000_000).toFixed(arr >= 100_000_000 ? 0 : 1)}M`
              : "—"
          }
          sub={sfAccount ? sfAccount.Industry ?? sfAccount.Type ?? "Salesforce" : "Salesforce"}
        />
        <Stat
          label="Open opportunities"
          value={String(sfOpps.filter((o) => !o.IsClosed).length)}
          sub={`${sfOpps.length} total · ${sfOpps.filter((o) => o.IsWon).length} won`}
        />
        <Stat
          label="Active projects"
          value={String(projects.value?.length ?? 0)}
          sub="from Monday Projects board"
        />
      </div>

      {/* Salesforce */}
      {customer.salesforce_account_id ? (
        <Section title="Salesforce" subtitle={sfAccount?.Name ?? customer.salesforce_account_id}>
          {sf.error ? (
            <ErrorBox message={sf.error} />
          ) : !sfAccount ? (
            <Empty text="No Salesforce account returned for this ID." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <KV label="Industry" value={sfAccount.Industry} />
              <KV label="Employees" value={sfAccount.NumberOfEmployees?.toLocaleString() ?? null} />
              <KV
                label="ARR"
                value={
                  sfAccount.AnnualRevenue != null
                    ? `$${sfAccount.AnnualRevenue.toLocaleString()}`
                    : null
                }
              />
              <KV label="Owner" value={sfAccount.Owner?.Name ?? null} />
              <KV label="Website" value={sfAccount.Website} />
              <KV
                label="HQ"
                value={[sfAccount.BillingCity, sfAccount.BillingCountry].filter(Boolean).join(", ") || null}
              />
              <KV label="Type" value={sfAccount.Type} />
              <KV label="Phone" value={sfAccount.Phone} />
            </div>
          )}

          {sfOpps.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                Opportunities ({sfOpps.length})
              </h4>
              <div className="space-y-1 text-sm">
                {sfOpps.slice(0, 5).map((o) => (
                  <div
                    key={o.Id}
                    className="rounded border border-[color:var(--brand-metal)] bg-white p-2 flex justify-between gap-2"
                  >
                    <span>
                      <span className="font-medium">{o.Name}</span>
                      <span className="text-xs text-[color:var(--brand-gray)] ml-2">
                        {o.StageName} · close {o.CloseDate}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums">
                      {o.Amount != null ? `$${o.Amount.toLocaleString()}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {sfCases.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                Cases ({sfCases.length})
              </h4>
              <div className="space-y-1 text-sm">
                {sfCases.slice(0, 5).map((c) => (
                  <div key={c.Id} className="rounded border border-[color:var(--brand-metal)] bg-white p-2">
                    <span className="font-medium">{c.CaseNumber}</span>
                    <span className="ml-2">{c.Subject}</span>
                    <span className="text-xs text-[color:var(--brand-gray)] ml-2">
                      {c.Status}
                      {c.Priority ? ` · ${c.Priority}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* Monday Projects */}
      {customer.monday_item_id ? (
        <Section title="Active projects" subtitle="From Monday Projects board (live read)">
          {projects.error ? (
            <ErrorBox message={projects.error} />
          ) : !projects.value || projects.value.length === 0 ? (
            <Empty text="No active projects matched on the Monday Projects board." />
          ) : (
            <ul className="space-y-1 text-sm">
              {projects.value.map((p) => (
                <li
                  key={p.item_id}
                  className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-[color:var(--brand-gray)]">{p.group}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {/* Recent events */}
      <Section title="Recent events" subtitle="Everything that happened to this customer in DeliveryOps">
        {events.error ? (
          <ErrorBox message={events.error} />
        ) : !events.value || events.value.length === 0 ? (
          <Empty text="No events yet." />
        ) : (
          <ul className="space-y-1 text-sm">
            {events.value.map((e) => (
              <li key={e.id} className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{e.summary}</span>
                  <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--brand-gray)] mt-0.5">
                  {e.event_type}
                  {e.tags.length > 0 ? ` · ${e.tags.join(", ")}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Active tasks */}
      <Section title="Active tasks" subtitle="Reminders + recurring checks scheduled by the agent or you">
        {tasks.error ? (
          <ErrorBox message={tasks.error} />
        ) : !tasks.value || tasks.value.length === 0 ? (
          <Empty text="No active tasks." />
        ) : (
          <ul className="space-y-1 text-sm">
            {tasks.value.map((t) => (
              <li key={t.id} className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{t.description ?? t.name}</span>
                  <span className="text-xs text-[color:var(--brand-gray)]">{t.status}</span>
                </div>
                <div className="text-xs text-[color:var(--brand-gray)] mt-0.5 tabular-nums">
                  next: {t.next_run ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Profile summary */}
      {profile.value ? (
        <Section title="Profile" subtitle="Editable customer profile (agent + dashboard read/write)">
          <div className="grid gap-2 md:grid-cols-3 text-sm">
            <KV label="Tier" value={profile.value.tier} />
            <KV label="Renewal" value={profile.value.renewal_date ?? renewalDate ?? null} />
            <KV label="Deployment stage" value={profile.value.deployment_stage} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function loadSalesforce(customer: Customer) {
  if (!customer.salesforce_account_id) return null;
  const id = customer.salesforce_account_id;
  const [account, opportunities, cases] = await Promise.all([
    getAccount(id),
    listOpportunities({ accountId: id, limit: 25 }).catch(() => []),
    listCases({ accountId: id, limit: 25, openOnly: false }).catch(() => []),
  ]);
  return { account, opportunities, cases };
}

interface MondayCustomerItem {
  topic: string | null;
  primary_owner: string | null;
  secondary_owner: string | null;
}

async function loadMondayCustomerItem(customer: Customer): Promise<MondayCustomerItem | null> {
  if (!customer.monday_item_id) return null;
  const data = await gql<{
    items: Array<{ column_values: Array<{ id: string; text: string | null }> }>;
  }>(
    `query ($ids: [ID!]!) {
      items (ids: $ids) {
        column_values { id text }
      }
    }`,
    { ids: [customer.monday_item_id] }
  );
  const cols = (data.items?.[0]?.column_values ?? []).reduce<Record<string, string | null>>(
    (acc, c) => ((acc[c.id] = c.text), acc),
    {}
  );
  return {
    topic: cols["text_mm0wejh5"] || null,
    primary_owner: cols["multiple_person_mm0ywg19"] || null,
    secondary_owner: cols["multiple_person_mm0yy4re"] || null,
  };
}

async function loadMondayProjects(customer: Customer) {
  if (!customer.monday_item_id) return [];
  const allProjects = await listProjectRows();
  return findMatchingProjects(
    {
      item_id: customer.monday_item_id,
      name: customer.display_name,
      group: customer.lifecycle_group ?? "",
    } as Parameters<typeof findMatchingProjects>[0],
    allProjects
  );
}

async function safe<T>(p: Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    const value = await p;
    return { value, error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── small UI bits ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4">
      <h3 className="font-medium">{title}</h3>
      <p className="text-xs text-[color:var(--brand-gray)] mb-3">{subtitle}</p>
      {children}
    </section>
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

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="text-sm">
      <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">{label}</div>
      <div>{value ?? <span className="text-[color:var(--brand-gray)]">—</span>}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded border border-dashed border-[color:var(--brand-metal)] bg-[color:var(--brand-seasalt)] p-3 text-sm text-[color:var(--brand-gray)]">
      {text}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <div className="font-medium mb-1">API error</div>
      <pre className="text-xs whitespace-pre-wrap">{message}</pre>
    </div>
  );
}
