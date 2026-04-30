import Link from "next/link";

import { getCustomerByKey, listCustomers } from "@/lib/customers";
import { getProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";
import { loadCustomerEnrichment } from "@/lib/cache/integrations";
import { CUSTOMER_CATEGORIES } from "@/lib/supabase/types";
import {
  CategoryChip,
  PageHeader,
  SectionMark,
  StatBlock,
  formatMoney,
  formatTimeAgo,
  categoryFromCustomer,
} from "@/app/_components/brand";
import { InlineEdit } from "@/app/_components/inline-edit";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function CustomerOverview({ params }: Props) {
  const { key } = await params;
  const customer = await getCustomerByKey(key);
  if (!customer) {
    return (
      <div className="px-8 py-10 max-w-3xl mx-auto">
        <div className="rounded-lg border border-line bg-white p-6">
          <div className="text-display text-2xl">Customer not found</div>
          <p className="text-[color:var(--brand-gray)] text-sm mt-2">
            <Link href="/customers" className="underline">Back to customers</Link>
          </p>
        </div>
      </div>
    );
  }

  // Pull cached enrichment + Postgres-side data concurrently. listCustomers
  // is used to build AE + partner suggestion lists so the inline editor
  // autocompletes against existing values rather than asking the user to
  // remember exact spellings.
  const [enrichment, profile, events, tasks, allCustomers] = await Promise.all([
    loadCustomerEnrichment(customer.id).catch(() => null),
    getProfile(key).catch(() => null),
    listEvents(key, { limit: 20 }).catch(() => []),
    listTasks(key).catch(() => []),
    listCustomers().catch(() => []),
  ]);

  const knownAes = Array.from(
    new Set(allCustomers.map((c) => c.ae_owner).filter((v): v is string => !!v))
  ).sort();
  const knownPartners = Array.from(
    new Set(allCustomers.map((c) => c.partner).filter((v): v is string => !!v))
  ).sort();
  const knownCategories = Array.from(
    new Set([...CUSTOMER_CATEGORIES, ...allCustomers.map((c) => c.custom_category).filter((v): v is string => !!v)])
  );

  const account = enrichment?.account ?? null;
  const opps = enrichment?.opportunities ?? [];
  const cases = enrichment?.cases ?? [];
  const projects = enrichment?.projects ?? [];

  const openOpps = opps.filter((o) => !o.is_closed);
  const wonOpps = opps.filter((o) => o.is_won);
  const openCases = cases.filter((c) => !c.is_closed);
  const nextRenewal = openOpps
    .filter((o) => o.close_date)
    .sort((a, b) => a.close_date!.localeCompare(b.close_date!))[0]?.close_date ?? null;

  return (
    <div className="px-8 lg:px-12 py-10 max-w-7xl mx-auto space-y-10">
      <PageHeader
        eyebrow="Customer"
        title={customer.display_name}
        subtitle={account?.industry ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <CategoryChip category={categoryFromCustomer(customer)} />
            {customer.salesforce_account_id ? (
              <span className="chip-yellow text-[10px] uppercase tracking-wider rounded px-2 py-1 font-medium">
                SF mapped
              </span>
            ) : null}
          </div>
        }
      />

      {/* Editable ownership + categorisation strip */}
      <div className="rounded-lg border border-line bg-white p-5 grid gap-5 md:grid-cols-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-1">
            AE
          </div>
          <InlineEdit
            customerKey={customer.key}
            field="ae_owner"
            initialValue={customer.ae_owner}
            label="AE"
            placeholder="(unassigned)"
            suggestions={knownAes}
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-1">
            Category
          </div>
          <InlineEdit
            customerKey={customer.key}
            field="custom_category"
            initialValue={customer.custom_category}
            label="Category"
            placeholder="(unassigned)"
            options={knownCategories.map((c) => ({ value: c, label: c }))}
            allowNull={false}
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-1">
            Partner
          </div>
          <InlineEdit
            customerKey={customer.key}
            field="partner"
            initialValue={customer.partner}
            label="Partner"
            placeholder="(direct)"
            suggestions={knownPartners}
          />
        </div>
      </div>

      {/* Stat row */}
      <section className="grid gap-3 md:grid-cols-4">
        <StatBlock
          label="Annual revenue"
          value={formatMoney(account?.annual_revenue ?? null)}
          hint={account?.industry ?? "Salesforce"}
          emphasis
        />
        <StatBlock
          label="Open opportunities"
          value={String(openOpps.length)}
          hint={`${opps.length} total · ${wonOpps.length} won`}
        />
        <StatBlock
          label="Active projects"
          value={String(projects.length)}
          hint="from Monday Projects board"
        />
        <StatBlock
          label="Open cases"
          value={String(openCases.length)}
          hint={`${cases.length} total in Salesforce`}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Salesforce profile card */}
        <section className="lg:col-span-2 rounded-lg border border-line bg-white p-6">
          <div className="flex items-baseline justify-between mb-4">
            <SectionMark>Salesforce</SectionMark>
            <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
              {enrichment?.freshness.salesforce_synced_at
                ? `synced ${formatTimeAgo(enrichment.freshness.salesforce_synced_at)}`
                : "not synced"}
            </span>
          </div>

          {!customer.salesforce_account_id ? (
            <Empty text="No Salesforce account mapped. Re-run the import to pick a match." />
          ) : !account ? (
            <Empty text="Account is mapped but not yet in cache. Run a sync." />
          ) : (
            <div>
              <div className="text-display text-2xl">{account.name}</div>
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 mt-4">
                <KV label="Industry" value={account.industry} />
                <KV label="Type" value={account.type} />
                <KV
                  label="Employees"
                  value={account.number_of_employees?.toLocaleString() ?? null}
                />
                <KV label="ARR" value={formatMoney(account.annual_revenue)} />
                <KV label="Owner" value={account.owner_name} />
                <KV
                  label="HQ"
                  value={
                    [account.billing_city, account.billing_country].filter(Boolean).join(", ") || null
                  }
                />
                <KV label="Website" value={account.website} link />
                <KV label="Phone" value={account.phone} />
              </div>
            </div>
          )}

          {opps.length > 0 ? (
            <div className="mt-6">
              <SectionMark>Opportunities ({opps.length})</SectionMark>
              <div className="space-y-1">
                {opps.slice(0, 8).map((o) => (
                  <div
                    key={o.sf_id}
                    className="flex items-baseline justify-between gap-3 py-2 border-b border-[color:var(--brand-metal-line)] last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{o.name}</div>
                      <div className="text-xs text-[color:var(--brand-gray)]">
                        {o.stage_name ?? "—"}
                        {o.close_date ? ` · close ${o.close_date}` : ""}
                        {o.is_won ? " · won" : o.is_closed ? " · closed" : ""}
                      </div>
                    </div>
                    <div className="text-sm tabular-nums shrink-0">
                      {o.amount != null ? formatMoney(o.amount) : "—"}
                    </div>
                  </div>
                ))}
                {opps.length > 8 ? (
                  <div className="text-xs text-[color:var(--brand-gray)] pt-2">
                    + {opps.length - 8} more
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {cases.length > 0 ? (
            <div className="mt-6">
              <SectionMark>Cases ({cases.length})</SectionMark>
              <div className="space-y-1">
                {cases.slice(0, 6).map((c) => (
                  <div
                    key={c.sf_id}
                    className="flex items-baseline justify-between gap-3 py-2 border-b border-[color:var(--brand-metal-line)] last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        <span className="text-[color:var(--brand-gray)]">{c.case_number}</span>{" "}
                        <span className="font-medium">{c.subject ?? "(no subject)"}</span>
                      </div>
                      <div className="text-xs text-[color:var(--brand-gray)]">
                        {c.status ?? "—"}
                        {c.priority ? ` · ${c.priority}` : ""}
                        {c.is_closed ? " · closed" : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Right rail */}
        <aside className="space-y-6">
          {/* External IDs */}
          <section className="rounded-lg border border-line bg-white p-5">
            <SectionMark>External IDs</SectionMark>
            <dl className="text-xs space-y-2 mt-2">
              <ExternalId label="Salesforce" value={customer.salesforce_account_id} />
              <ExternalId label="Monday item" value={customer.monday_item_id} />
              <ExternalId label="Monday workspace" value={customer.monday_workspace_id} />
              <ExternalId label="Slack" value={customer.slack_channel ? `#${customer.slack_channel}` : null} />
              <ExternalId label="Kognitos v1 dept" value={customer.kognitos_v1_department_id} />
              <ExternalId label="Kognitos v2 ws" value={customer.kognitos_v2_workspace_id} />
            </dl>
          </section>

          {/* Source-of-truth protected fields */}
          {customer.deliveryops_protected_fields?.length > 0 ? (
            <section className="rounded-lg border border-[color:var(--brand-yellow-line)] bg-[color:var(--brand-yellow-soft)] p-5">
              <SectionMark>DeliveryOps-owned</SectionMark>
              <p className="text-xs text-[color:var(--brand-night)] mb-2">
                These fields were edited in DeliveryOps and are locked from sync overwrites:
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {customer.deliveryops_protected_fields.map((f) => (
                  <li
                    key={f}
                    className="text-[10px] uppercase tracking-wider rounded border border-[color:var(--brand-night)] px-2 py-0.5 bg-white"
                  >
                    {f}
                  </li>
                ))}
              </ul>
              {customer.last_manually_edited_at ? (
                <div className="text-[10px] text-[color:var(--brand-gray)] mt-2 uppercase tracking-wider">
                  Last edited {formatTimeAgo(customer.last_manually_edited_at)}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Renewal callout */}
          {nextRenewal ? (
            <section className="rounded-lg border border-[color:var(--brand-night)] bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] p-5">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-yellow)] font-medium">
                Next renewal
              </div>
              <div className="text-display text-2xl mt-2 tabular-nums">{nextRenewal}</div>
              <div className="text-xs text-[color:var(--brand-metal)] mt-1">
                from open Salesforce opportunity
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {/* Monday projects */}
      {projects.length > 0 ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <div className="flex items-baseline justify-between mb-4">
            <SectionMark>Active projects · Monday</SectionMark>
            <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
              {enrichment?.freshness.monday_synced_at
                ? `synced ${formatTimeAgo(enrichment.freshness.monday_synced_at)}`
                : "not synced"}
            </span>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">
            {projects.map((p) => (
              <li
                key={p.monday_item_id}
                className="rounded-md border border-line bg-[color:var(--brand-seasalt)] p-3"
              >
                <div className="font-medium text-sm">{p.name.replace(`${customer.display_name} - `, "")}</div>
                <div className="text-xs text-[color:var(--brand-gray)] mt-1">
                  {p.group_title ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Events + tasks */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-6">
          <SectionMark>Recent events</SectionMark>
          {events.length === 0 ? (
            <Empty text="No events yet." />
          ) : (
            <ul className="divide-y divide-[color:var(--brand-metal-line)]">
              {events.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-sm">{e.summary}</span>
                    <span className="text-[10px] tabular-nums text-[color:var(--brand-gray)] shrink-0">
                      {new Date(e.ts).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-[color:var(--brand-gray)]">
                    {e.event_type}
                    {e.tags.length > 0 ? ` · ${e.tags.join(", ")}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-line bg-white p-6">
          <SectionMark>Active tasks</SectionMark>
          {tasks.filter((t) => t.status === "active").length === 0 ? (
            <Empty text="No active tasks." />
          ) : (
            <ul className="divide-y divide-[color:var(--brand-metal-line)]">
              {tasks
                .filter((t) => t.status === "active")
                .map((t) => (
                  <li key={t.id} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-sm">{t.description ?? t.name}</span>
                      <span className="text-[10px] tabular-nums text-[color:var(--brand-gray)] shrink-0">
                        next {t.next_run ?? "—"}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      {profile ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <SectionMark>Profile</SectionMark>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-3 text-sm">
            <KV label="Tier" value={profile.tier} />
            <KV
              label="Renewal"
              value={profile.renewal_date ?? nextRenewal ?? null}
            />
            <KV label="Deployment stage" value={profile.deployment_stage} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function KV({ label, value, link = false }: { label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)] mb-0.5">{label}</div>
      <div className="text-sm break-words">
        {!value ? (
          <span className="text-[color:var(--brand-gray)]">—</span>
        ) : link ? (
          <a
            href={value.startsWith("http") ? value : `https://${value}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-[color:var(--brand-yellow)] decoration-2 underline-offset-4"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function ExternalId({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[color:var(--brand-gray)] uppercase tracking-wider text-[10px]">{label}</dt>
      <dd className="font-mono text-[11px] truncate text-right">{value ?? "—"}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-[color:var(--brand-gray)] italic">{text}</div>;
}
