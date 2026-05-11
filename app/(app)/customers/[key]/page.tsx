import Link from "next/link";

import { getCustomerByKey, listCustomers } from "@/lib/customers";
import { getProfile, getInternalProfile } from "@/lib/profile/profile";
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
  const [enrichment, profile, internalProfile, events, tasks, allCustomers] = await Promise.all([
    loadCustomerEnrichment(customer.id).catch(() => null),
    getProfile(key).catch(() => null),
    getInternalProfile(key).catch(() => null),
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
  const activities = enrichment?.activities ?? [];
  const openActivities = activities.filter(
    (a) => (a.status ?? "").toLowerCase() !== "closed" && !a.resolved_date
  );
  const npsResponses = enrichment?.nps ?? [];

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
          label="Kognitos ARR"
          value={formatMoney(profile?.arr ?? null)}
          hint={profile?.renewal_date ? `renews ${profile.renewal_date}` : "from latest SF contract"}
          emphasis
        />
        <StatBlock
          label="Company revenue"
          value={formatMoney(account?.annual_revenue ?? null)}
          hint={account?.industry ?? "Salesforce"}
        />
        <StatBlock
          label="Open opportunities"
          value={String(openOpps.length)}
          hint={`${opps.length} total · ${wonOpps.length} won`}
        />
        <StatBlock
          label="Active projects"
          value={String(projects.length)}
          hint={`${openCases.length} open SF cases`}
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

          {/* Internal health (CSM-only — agent has zero access to internal_profiles) */}
          {internalProfile ? (
            <section className="rounded-lg border border-line bg-white p-5">
              <div className="flex items-baseline justify-between mb-3">
                <SectionMark>Internal health</SectionMark>
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)]">
                  CSM only
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <HealthScore
                  label="Health"
                  value={internalProfile.health_score}
                  tone={
                    internalProfile.health_score >= 70
                      ? "good"
                      : internalProfile.health_score >= 50
                      ? "warn"
                      : "bad"
                  }
                />
                <HealthScore
                  label="NPS"
                  value={internalProfile.nps_score}
                  tone={
                    internalProfile.nps_score >= 7
                      ? "good"
                      : internalProfile.nps_score >= 0
                      ? "warn"
                      : "bad"
                  }
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <KV label="Churn risk" value={internalProfile.churn_risk} />
                <KV label="Next QBR" value={internalProfile.next_qbr_date} />
              </div>
              {internalProfile.last_updated_by ? (
                <div className="text-[10px] text-[color:var(--brand-gray)] mt-3 uppercase tracking-wider">
                  Last updated by {internalProfile.last_updated_by}
                </div>
              ) : null}
            </section>
          ) : null}

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

      {/* Contacts (from SF Account → Contact relationship, populated on backfill) */}
      {profile && profile.contacts.length > 0 ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <div className="flex items-baseline justify-between mb-4">
            <SectionMark>Contacts ({profile.contacts.length})</SectionMark>
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)]">
              from Salesforce
            </span>
          </div>
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {profile.contacts.slice(0, 12).map((c, i) => (
              <li
                key={`${c.email || c.name}-${i}`}
                className="rounded-md border border-line bg-[color:var(--brand-seasalt)] p-3"
              >
                <div className="font-medium text-sm">{c.name || "(unnamed)"}</div>
                {c.role ? (
                  <div className="text-xs text-[color:var(--brand-gray)] mt-0.5">{c.role}</div>
                ) : null}
                <div className="mt-2 space-y-1 text-xs">
                  {c.email ? (
                    <a
                      href={`mailto:${c.email}`}
                      className="block truncate underline decoration-[color:var(--brand-yellow)] decoration-2 underline-offset-4"
                    >
                      {c.email}
                    </a>
                  ) : null}
                  {c.phone ? (
                    <a
                      href={`tel:${c.phone.replace(/\s+/g, "")}`}
                      className="block text-[color:var(--brand-gray)]"
                    >
                      {c.phone}
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Projects — Monday Projects board, lifted columns: health, phase,
          dev platform, kickoff + go-live dates, complexity. Grouped by the
          board's Monday groups (Active / Pipeline / On Hold / Backlog). */}
      {projects.length > 0 ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <div className="flex items-baseline justify-between mb-4">
            <SectionMark>Projects · {projects.length}</SectionMark>
            <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
              {enrichment?.freshness.monday_synced_at
                ? `synced ${formatTimeAgo(enrichment.freshness.monday_synced_at)}`
                : "not synced"}
            </span>
          </div>
          {(() => {
            // Group projects by Monday group_title (Active / Pipeline / On Hold / Backlog).
            const GROUP_ORDER = ["Active", "Pipeline", "On Hold", "Backlog"];
            const grouped = new Map<string, typeof projects>();
            for (const p of projects) {
              const key = p.group_title ?? "(other)";
              const list = grouped.get(key) ?? [];
              list.push(p);
              grouped.set(key, list);
            }
            const ordered = [
              ...GROUP_ORDER.filter((g) => grouped.has(g)).map((g) => [g, grouped.get(g)!] as const),
              ...[...grouped.entries()].filter(([g]) => !GROUP_ORDER.includes(g)),
            ];
            return ordered.map(([groupName, list]) => (
              <div key={groupName} className="mb-6 last:mb-0">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-2">
                  {groupName} · {list.length}
                </div>
                <ul className="space-y-2">
                  {list.map((p) => (
                    <ProjectRow
                      key={p.monday_item_id}
                      project={p}
                      customerName={customer.display_name}
                    />
                  ))}
                </ul>
              </div>
            ));
          })()}
        </section>
      ) : null}

      {/* Activity Log — action items / blockers / change requests pulled from
          Monday's Activity Log board, matched per customer via the
          "Customer:" header that Fireflies-generated items carry. */}
      <section className="rounded-lg border border-line bg-white p-6">
        <div className="flex items-baseline justify-between mb-4">
          <SectionMark>
            {openActivities.length > 0
              ? `Open action items · ${openActivities.length}`
              : "Activity log"}
          </SectionMark>
          <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
            {activities.length} total
          </span>
        </div>
        {activities.length === 0 ? (
          <Empty
            text={`No Activity Log entries match this customer yet. Items get linked when their Monday "Customer:" header (or board-relation column) names "${customer.display_name}".`}
          />
        ) : (
          <ul className="space-y-3">
            {activities.slice(0, 12).map((a) => (
              <ActivityRow key={a.monday_item_id} activity={a} />
            ))}
            {activities.length > 12 ? (
              <li className="text-xs text-[color:var(--brand-gray)] tabular-nums">
                + {activities.length - 12} more
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {/* NPS Tracking */}
      <section className="rounded-lg border border-line bg-white p-6">
        <div className="flex items-baseline justify-between mb-4">
          <SectionMark>NPS responses</SectionMark>
          <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
            {npsResponses.length} cached
          </span>
        </div>
        {npsResponses.length === 0 ? (
          <Empty
            text='No NPS data linked to this customer yet. Items on the Monday "NPS Tracking" board are named after the respondent (e.g. "Tia Bell"), so we match them via the board-relation "Customer" column. Populate that column on the NPS board and the responses will appear on the next sync.'
          />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {npsResponses.slice(0, 10).map((n) => (
              <NpsRow key={n.monday_item_id} response={n} />
            ))}
          </ul>
        )}
      </section>

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

const PROJECT_HEALTH_TONE: Record<string, string> = {
  "On Track": "bg-emerald-50 text-emerald-800 border-emerald-200",
  Healthy: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Watch: "bg-amber-50 text-amber-800 border-amber-200",
  "At Risk": "bg-red-50 text-red-800 border-red-200",
  Blocked: "bg-red-50 text-red-800 border-red-200",
  "Off Track": "bg-red-50 text-red-800 border-red-200",
};

const PROJECT_STATUS_TONE: Record<string, string> = {
  Delivered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Live: "bg-emerald-50 text-emerald-800 border-emerald-200",
  "In Progress": "bg-sky-50 text-sky-800 border-sky-200",
  "On Hold": "bg-neutral-100 text-neutral-700 border-neutral-300",
  Cancelled: "bg-neutral-100 text-neutral-500 border-neutral-200",
  Backlog: "bg-neutral-50 text-neutral-600 border-neutral-200",
};

function ProjectRow({
  project,
  customerName,
}: {
  project: {
    monday_item_id: string;
    name: string;
    group_title: string | null;
    health: string | null;
    project_status: string | null;
    current_phase: string | null;
    dev_platform: string | null;
    complexity: string | null;
    kickoff_date: string | null;
    go_live_date: string | null;
    tam: string | null;
    dev: string | null;
  };
  customerName: string;
}) {
  const cleanName = project.name.replace(new RegExp(`^${customerName}\\s*[-—]\\s*`), "");
  const healthClass = project.health
    ? PROJECT_HEALTH_TONE[project.health] ?? "bg-neutral-50 text-neutral-700 border-neutral-200"
    : null;
  const statusClass = project.project_status
    ? PROJECT_STATUS_TONE[project.project_status] ?? "bg-neutral-50 text-neutral-600 border-neutral-200"
    : null;

  return (
    <li className="rounded-md border border-line bg-[color:var(--brand-seasalt)] p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="font-medium text-sm">{cleanName}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          {project.dev_platform ? (
            <span className="text-[10px] uppercase tracking-wider rounded border border-[color:var(--brand-night)] px-1.5 py-0.5 font-medium bg-white">
              {project.dev_platform}
            </span>
          ) : null}
          {healthClass ? (
            <span className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${healthClass}`}>
              {project.health}
            </span>
          ) : null}
          {statusClass ? (
            <span className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${statusClass}`}>
              {project.project_status}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-[color:var(--brand-gray)]">
        {project.current_phase ? <span>Phase: {project.current_phase}</span> : null}
        {project.complexity ? <span>Complexity: {project.complexity}</span> : null}
        {project.kickoff_date ? (
          <span className="tabular-nums">
            Kickoff: {project.kickoff_date}
          </span>
        ) : null}
        {project.go_live_date ? (
          <span className="tabular-nums">
            Go live: <strong className="text-[color:var(--brand-night)]">{project.go_live_date}</strong>
          </span>
        ) : null}
        {project.tam ? <span>TAM: {project.tam.split("@")[0]}</span> : null}
        {project.dev ? <span>Dev: {project.dev.split("@")[0]}</span> : null}
      </div>
    </li>
  );
}

function HealthScore({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : "text-red-700";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)] mb-1">
        {label}
      </div>
      <div className={`text-display text-3xl tabular-nums ${toneClass}`}>{value}</div>
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

const PRIORITY_TONE: Record<string, string> = {
  Critical: "bg-red-50 text-red-800 border-red-200",
  High: "bg-amber-50 text-amber-800 border-amber-200",
  Medium: "bg-sky-50 text-sky-800 border-sky-200",
  Low: "bg-neutral-50 text-neutral-700 border-neutral-200",
};

const STATUS_TONE: Record<string, string> = {
  Open: "bg-emerald-50 text-emerald-800 border-emerald-200",
  "In Progress": "bg-sky-50 text-sky-800 border-sky-200",
  Closed: "bg-neutral-50 text-neutral-600 border-neutral-200",
  Resolved: "bg-neutral-50 text-neutral-600 border-neutral-200",
  Blocked: "bg-red-50 text-red-800 border-red-200",
};

function ActivityRow({
  activity,
}: {
  activity: {
    monday_item_id: string;
    name: string;
    group_title: string | null;
    priority: string | null;
    status: string | null;
    due_date: string | null;
    created_date: string | null;
    resolved_date: string | null;
    ai_summary: string | null;
    source_link: string | null;
    meeting_excerpt: string | null;
  };
}) {
  const priorityClass = activity.priority
    ? PRIORITY_TONE[activity.priority] ?? "bg-neutral-50 text-neutral-700 border-neutral-200"
    : null;
  const statusClass = activity.status
    ? STATUS_TONE[activity.status] ?? "bg-neutral-50 text-neutral-600 border-neutral-200"
    : null;

  // Pull link from Monday's link column. The cell value is "View Transcript - https://…"
  const linkMatch = activity.source_link?.match(/https?:\/\/\S+/);
  const transcriptUrl = linkMatch?.[0] ?? null;

  // The displayed title — prefer the AI summary (concise) over the raw item
  // name (often a verbose paragraph).
  const title = activity.ai_summary ?? activity.name;

  return (
    <li className="border-l-2 border-[color:var(--brand-yellow-line)] pl-3 py-1">
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        {priorityClass ? (
          <span
            className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${priorityClass}`}
          >
            {activity.priority}
          </span>
        ) : null}
        {statusClass ? (
          <span
            className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${statusClass}`}
          >
            {activity.status}
          </span>
        ) : null}
        {activity.group_title ? (
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)]">
            {activity.group_title}
          </span>
        ) : null}
        {activity.due_date ? (
          <span className="text-[10px] text-[color:var(--brand-gray)] tabular-nums ml-auto">
            due {activity.due_date}
          </span>
        ) : null}
      </div>
      <div className="text-sm font-medium text-[color:var(--brand-night)]">{title}</div>
      {activity.meeting_excerpt ? (
        <details className="mt-1">
          <summary className="text-xs text-[color:var(--brand-gray)] cursor-pointer hover:text-[color:var(--brand-night)]">
            meeting context
          </summary>
          <div className="text-xs text-[color:var(--brand-gray)] mt-1 leading-relaxed whitespace-pre-line max-w-prose">
            {activity.meeting_excerpt}
          </div>
        </details>
      ) : null}
      <div className="flex gap-3 text-[10px] text-[color:var(--brand-gray)] tabular-nums mt-1">
        {activity.created_date ? <span>logged {activity.created_date}</span> : null}
        {transcriptUrl ? (
          <a
            href={transcriptUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-[color:var(--brand-yellow)] decoration-2 underline-offset-4 hover:text-[color:var(--brand-night)]"
          >
            transcript
          </a>
        ) : null}
      </div>
    </li>
  );
}

const NPS_CATEGORY_TONE: Record<string, string> = {
  Promoter: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Passive: "bg-amber-50 text-amber-800 border-amber-200",
  Detractor: "bg-red-50 text-red-800 border-red-200",
};

function NpsRow({
  response,
}: {
  response: {
    monday_item_id: string;
    respondent: string;
    quarter: string | null;
    score: number | null;
    category: string | null;
    response_date: string | null;
    feedback: string | null;
    respondent_type: string | null;
  };
}) {
  const categoryClass = response.category
    ? NPS_CATEGORY_TONE[response.category] ?? "bg-neutral-50 text-neutral-700 border-neutral-200"
    : null;
  return (
    <li className="rounded-md border border-line bg-[color:var(--brand-seasalt)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-medium text-sm">{response.respondent}</div>
          <div className="text-xs text-[color:var(--brand-gray)]">
            {response.respondent_type ?? "—"}
            {response.quarter ? ` · ${response.quarter}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-display text-2xl tabular-nums leading-none">
            {response.score ?? "—"}
          </div>
          {categoryClass ? (
            <span
              className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${categoryClass} inline-block mt-1`}
            >
              {response.category}
            </span>
          ) : null}
        </div>
      </div>
      {response.feedback ? (
        <div className="text-xs text-[color:var(--brand-gray)] mt-2 italic leading-relaxed">
          &ldquo;{response.feedback}&rdquo;
        </div>
      ) : null}
    </li>
  );
}
