import Link from "next/link";

import { listCustomers } from "@/lib/customers";
import { loadCustomerDomainMap, loadPortfolioSummary } from "@/lib/cache/integrations";
import { loadOvernightChanges, loadPendingApprovals } from "@/lib/dashboard/overnight";
import { loadUpcomingPipeline } from "@/lib/dashboard/pipeline";
import { CustomerAvatar } from "@/app/_components/customer-avatar";
import { deriveCustomerDomain } from "@/app/_components/customer-domain";
import { PipelineList } from "./_components/pipeline-list";
import { DashboardStatsRow } from "./_components/stats-row";
import {
  CategoryChip,
  PageHeader,
  SectionMark,
  formatMoney,
  formatTimeAgo,
  CATEGORY_ORDER,
  categoryFromCustomer,
  categorySortIndex,
} from "@/app/_components/brand";
import {
  loadCustomerCommercialsMap,
  type CustomerCommercials,
} from "@/lib/cache/integrations";
import {
  loadArrBreakdown,
  filterNeedAttention,
  loadOpenCases,
  loadOpenOpportunities,
} from "@/lib/dashboard/stats-drilldown";
import { formatPersonName } from "@/lib/delivery/taxonomy";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [
    customers,
    summary,
    overnight,
    approvals,
    pipeline,
    sfDomains,
    commercialsMap,
    arrRows,
    oppsRows,
    casesRows,
  ] = await Promise.all([
    listCustomers().catch(() => []),
    loadPortfolioSummary().catch(() => null),
    loadOvernightChanges(6).catch(() => []),
    loadPendingApprovals(8).catch(() => []),
    loadUpcomingPipeline().catch(() => null),
    loadCustomerDomainMap().catch(() => new Map<string, string | null>()),
    loadCustomerCommercialsMap().catch(() => new Map<string, CustomerCommercials>()),
    loadArrBreakdown().catch(() => []),
    loadOpenOpportunities().catch(() => []),
    loadOpenCases().catch(() => []),
  ]);
  // `attentionRows` is derived in-process from arrRows — used to do an
  // extra Supabase round-trip via loadNeedAttention(), which doubled the
  // customer/profile/account joins on every dashboard render.
  const attentionRows = filterNeedAttention(arrRows);

  // Dynamic-category helper — same signals everywhere on the dashboard.
  const categoryFor = (c: { id: string; custom_category: string | null; lifecycle_group: string | null }): string => {
    const commercials = commercialsMap.get(c.id);
    return categoryFromCustomer(c, {
      renewal_date: commercials?.renewal_date,
      annual_revenue: commercials?.annual_revenue,
    });
  };

  const totalArr = summary?.total_arr ?? 0;
  const needAttention =
    (summary?.by_category["At Risk"] ?? 0) + (summary?.by_category["Upcoming Renewals"] ?? 0);

  // "Quiet customers" — those without any recorded event in the last 30 days.
  // Replaces the old "Recently updated" tile grid: the loud customers always
  // grab attention, the silent ones churn. This is the early-warning surface.
  const QUIET_WINDOW_DAYS = 30;
  const quietCutoff = new Date(Date.now() - QUIET_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const quietCustomers = customers
    .filter((c) => {
      const cat = categoryFor(c);
      // Past customers (Churned / Dropped / To Drop / Past) shouldn't
      // appear here — they're not actively in our book.
      if (cat === "Churned" || cat === "Dropped" || cat === "To Drop" || cat === "Past") return false;
      const last = c.updated_at ? new Date(c.updated_at) : null;
      return !last || last < quietCutoff;
    })
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""))
    .slice(0, 9);
  const overnightFilled = overnight.length > 0;

  // Discover any custom categories the team has minted via the operations chat.
  const knownCategories = new Set<string>(CATEGORY_ORDER);
  const extraCategories = Object.keys(summary?.by_category ?? {})
    .filter((c) => !knownCategories.has(c))
    .sort();
  const allCategories = [...CATEGORY_ORDER, ...extraCategories];

  return (
    <div className="px-8 lg:px-12 py-10 max-w-7xl mx-auto space-y-12">
      <PageHeader
        eyebrow="Dashboard"
        title="Every customer, every system, one view."
        subtitle={`Salesforce ${
          summary?.last_sync.salesforce
            ? formatTimeAgo(summary.last_sync.salesforce)
            : "never"
        } · Monday ${
          summary?.last_sync.monday
            ? formatTimeAgo(summary.last_sync.monday)
            : "never"
        } · Kognitos live.`}
        actions={
          <Link
            href="/operations"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm"
          >
            Operations chat
          </Link>
        }
      />

      <DashboardStatsRow
        totalArr={totalArr}
        needAttention={needAttention}
        openOpportunities={summary?.total_open_opportunities ?? 0}
        openCases={summary?.total_open_cases ?? 0}
        customersWithSf={summary?.with_salesforce ?? 0}
        arrRows={arrRows}
        attentionRows={attentionRows}
        oppsRows={oppsRows}
        casesRows={casesRows}
      />

      <section>
        <SectionMark>Category distribution</SectionMark>
        <div className="rounded-lg border border-line bg-white dark:bg-white/6 dark:border-white/12 p-6">
          <div className="grid gap-4 md:grid-cols-7">
            {allCategories.map((category) => {
              const count = summary?.by_category[category] ?? 0;
              if (count === 0) return null;
              const pct = summary?.total ? Math.round((count / summary.total) * 100) : 0;
              return (
                <div key={category} className="space-y-2">
                  <CategoryChip category={category} size="sm" />
                  <div className="text-display text-3xl tracking-tight tabular-nums">{count}</div>
                  <div className="text-xs text-[color:var(--brand-gray)]">{pct}% of book</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pending approvals — surfaces the email drafts + gated actions that
          are waiting on an FDE click in Slack. Lives on the dashboard so the
          FDE doesn't have to context-switch to Slack to see what's queued. */}
      {approvals.length > 0 ? (
        <section className="rounded-lg border border-[color:var(--brand-yellow-line)] bg-[color:var(--brand-yellow-soft)] p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionMark>Pending approvals</SectionMark>
            <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
              {approvals.length} waiting on you
            </span>
          </div>
          <ul className="divide-y divide-[color:var(--brand-metal-line)]">
            {approvals.map((a) => (
              <li key={a.id} className="py-2.5 flex items-start justify-between gap-3">
                <Link
                  href={`/customers/${a.customer_key}`}
                  className="flex-1 min-w-0 hover:opacity-80"
                >
                  <div className="text-sm">
                    <span className="font-medium">{a.customer_display_name}</span>
                    <span className="text-[color:var(--brand-gray)]">
                      {" "}
                      · {a.kind === "email_draft" ? "Email draft" : "Action"}
                    </span>
                  </div>
                  <div className="text-xs text-[color:var(--brand-gray)] line-clamp-2 break-words" title={a.preview}>{a.preview}</div>
                </Link>
                <span className="text-[10px] text-[color:var(--brand-gray)] shrink-0 tabular-nums">
                  {formatTimeAgo(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-[color:var(--brand-gray)] mt-3">
            Each one has a Block Kit card in the customer&apos;s Slack channel —
            click through there to approve, reject, or discuss in thread.
          </div>
        </section>
      ) : null}

      {/* ── Upcoming pipeline (GTM Pipeline Inspection · next 90 days) ── */}
      {pipeline ? (
        <section>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <SectionMark>
              Upcoming pipeline · {pipeline.quarter_label.toLowerCase()}
            </SectionMark>
            <div className="flex items-center gap-3 flex-wrap">
              {pipeline.count > 0 ? (
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatMoney(pipeline.total_amount)} pipeline value
                </span>
              ) : null}
              {pipeline.pipeline_inspection_url ? (
                <a
                  href={pipeline.pipeline_inspection_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-[color:var(--foreground)] underline underline-offset-2 hover:opacity-80"
                >
                  Open in Salesforce ↗
                </a>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-[color:var(--brand-gray)] mb-3">
            {pipeline.source === "salesforce_list_view"
              ? `Live from Salesforce Pipeline Inspection${
                  pipeline.list_view_label ? ` · ${pipeline.list_view_label}` : " · Binny Gill's Team"
                }. Open opportunities with close dates in the next 90 days.`
              : "Open opportunities closing in the next 90 days (cached sync — live Pipeline Inspection unavailable)."}
            {pipeline.count > 0 ? (
              <>
                {" "}
                <span className="text-[color:var(--foreground)]">
                  {pipeline.by_kind.Renewal} renewal{pipeline.by_kind.Renewal === 1 ? "" : "s"} ·{" "}
                  {pipeline.by_kind.Expansion} expansion{pipeline.by_kind.Expansion === 1 ? "" : "s"} ·{" "}
                  {pipeline.by_kind.New} new
                  {pipeline.by_kind.Other > 0 ? ` · ${pipeline.by_kind.Other} other` : ""}
                </span>
              </>
            ) : null}
          </p>
          {pipeline.count > 0 ? (
            <PipelineList opportunities={pipeline.opportunities} />
          ) : (
            <div className="rounded-lg border border-line bg-white dark:bg-white/6 dark:border-white/12 p-6 text-sm text-[color:var(--brand-gray)]">
              No open opportunities closing in the next 90 days in this pipeline view.
              {pipeline.pipeline_inspection_url ? (
                <>
                  {" "}
                  <a
                    href={pipeline.pipeline_inspection_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[color:var(--foreground)] underline"
                  >
                    Check Pipeline Inspection in Salesforce
                  </a>{" "}
                  for the full team book.
                </>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {overnightFilled ? (
        <section>
          <SectionMark>What changed overnight</SectionMark>
          <p className="text-xs text-[color:var(--brand-gray)] mb-4">
            Customers sorted by event count in the last 18 hours.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {overnight.map((o) => {
              const domain =
                sfDomains.get(o.customer_id) ??
                deriveCustomerDomain({
                  emailAlias: o.customer_email_alias,
                  key: o.customer_key,
                });
              const commercials = commercialsMap.get(o.customer_id);
              const category = categoryFromCustomer(
                {
                  custom_category: o.customer_category,
                  lifecycle_group: o.customer_lifecycle_group,
                },
                {
                  renewal_date: commercials?.renewal_date,
                  annual_revenue: commercials?.annual_revenue,
                }
              );
              return (
                <Link
                  key={o.customer_key}
                  href={`/customers/${o.customer_key}`}
                  className="rounded-lg border border-line bg-white dark:bg-white/6 dark:border-white/12 p-4 hover:border-[color:var(--brand-night)] dark:hover:border-white/30 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <CustomerAvatar
                      name={o.customer_display_name}
                      logoUrl={o.customer_logo_url}
                      domain={domain}
                      category={category}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-display text-base break-words" title={o.customer_display_name}>{o.customer_display_name}</div>
                        <span className="rounded-full bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] text-[10px] font-mono px-2 py-0.5 tabular-nums shrink-0">
                          +{o.event_count}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--brand-gray)] line-clamp-2">
                        {o.latest_summary ?? "—"}
                      </div>
                      <div className="text-[10px] text-[color:var(--brand-gray)] mt-1">
                        {o.latest_ts ? formatTimeAgo(o.latest_ts) : "—"}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Quiet customers — early-warning surface. The FDE hears from the
          loud customers; this surfaces the silent ones, who are the actual
          renewal risk. Replaces the old "Recently updated" tile. */}
      {quietCustomers.length > 0 ? (
        <section>
          <div className="flex items-center justify-between mb-3">
            <SectionMark>Quiet customers · 30+ days</SectionMark>
            <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
              {quietCustomers.length} no signal in 30+ days
            </span>
          </div>
          <p className="text-xs text-[color:var(--brand-gray)] mb-4">
            Active accounts we haven&rsquo;t heard from. Quiet customers churn silently — reach out before they renew.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {quietCustomers.map((c) => {
              const domain =
                sfDomains.get(c.id) ??
                deriveCustomerDomain({ emailAlias: c.email_alias, key: c.key });
              const category = categoryFor(c);
              return (
                <Link
                  key={c.id}
                  href={`/customers/${c.key}`}
                  className="rounded-lg border border-line bg-white dark:bg-white/6 dark:border-white/12 p-4 hover:border-[color:var(--brand-night)] dark:hover:border-white/30 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <CustomerAvatar
                      name={c.display_name}
                      logoUrl={c.logo_url}
                      domain={domain}
                      category={category}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-display text-base break-words" title={c.display_name}>{c.display_name}</div>
                        <CategoryChip category={category} size="sm" />
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--brand-gray)] space-y-0.5">
                        {c.ae_owner ? <div>AE · {formatPersonName(c.ae_owner)}</div> : null}
                        <div>
                          {c.updated_at
                            ? `Last touched ${formatTimeAgo(c.updated_at)}`
                            : "Never touched"}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {!summary?.last_sync.salesforce ? (
        <section className="rounded-lg border border-[color:var(--brand-yellow-line)] bg-[color:var(--brand-yellow-soft)] p-5 text-sm">
          <div className="font-display text-base mb-1">No data synced yet.</div>
          <p className="text-[color:var(--brand-night)] mb-3">
            DeliveryOps caches Salesforce + Monday weekly so the dashboard stays fast. Trigger the
            first sync now to populate.
          </p>
          <Link href="/dev/sync" className="inline-flex btn-primary rounded-md px-4 py-1.5 text-sm">
            Run sync now
          </Link>
        </section>
      ) : null}
    </div>
  );
}

// Suppress lint warning when categorySortIndex isn't used — kept for future
// custom category orderings via the operations chat.
void categorySortIndex;
