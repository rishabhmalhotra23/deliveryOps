import Link from "next/link";

import { getCustomerByKey, listCustomers } from "@/lib/customers";
import { getProfile, getInternalProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";
import { loadCustomerEnrichment } from "@/lib/cache/integrations";
import { CUSTOMER_CATEGORIES } from "@/lib/supabase/types";
import { deriveArrTrend, deriveHealthScore, deriveChurnRisk, explainHealthScore, type OppForArr } from "@/lib/profile/derive";
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
import { InfoTooltip } from "@/app/_components/tooltip";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { ArrHistoryChart, NpsTrendChart, type ArrPoint, type NpsTrendPoint } from "./_inline-charts";

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

  // ARR history points — every Won contract event + the current open expected.
  // Drives the inline ARR-over-time chart (the JBI expansion story).
  const arrPoints: ArrPoint[] = opps
    .filter(
      (o) =>
        (o.is_won || (!o.is_closed && (o.probability ?? 0) >= 50)) &&
        o.amount != null &&
        o.close_date != null
    )
    .map((o) => ({
      date: o.close_date!,
      amount: o.amount!,
      type: (o.is_won ? "Won" : "Open") as "Won" | "Open",
      name: o.name,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // NPS trend points — quarter average + promoter/passive/detractor counts.
  // Mirrors the QoQ groupings below; charted with NpsTrendChart.
  const npsTrendByQuarter = new Map<
    string,
    { sum: number; count: number; promoter: number; passive: number; detractor: number }
  >();
  for (const r of npsResponses) {
    if (!r.quarter || r.score == null) continue;
    const prev = npsTrendByQuarter.get(r.quarter) ?? {
      sum: 0,
      count: 0,
      promoter: 0,
      passive: 0,
      detractor: 0,
    };
    prev.sum += r.score;
    prev.count++;
    if (r.category === "Promoter") prev.promoter++;
    else if (r.category === "Passive") prev.passive++;
    else if (r.category === "Detractor") prev.detractor++;
    npsTrendByQuarter.set(r.quarter, prev);
  }
  const npsTrendPoints: NpsTrendPoint[] = [...npsTrendByQuarter.entries()]
    .map(([quarter, v]) => ({
      quarter,
      average: Math.round((v.sum / v.count) * 10) / 10,
      count: v.count,
      promoter: v.promoter,
      passive: v.passive,
      detractor: v.detractor,
    }))
    .sort((a, b) => {
      const parse = (s: string) => {
        const m = /^(\d)Q(\d{2})$/.exec(s);
        return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
      };
      return parse(a.quarter) - parse(b.quarter);
    });

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

      {/* Editable ownership + categorisation strip, with field-definition tooltips */}
      <div className="rounded-lg border border-line bg-white p-5 grid gap-5 md:grid-cols-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-1 flex items-center gap-1.5">
            AE
            <InfoTooltip source="DeliveryOps — synced from Monday">
              <strong>Account Executive</strong> — the Kognitos AE who owns this customer.
              Pulled from Monday&apos;s &quot;AE&quot; column on the Customers board on every sync.
              Manually edit here to override; the override is locked from future sync overwrites.
            </InfoTooltip>
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
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-1 flex items-center gap-1.5">
            Category
            <InfoTooltip source="DeliveryOps — derived from Monday group">
              <strong>DeliveryOps category</strong> — operational bucket for the customer.
              Seeded from Monday&apos;s lifecycle group via a mapping
              (e.g. &quot;To be Dropped&quot; → &quot;To Drop&quot;). Drives dashboard filters and chart colors.
              Eight buckets: At Risk, Upcoming Renewals, Strategic Growth, Active,
              Partner Managed, POV, To Drop, Churned.
            </InfoTooltip>
          </div>
          <InlineEdit
            customerKey={customer.key}
            field="custom_category"
            initialValue={customer.custom_category}
            label="Category"
            placeholder="(uncategorised)"
            options={knownCategories.map((c) => ({ value: c, label: c }))}
            allowNull={false}
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-1 flex items-center gap-1.5">
            Partner
            <InfoTooltip source="DeliveryOps — synced from Monday">
              <strong>Implementation partner</strong> — the agency or consultancy delivering
              the work, if any. &quot;(direct)&quot; means Kognitos delivers without a partner.
              Common values: My Paradigm, Wipro BPS, QBotica, Indium, Kai-Mation.
            </InfoTooltip>
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

      {/* Stat row — top-line numbers with YoY ARR + Monday/SF source tags */}
      {(() => {
        const oppsForTrend: OppForArr[] = opps.map((o) => ({
          amount: o.amount,
          close_date: o.close_date,
          is_closed: o.is_closed,
          is_won: o.is_won,
          probability: o.probability,
        }));
        const trend = deriveArrTrend(oppsForTrend);
        const inProgressProjects = projects.filter(
          (p) => p.project_status === "In Progress"
        ).length;
        const npsAvg =
          npsResponses.length > 0
            ? npsResponses.reduce((s, n) => s + (n.score ?? 0), 0) / npsResponses.length
            : null;
        return (
          <section className="grid gap-3 md:grid-cols-4">
            <StatBlock
              label={
                <span className="inline-flex items-center gap-1.5">
                  Kognitos ARR
                  <InfoTooltip source="Computed from Salesforce opportunities">
                    <strong>Annual deal value with Kognitos</strong> — the Amount on the
                    customer&apos;s most-recently-signed-or-expected annual contract. Pulled
                    from Salesforce Opportunity, picking the latest of: Closed Won OR Open
                    with ≥50% probability.
                    <br />
                    <br />
                    NOT the same as company revenue (that&apos;s the customer&apos;s total
                    business, shown separately on the Salesforce card below).
                  </InfoTooltip>
                </span>
              }
              value={formatMoney(profile?.arr ?? null)}
              hint={
                trend.direction === "growth" || trend.direction === "contraction"
                  ? `${trend.direction === "growth" ? "▲" : "▼"} ${
                      trend.delta_pct != null ? `${Math.abs(trend.delta_pct).toFixed(1)}%` : "—"
                    } vs prior contract (${formatMoney(trend.previous)})`
                  : trend.direction === "flat"
                  ? `flat vs prior contract (${formatMoney(trend.previous)})`
                  : trend.direction === "first-contract"
                  ? "first signed contract"
                  : profile?.renewal_date
                  ? `renews ${profile.renewal_date}`
                  : "from latest SF opp"
              }
              emphasis
            />
            <StatBlock
              label={
                <span className="inline-flex items-center gap-1.5">
                  Active projects
                  <InfoTooltip source="Monday Projects board">
                    Number of projects currently <strong>In Progress</strong> on Monday&apos;s
                    Projects board (the PM tool). Salesforce is the CRM — the project view
                    lives in Monday and includes status, phase, dev/TAM owners, kickoff
                    and go-live dates.
                  </InfoTooltip>
                </span>
              }
              value={String(inProgressProjects)}
              hint={`${projects.length} total · ${projects.filter((p) => p.go_live_date).length} delivered`}
            />
            <StatBlock
              label={
                <span className="inline-flex items-center gap-1.5">
                  Average NPS
                  <InfoTooltip source="Monday NPS Tracking board">
                    Average NPS score across every response from this customer&apos;s contacts.
                    Range 0–10. 9–10 = Promoter, 7–8 = Passive, 0–6 = Detractor.
                  </InfoTooltip>
                </span>
              }
              value={npsAvg != null ? npsAvg.toFixed(1) : "—"}
              hint={`${npsResponses.length} response${npsResponses.length === 1 ? "" : "s"}`}
            />
            <StatBlock
              label={
                <span className="inline-flex items-center gap-1.5">
                  Open opportunities
                  <InfoTooltip source="Salesforce">
                    Salesforce opportunities currently in any non-Closed stage. Each opp
                    represents an annual contract event (New / Renewal / Expansion).
                  </InfoTooltip>
                </span>
              }
              value={String(openOpps.length)}
              hint={`${opps.length} total · ${wonOpps.length} won · ${openCases.length} open cases`}
            />
          </section>
        );
      })()}

      {/* Inline trend charts — surface ARR + NPS history right above the
          detail sections, so the customer's commercial story is visible
          without scrolling to /analytics. Hidden when there's nothing to
          plot. */}
      {arrPoints.length > 0 || npsTrendPoints.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-2">
          {arrPoints.length > 0 ? (
            <CollapsibleSection
              id="arr-history"
              title="ARR over time"
              count={
                arrPoints.length > 1
                  ? `${formatMoney(arrPoints[0].amount)} → ${formatMoney(
                      arrPoints[arrPoints.length - 1].amount
                    )}`
                  : `${arrPoints.length} point`
              }
              meta="from Salesforce won + open opps"
            >
              <div className="mt-2 -mx-2">
                <ArrHistoryChart data={arrPoints} />
              </div>
              <p className="text-[10px] text-[color:var(--brand-gray)] mt-2 italic">
                Each step = a Salesforce contract event (Won amount or the current
                open renewal). The yellow dot marks the currently-expected ARR.
              </p>
            </CollapsibleSection>
          ) : null}
          {npsTrendPoints.length > 0 ? (
            <CollapsibleSection
              id="nps-trend"
              title="NPS over time"
              count={
                npsTrendPoints.length > 1
                  ? `${npsTrendPoints[0].average.toFixed(1)} → ${npsTrendPoints[
                      npsTrendPoints.length - 1
                    ].average.toFixed(1)}`
                  : `${npsTrendPoints.length} quarter`
              }
              meta="from Monday NPS Tracking board"
            >
              <div className="mt-2 -mx-2">
                <NpsTrendChart data={npsTrendPoints} />
              </div>
              <p className="text-[10px] text-[color:var(--brand-gray)] mt-2 italic">
                Solid line = average score per quarter. Dashed lines = promoter
                + detractor counts.
              </p>
            </CollapsibleSection>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Salesforce commercial card — first thing after the stats */}
        <section className="lg:col-span-2 rounded-lg border border-line bg-white p-6">
          <div className="flex items-baseline justify-between mb-4">
            <SectionMark>
              <span className="inline-flex items-center gap-1.5">
                Salesforce — commercial
                <InfoTooltip source="From Salesforce">
                  Commercial relationship facts: the Account, every Opportunity (annual
                  contract event), and any Cases. The data is pulled into a local cache
                  on every sync — this card is fast even when SF is slow.
                </InfoTooltip>
              </span>
            </SectionMark>
            <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
              {enrichment?.freshness.salesforce_synced_at
                ? `synced ${formatTimeAgo(enrichment.freshness.salesforce_synced_at)}`
                : "not synced"}
            </span>
          </div>

          {!customer.salesforce_account_id ? (
            <Empty text="No Salesforce account mapped. Use the import flow or operations chat to map one." />
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
                <KV
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      Company revenue
                      <InfoTooltip source="Salesforce Account.AnnualRevenue">
                        The customer&apos;s <em>total</em> company revenue (not what they
                        pay Kognitos). Salesforce stores this as a banded value, so it
                        may round to the nearest $10M or $1B.
                      </InfoTooltip>
                    </span>
                  }
                  value={formatMoney(account.annual_revenue)}
                />
                <KV label="SF account owner" value={account.owner_name} />
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
              <SectionMark>
                <span className="inline-flex items-center gap-1.5">
                  Opportunities ({opps.length})
                  <InfoTooltip source="Salesforce Opportunity">
                    Each opportunity = one annual contract event (New / Renewal /
                    Expansion / Lost). Amount = the deal size. They don&apos;t add up
                    across years — each Renewal replaces the prior year&apos;s contract.
                  </InfoTooltip>
                </span>
              </SectionMark>
              <div className="space-y-1">
                {opps.slice(0, 5).map((o) => (
                  <OpportunityRow key={o.sf_id} opp={o} />
                ))}
                {opps.length > 5 ? (
                  <details className="group">
                    <summary className="text-xs text-[color:var(--brand-night)] pt-3 pb-1 cursor-pointer hover:underline list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                      Show {opps.length - 5} more
                    </summary>
                    <div className="space-y-1 mt-2">
                      {opps.slice(5).map((o) => (
                        <OpportunityRow key={o.sf_id} opp={o} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}

          {cases.length > 0 ? (
            <div className="mt-6">
              <SectionMark>Cases ({cases.length})</SectionMark>
              <div className="space-y-1">
                {cases.slice(0, 5).map((c) => (
                  <CaseRow key={c.sf_id} c={c} />
                ))}
                {cases.length > 5 ? (
                  <details className="group">
                    <summary className="text-xs text-[color:var(--brand-night)] pt-3 pb-1 cursor-pointer hover:underline list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                      Show {cases.length - 5} more
                    </summary>
                    <div className="space-y-1 mt-2">
                      {cases.slice(5).map((c) => (
                        <CaseRow key={c.sf_id} c={c} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {/* Right rail — focused on CSM signals, not technical IDs */}
        <aside className="space-y-6">
          {/* Internal health — the CSM's at-a-glance read on the account.
              IMPORTANT: every metric is computed live from the freshest data
              on every page load (NPS from monday_nps_responses, health from
              the current category). The internal_profiles row exists for
              future manual overrides + as an audit trail, but its cached
              snapshot can drift behind the live data — so we don't render
              it directly. Both numbers below will always match the rest of
              the page. */}
          {(() => {
            // Live derivation — same source as the stat row above, so they agree.
            const liveScores = npsResponses
              .map((n) => n.score)
              .filter((s): s is number => typeof s === "number");
            const liveNps = liveScores.length
              ? Math.round((liveScores.reduce((a, b) => a + b, 0) / liveScores.length) * 10) / 10
              : null;
            const liveHealth = deriveHealthScore(customer.custom_category);
            const liveChurnRisk = deriveChurnRisk(customer.custom_category);
            // Internal profile gives us the cached snapshot — useful to show
            // drift for transparency, not to drive UI numbers.
            const cachedNps = internalProfile?.nps_score ?? 0;
            const cachedHealth = internalProfile?.health_score ?? 0;
            const npsDrift = liveNps != null && Math.abs((liveNps ?? 0) - cachedNps) >= 1;
            const healthDrift = Math.abs(liveHealth - cachedHealth) >= 5;
            return (
              <section className="rounded-lg border border-line bg-white p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <SectionMark>
                    <span className="inline-flex items-center gap-1.5">
                      Internal health
                      <InfoTooltip source="Live — re-computed per page load">
                        The CSM&apos;s at-a-glance read. <strong>Both numbers
                        below are computed live</strong> from the current
                        category (for Health) and the current NPS responses
                        (for the average). The agent has zero access to this
                        panel — it lives in a separate table the agent&apos;s
                        tools cannot read or write.
                      </InfoTooltip>
                    </span>
                  </SectionMark>
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)]">
                    CSM only · live
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <HealthScore
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        Health
                        <InfoTooltip source="Computed live from category">
                          <strong>Score 0–100.</strong>
                          <span className="block mt-1 text-[11px]">
                            {explainHealthScore(customer.custom_category)}
                          </span>
                          <span className="block mt-2 text-[11px]">
                            Future iterations will fold in signal beyond category:
                            ticket volume, login frequency, exception rate, NPS trend.
                          </span>
                        </InfoTooltip>
                      </span>
                    }
                    value={liveHealth}
                    tone={
                      liveHealth >= 70 ? "good" : liveHealth >= 50 ? "warn" : "bad"
                    }
                  />
                  <HealthScore
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        NPS
                        <InfoTooltip source={`Live · avg of ${liveScores.length} response${liveScores.length === 1 ? "" : "s"}`}>
                          Average NPS across this customer&apos;s linked responses
                          (0–10 scale). 9–10 = Promoter, 7–8 = Passive, 0–6 =
                          Detractor. Future passes will weight by recency.
                        </InfoTooltip>
                      </span>
                    }
                    value={liveNps ?? 0}
                    tone={
                      (liveNps ?? 0) >= 7
                        ? "good"
                        : (liveNps ?? 0) >= 5
                        ? "warn"
                        : "bad"
                    }
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <KV
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        Churn risk
                        <InfoTooltip>
                          <strong>low / medium / high.</strong> Derived live from
                          category: At Risk, To Drop, Churned → high. Upcoming
                          Renewals → medium. Everything else → low.
                        </InfoTooltip>
                      </span>
                    }
                    value={liveChurnRisk}
                  />
                  <KV
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        Next QBR
                        <InfoTooltip>
                          Default seeded to 90 days out. Update once a real QBR
                          is on the calendar — Calendar integration (Phase 3)
                          will populate this automatically.
                        </InfoTooltip>
                      </span>
                    }
                    value={internalProfile?.next_qbr_date ?? null}
                  />
                </div>
                {(npsDrift || healthDrift) && internalProfile ? (
                  <div className="text-[10px] text-[color:var(--brand-gray)] mt-3 pt-3 border-t border-[color:var(--brand-metal-line)]">
                    <span className="uppercase tracking-wider">Snapshot drift:</span>
                    {healthDrift ? (
                      <span className="ml-1.5">cached health {cachedHealth}</span>
                    ) : null}
                    {npsDrift ? (
                      <span className="ml-1.5">cached NPS {cachedNps}</span>
                    ) : null}
                    <span className="ml-1.5 italic">(re-run backfill to refresh)</span>
                  </div>
                ) : null}
              </section>
            );
          })()}

          {/* Renewal callout — most actionable timeline signal on the page */}
          {nextRenewal ? (
            <section className="rounded-lg border border-[color:var(--brand-night)] bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] p-5">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-yellow)] font-medium flex items-center gap-1.5">
                Next renewal
                <InfoTooltip source="Salesforce — soonest open opp">
                  Close date of the soonest open Salesforce opportunity with probability
                  ≥50%. When the deal closes (won or lost), the next-most-recent open
                  opp moves into this slot.
                </InfoTooltip>
              </div>
              <div className="text-display text-2xl mt-2 tabular-nums">{nextRenewal}</div>
              <div className="text-xs text-[color:var(--brand-metal)] mt-1">
                from open Salesforce opportunity
              </div>
            </section>
          ) : null}

          {/* Source-of-truth protected fields — informational, sits in right rail */}
          {customer.deliveryops_protected_fields?.length > 0 ? (
            <section className="rounded-lg border border-[color:var(--brand-yellow-line)] bg-[color:var(--brand-yellow-soft)] p-5">
              <SectionMark>DeliveryOps-owned</SectionMark>
              <p className="text-xs text-[color:var(--brand-night)] mb-2">
                These fields were edited here and are locked from sync overwrites:
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
        </aside>
      </div>

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
            // Bucket projects into Delivered (have a past go-live date OR
            // status says Delivered/Live) vs in-flight (everything else).
            // The in-flight bucket then sub-groups by Monday board group
            // (Active / Pipeline / On Hold / Backlog).
            const today = new Date().toISOString().slice(0, 10);
            const delivered = projects
              .filter((p) => {
                const live = (p.go_live_date ?? "") <= today && (p.go_live_date ?? "").length >= 8;
                const statusDone = ["Delivered", "Live"].includes(p.project_status ?? "");
                return live || statusDone;
              })
              .sort((a, b) => ((a.go_live_date ?? "") < (b.go_live_date ?? "") ? 1 : -1));
            const inFlight = projects.filter((p) => !delivered.includes(p));

            const GROUP_ORDER = ["Active", "Pipeline", "On Hold", "Backlog"];
            const inFlightGrouped = new Map<string, typeof inFlight>();
            for (const p of inFlight) {
              const key = p.group_title ?? "(other)";
              const list = inFlightGrouped.get(key) ?? [];
              list.push(p);
              inFlightGrouped.set(key, list);
            }
            const inFlightOrdered = [
              ...GROUP_ORDER.filter((g) => inFlightGrouped.has(g)).map(
                (g) => [g, inFlightGrouped.get(g)!] as const
              ),
              ...[...inFlightGrouped.entries()].filter(([g]) => !GROUP_ORDER.includes(g)),
            ];
            return (
              <>
                {inFlightOrdered.map(([groupName, list]) => (
                  <div key={groupName} className="mb-6">
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
                ))}
                {delivered.length > 0 ? (
                  <details className="mt-4 pt-4 border-t border-[color:var(--brand-metal-line)]" open>
                    <summary className="cursor-pointer list-none flex items-baseline gap-2 mb-3 group">
                      <span className="group-open:rotate-90 inline-block transition-transform text-[color:var(--brand-gray)]">
                        ▸
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-night)] font-medium">
                        Delivered · {delivered.length}
                      </span>
                      <InfoTooltip source="Monday — go-live date or status">
                        Projects that have shipped: either Monday status is
                        Delivered / Live, or the go-live date has already
                        passed. Sorted newest first by go-live date.
                      </InfoTooltip>
                    </summary>
                    <ul className="space-y-2">
                      {delivered.map((p) => (
                        <ProjectRow
                          key={p.monday_item_id}
                          project={p}
                          customerName={customer.display_name}
                        />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            );
          })()}
        </section>
      ) : null}

      {/* NPS responses — arranged quarter-by-quarter, full comments. */}
      <section className="rounded-lg border border-line bg-white p-6">
        <div className="flex items-baseline justify-between mb-4">
          <SectionMark>
            <span className="inline-flex items-center gap-1.5">
              NPS responses
              <InfoTooltip source="Monday NPS Tracking board">
                Each row is one NPS response linked to this customer. Grouped by
                quarter, newest first. Comments are shown in full. As the NPS
                board fills in, this section grows automatically.
              </InfoTooltip>
            </span>
          </SectionMark>
          <span className="text-[10px] text-[color:var(--brand-gray)] uppercase tracking-wider">
            {npsResponses.length} response{npsResponses.length === 1 ? "" : "s"}
          </span>
        </div>
        {npsResponses.length === 0 ? (
          <Empty text='No NPS data linked to this customer yet. Items on the NPS Tracking board are matched via the Customer board-relation column. Once populated, responses appear on the next sync.' />
        ) : (
          <NpsByQuarter responses={npsResponses} />
        )}
      </section>

      {/* Contacts — default closed; reference data, not daily-work */}
      {profile && profile.contacts.length > 0 ? (
        <CollapsibleSection
          id="contacts"
          title="Contacts"
          count={`${profile.contacts.length}`}
          meta="from Salesforce"
          defaultOpen={false}
        >
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
        </CollapsibleSection>
      ) : null}

      {/* Activity Log — default closed; open when there are open items */}
      <CollapsibleSection
        id="activity-log"
        title={openActivities.length > 0 ? "Open action items" : "Activity log"}
        count={openActivities.length > 0 ? `${openActivities.length}` : `${activities.length} total`}
        defaultOpen={openActivities.length > 0}
      >
        {activities.length === 0 ? (
          <Empty text={`No Activity Log entries match this customer yet. Items get linked when their Monday "Customer:" header (or board-relation column) names "${customer.display_name}".`} />
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
      </CollapsibleSection>

      {/* Events + Tasks — default closed; audit + reminders */}
      <CollapsibleSection
        id="events-tasks"
        title="Events + scheduled tasks"
        count={`${events.length} events · ${tasks.filter((t) => t.status === "active").length} active tasks`}
        defaultOpen={false}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-3">
              Recent events
            </div>
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
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--brand-gray)] font-medium mb-3">
              Active tasks
            </div>
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
          </div>
        </div>
      </CollapsibleSection>

      {/* Profile fragment — default closed; high-level derived facts */}
      {profile ? (
        <CollapsibleSection id="profile" title="Profile" defaultOpen={false}>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-3 text-sm">
            <KV label="Tier" value={profile.tier} />
            <KV label="Renewal" value={profile.renewal_date ?? nextRenewal ?? null} />
            <KV label="Deployment stage" value={profile.deployment_stage} />
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Technical IDs — default closed, at the very bottom */}
      <CollapsibleSection
        id="technical-ids"
        title="Technical IDs"
        meta="for debugging syncs + integration plumbing"
        defaultOpen={false}
      >
        <dl className="text-xs space-y-2 grid gap-y-2 md:grid-cols-2 md:gap-x-6">
          <ExternalId label="Salesforce account" value={customer.salesforce_account_id} />
          <ExternalId label="Monday item" value={customer.monday_item_id} />
          <ExternalId label="Monday workspace" value={customer.monday_workspace_id} />
          <ExternalId label="Slack" value={customer.slack_channel ? `#${customer.slack_channel}` : null} />
          <ExternalId label="Kognitos v1 dept" value={customer.kognitos_v1_department_id} />
          <ExternalId label="Kognitos v2 workspace" value={customer.kognitos_v2_workspace_id} />
          <ExternalId label="Drive folder" value={customer.drive_folder_id} />
          <ExternalId label="Email alias" value={customer.email_alias} />
        </dl>
      </CollapsibleSection>
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
  label: React.ReactNode;
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

function KV({ label, value, link = false }: { label: React.ReactNode; value: string | null | undefined; link?: boolean }) {
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

// NpsByQuarter — groups NPS responses by quarter (e.g. "4Q25", "1Q26"),
// renders newest quarter first, with average score, distribution chips,
// and full comments. Long histories collapse into <details>.
function NpsByQuarter({
  responses,
}: {
  responses: Array<{
    monday_item_id: string;
    respondent: string;
    quarter: string | null;
    score: number | null;
    category: string | null;
    response_date: string | null;
    feedback: string | null;
    respondent_type: string | null;
  }>;
}) {
  const grouped = new Map<string, typeof responses>();
  for (const r of responses) {
    const k = r.quarter ?? "(no quarter)";
    const list = grouped.get(k) ?? [];
    list.push(r);
    grouped.set(k, list);
  }
  // Sort quarters newest-first. "4Q25" → year=2025, q=4.
  const ordered = [...grouped.entries()].sort((a, b) => {
    const parse = (s: string) => {
      const m = /^(\d)Q(\d{2})$/.exec(s);
      return m ? 2000 + Number(m[2]) * 10 + Number(m[1]) : 0;
    };
    return parse(b[0]) - parse(a[0]);
  });

  return (
    <div className="space-y-6">
      {ordered.map(([quarter, list], i) => {
        const validScores = list
          .map((r) => r.score)
          .filter((s): s is number => typeof s === "number");
        const avg = validScores.length
          ? Math.round((validScores.reduce((s, n) => s + n, 0) / validScores.length) * 10) / 10
          : null;
        const promoters = list.filter((r) => r.category === "Promoter").length;
        const passives = list.filter((r) => r.category === "Passive").length;
        const detractors = list.filter((r) => r.category === "Detractor").length;
        // First quarter is always open; older ones collapse.
        const open = i === 0;
        return (
          <details key={quarter} open={open} className="group">
            <summary className="cursor-pointer list-none flex items-baseline justify-between gap-3 pb-2 border-b border-[color:var(--brand-metal-line)] hover:bg-[color:var(--brand-seasalt)] rounded px-1 -mx-1">
              <div className="flex items-baseline gap-3">
                <span className="group-open:rotate-90 inline-block transition-transform text-[color:var(--brand-gray)]">
                  ▸
                </span>
                <span className="text-display text-lg">{quarter}</span>
                <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
                  {list.length} response{list.length === 1 ? "" : "s"}
                </span>
                {avg != null ? (
                  <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
                    avg <strong className="text-[color:var(--brand-night)]">{avg.toFixed(1)}</strong>
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                {promoters > 0 ? (
                  <span className="rounded border px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border-emerald-200">
                    {promoters} promoter{promoters === 1 ? "" : "s"}
                  </span>
                ) : null}
                {passives > 0 ? (
                  <span className="rounded border px-1.5 py-0.5 bg-amber-50 text-amber-800 border-amber-200">
                    {passives} passive
                  </span>
                ) : null}
                {detractors > 0 ? (
                  <span className="rounded border px-1.5 py-0.5 bg-red-50 text-red-800 border-red-200">
                    {detractors} detractor{detractors === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </summary>
            <ul className="mt-3 space-y-2">
              {list.map((n) => (
                <NpsResponseLine key={n.monday_item_id} response={n} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function NpsResponseLine({
  response,
}: {
  response: {
    respondent: string;
    score: number | null;
    category: string | null;
    response_date: string | null;
    feedback: string | null;
    respondent_type: string | null;
  };
}) {
  const cat = response.category;
  const catClass = cat === "Promoter"
    ? "text-emerald-700"
    : cat === "Detractor"
    ? "text-red-700"
    : cat === "Passive"
    ? "text-amber-700"
    : "text-[color:var(--brand-gray)]";
  return (
    <li className="rounded-md border border-line bg-[color:var(--brand-seasalt)] p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div>
          <span className="font-medium text-sm">{response.respondent}</span>
          {response.respondent_type ? (
            <span className="text-xs text-[color:var(--brand-gray)] ml-2">
              · {response.respondent_type}
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          <span className={`text-display text-2xl tabular-nums leading-none ${catClass}`}>
            {response.score ?? "—"}
          </span>
          {response.category ? (
            <span className={`text-[10px] uppercase tracking-wider ${catClass}`}>
              {response.category}
            </span>
          ) : null}
        </div>
      </div>
      {response.feedback ? (
        <div className="text-xs text-[color:var(--brand-night)] mt-2 italic leading-relaxed whitespace-pre-line">
          &ldquo;{response.feedback}&rdquo;
        </div>
      ) : null}
      {response.response_date ? (
        <div className="text-[10px] text-[color:var(--brand-gray)] tabular-nums mt-2">
          {response.response_date}
        </div>
      ) : null}
    </li>
  );
}

// OpportunityRow + CaseRow — Salesforce list-item rows, used both for the
// first 5 items and the expanded list inside the <details> disclosure.
function OpportunityRow({
  opp,
}: {
  opp: {
    sf_id: string;
    name: string;
    stage_name: string | null;
    amount: number | null;
    close_date: string | null;
    is_won: boolean;
    is_closed: boolean;
  };
}) {
  const tone = opp.is_won
    ? "text-emerald-700"
    : opp.is_closed
    ? "text-neutral-500"
    : "text-[color:var(--brand-night)]";
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-[color:var(--brand-metal-line)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{opp.name}</div>
        <div className="text-xs text-[color:var(--brand-gray)]">
          {opp.stage_name ?? "—"}
          {opp.close_date ? ` · close ${opp.close_date}` : ""}
          {opp.is_won ? " · won" : opp.is_closed ? " · closed" : ""}
        </div>
      </div>
      <div className={`text-sm tabular-nums shrink-0 ${tone}`}>
        {formatMoney(opp.amount)}
      </div>
    </div>
  );
}

function CaseRow({
  c,
}: {
  c: {
    sf_id: string;
    case_number: string | null;
    subject: string | null;
    status: string | null;
    priority: string | null;
    is_closed: boolean;
  };
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-[color:var(--brand-metal-line)] last:border-0">
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
