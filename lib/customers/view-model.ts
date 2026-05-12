// Customer page view-model builders. Pure functions — input is raw data from
// loaders + derive helpers, output is typed props that each card component
// accepts. No Supabase/SF/Monday calls here; all that happens in page.tsx.

import {
  deriveArr,
  deriveArrTrend,
  deriveHealthScore,
  deriveChurnRisk,
  explainHealthScore,
  type OppForArr,
} from "@/lib/profile/derive";
import { categoryFromCustomer } from "@/app/_components/brand";
import type { Customer, Profile, InternalProfile, CuratorTask, CuratorEvent } from "@/lib/supabase/types";
import type { CustomerEnrichment, MondayActivityCache } from "@/lib/cache/integrations";

// ─── Formatters (shared across view-model builders) ────────────────────
export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return d;
}

// ─── Row 1: Hero + Health Spotlight ────────────────────────────────────

export interface HeroCardProps {
  customerKey: string;
  displayName: string;
  category: string;
  lifecycleGroup: string | null;
  aeOwner: string | null;
  partner: string | null;
  industry: string | null;
  renewalDate: string | null;
  protectedFields: string[];
  lastManuallyEditedAt: string | null;
  knownAes: string[];
  knownPartners: string[];
  knownCategories: string[];
}

export function buildHeroProps(
  customer: Customer,
  profile: Profile | null,
  allCustomers: Customer[]
): HeroCardProps {
  const knownAes = Array.from(
    new Set(allCustomers.map((c) => c.ae_owner).filter((v): v is string => !!v))
  ).sort();
  const knownPartners = Array.from(
    new Set(allCustomers.map((c) => c.partner).filter((v): v is string => !!v))
  ).sort();
  const knownCategories = [
    "At Risk","Upcoming Renewals","Strategic Growth","Active",
    "Partner Managed","POV","To Drop","Churned",
    ...Array.from(new Set(allCustomers.map((c) => c.custom_category).filter((v): v is string => !!v))),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const account = null; // passed from enrichment at the page level; hero uses profile
  void account;

  return {
    customerKey: customer.key,
    displayName: customer.display_name,
    category: categoryFromCustomer(customer),
    lifecycleGroup: customer.lifecycle_group,
    aeOwner: customer.ae_owner,
    partner: customer.partner,
    industry: profile?.industry || null,
    renewalDate: profile?.renewal_date ?? null,
    protectedFields: customer.deliveryops_protected_fields ?? [],
    lastManuallyEditedAt: customer.last_manually_edited_at,
    knownAes,
    knownPartners,
    knownCategories,
  };
}

export interface HealthSpotlightProps {
  category: string | null;
  healthScore: number;
  healthExplanation: string;
  churnRisk: "low" | "medium" | "high";
  npsAverage: number | null;
  npsCount: number;
  nextQbrDate: string | null;
  sfAccountOwner: string | null;
}

export function buildHealthSpotlightProps(
  customer: Customer,
  internalProfile: InternalProfile | null,
  npsResponses: Array<{ score: number | null }>,
  sfAccountOwner: string | null
): HealthSpotlightProps {
  const liveScores = npsResponses
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");
  const npsAverage = liveScores.length
    ? Math.round((liveScores.reduce((a, b) => a + b, 0) / liveScores.length) * 10) / 10
    : null;
  return {
    category: customer.custom_category,
    healthScore: deriveHealthScore(customer.custom_category),
    healthExplanation: explainHealthScore(customer.custom_category),
    churnRisk: deriveChurnRisk(customer.custom_category),
    npsAverage,
    npsCount: liveScores.length,
    nextQbrDate: internalProfile?.next_qbr_date ?? null,
    sfAccountOwner,
  };
}

// ─── Row 2: Stat tiles ──────────────────────────────────────────────────

export interface ArrStatProps {
  currentArr: number | null;
  previousArr: number | null;
  direction: "growth" | "contraction" | "flat" | "first-contract" | "no-data";
  deltaPct: number | null;
  renewalDate: string | null;
}

export function buildArrStatProps(
  opps: Array<{
    amount: number | null;
    close_date: string | null;
    is_closed: boolean;
    is_won: boolean;
    probability: number | null;
  }>,
  profile: Profile | null
): ArrStatProps {
  const forDeriv: OppForArr[] = opps.map((o) => ({
    amount: o.amount,
    close_date: o.close_date,
    is_closed: o.is_closed,
    is_won: o.is_won,
    probability: o.probability,
  }));
  const arrDeriv = deriveArr(forDeriv);
  const trend = deriveArrTrend(forDeriv);
  return {
    currentArr: trend.current ?? profile?.arr ?? null,
    previousArr: trend.previous,
    direction: trend.direction,
    deltaPct: trend.delta_pct,
    renewalDate: profile?.renewal_date ?? arrDeriv.renewal_date ?? null,
  };
}

export interface NpsStatProps {
  average: number | null;
  count: number;
  promoters: number;
  passives: number;
  detractors: number;
  latestQuarter: string | null;
}

export function buildNpsStatProps(
  npsResponses: Array<{
    score: number | null;
    category: string | null;
    quarter: string | null;
  }>
): NpsStatProps {
  const withScore = npsResponses.filter((r) => r.score != null);
  const avg = withScore.length
    ? Math.round((withScore.reduce((s, r) => s + r.score!, 0) / withScore.length) * 10) / 10
    : null;

  // Latest quarter by sort order
  const quarters = [...new Set(npsResponses.map((r) => r.quarter).filter(Boolean) as string[])].sort(
    (a, b) => {
      const parse = (s: string) => {
        const m = /^(\d)Q(\d{2})$/.exec(s);
        return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
      };
      return parse(b) - parse(a);
    }
  );

  return {
    average: avg,
    count: npsResponses.length,
    promoters: npsResponses.filter((r) => r.category === "Promoter").length,
    passives: npsResponses.filter((r) => r.category === "Passive").length,
    detractors: npsResponses.filter((r) => r.category === "Detractor").length,
    latestQuarter: quarters[0] ?? null,
  };
}

export interface ProjectsStatProps {
  total: number;
  inProgress: number;
  delivered: number;
  pipeline: number;
  onHold: number;
}

export function buildProjectsStatProps(
  projects: Array<{
    group_title: string | null;
    project_status: string | null;
    go_live_date: string | null;
  }>
): ProjectsStatProps {
  const today = new Date().toISOString().slice(0, 10);
  const inProgress = projects.filter((p) => p.project_status === "In Progress").length;
  const delivered = projects.filter(
    (p) =>
      ["Delivered", "Live"].includes(p.project_status ?? "") ||
      ((p.go_live_date ?? "") <= today && (p.go_live_date ?? "").length >= 8)
  ).length;
  const pipeline = projects.filter((p) => (p.group_title ?? "") === "Pipeline").length;
  const onHold = projects.filter((p) => (p.group_title ?? "") === "On Hold").length;
  return { total: projects.length, inProgress, delivered, pipeline, onHold };
}

// ─── Row 3: Trend charts ─────────────────────────────────────────────────

export interface ArrPoint {
  date: string;
  amount: number;
  type: "Won" | "Open";
  name: string;
}

export function buildArrPoints(
  opps: Array<{
    name: string;
    amount: number | null;
    close_date: string | null;
    is_closed: boolean;
    is_won: boolean;
    probability: number | null;
  }>
): ArrPoint[] {
  return opps
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
}

export interface NpsTrendPoint {
  quarter: string;
  average: number;
  count: number;
  promoter: number;
  passive: number;
  detractor: number;
}

export function buildNpsTrendPoints(
  npsResponses: Array<{
    score: number | null;
    category: string | null;
    quarter: string | null;
  }>
): NpsTrendPoint[] {
  const byQ = new Map<
    string,
    { sum: number; count: number; promoter: number; passive: number; detractor: number }
  >();
  for (const r of npsResponses) {
    if (!r.quarter || r.score == null) continue;
    const prev = byQ.get(r.quarter) ?? { sum: 0, count: 0, promoter: 0, passive: 0, detractor: 0 };
    prev.sum += r.score;
    prev.count++;
    if (r.category === "Promoter") prev.promoter++;
    else if (r.category === "Passive") prev.passive++;
    else if (r.category === "Detractor") prev.detractor++;
    byQ.set(r.quarter, prev);
  }
  return [...byQ.entries()]
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
}

// ─── Row 4: Commercial detail ─────────────────────────────────────────────

export interface OpportunitiesCardProps {
  accountName: string | null;
  accountIndustry: string | null;
  accountRevenue: number | null;
  accountEmployees: number | null;
  accountOwner: string | null;
  accountHq: string | null;
  accountWebsite: string | null;
  accountPhone: string | null;
  sfAccountId: string | null;
  opportunities: Array<{
    sf_id: string;
    name: string;
    stage_name: string | null;
    amount: number | null;
    close_date: string | null;
    is_won: boolean;
    is_closed: boolean;
    owner_name: string | null;
    probability: number | null;
  }>;
  cases: Array<{
    sf_id: string;
    case_number: string | null;
    subject: string | null;
    status: string | null;
    priority: string | null;
    is_closed: boolean;
  }>;
  salesforceSyncedAt: string | null;
}

export function buildOpportunitiesCardProps(
  customer: Customer,
  enrichment: CustomerEnrichment | null
): OpportunitiesCardProps {
  const acc = enrichment?.account ?? null;
  return {
    accountName: acc?.name ?? null,
    accountIndustry: acc?.industry ?? null,
    accountRevenue: acc?.annual_revenue ?? null,
    accountEmployees: acc?.number_of_employees ?? null,
    accountOwner: acc?.owner_name ?? null,
    accountHq: [acc?.billing_city, acc?.billing_country].filter(Boolean).join(", ") || null,
    accountWebsite: acc?.website ?? null,
    accountPhone: acc?.phone ?? null,
    sfAccountId: customer.salesforce_account_id,
    opportunities: (enrichment?.opportunities ?? []).map((o) => ({
      sf_id: o.sf_id,
      name: o.name,
      stage_name: o.stage_name,
      amount: o.amount,
      close_date: o.close_date,
      is_won: o.is_won,
      is_closed: o.is_closed,
      owner_name: o.owner_name,
      probability: o.probability,
    })),
    cases: (enrichment?.cases ?? []).map((c) => ({
      sf_id: c.sf_id,
      case_number: c.case_number,
      subject: c.subject,
      status: c.status,
      priority: c.priority,
      is_closed: c.is_closed,
    })),
    salesforceSyncedAt: enrichment?.freshness.salesforce_synced_at ?? null,
  };
}

export interface ProjectsCardProps {
  customerName: string;
  projects: Array<{
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
  }>;
  mondaySyncedAt: string | null;
}

export function buildProjectsCardProps(
  customer: Customer,
  enrichment: CustomerEnrichment | null
): ProjectsCardProps {
  return {
    customerName: customer.display_name,
    projects: enrichment?.projects ?? [],
    mondaySyncedAt: enrichment?.freshness.monday_synced_at ?? null,
  };
}

// ─── Row 5: Relationship ──────────────────────────────────────────────────

export interface NpsResponsesCardProps {
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
}

export interface ContactsCardProps {
  contacts: Array<{
    name: string;
    role: string;
    email: string;
    phone: string;
    notes: string;
  }>;
}

// ─── Row 6: Audit ─────────────────────────────────────────────────────────

export interface ActivityLogCardProps {
  customerName: string;
  activities: MondayActivityCache[];
  openCount: number;
}

export function buildActivityLogCardProps(
  customer: Customer,
  enrichment: CustomerEnrichment | null
): ActivityLogCardProps {
  const activities = enrichment?.activities ?? [];
  const openCount = activities.filter(
    (a) => (a.status ?? "").toLowerCase() !== "closed" && !a.resolved_date
  ).length;
  return { customerName: customer.display_name, activities, openCount };
}

export interface EventsTasksCardProps {
  events: Array<{
    id: string;
    event_type: string;
    summary: string;
    tags: string[];
    ts: string;
  }>;
  activeTasks: Array<{
    id: string;
    name: string;
    description: string | null;
    next_run: string | null;
  }>;
}

export function buildEventsTasksCardProps(
  events: CuratorEvent[],
  tasks: CuratorTask[]
): EventsTasksCardProps {
  return {
    events: events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      summary: e.summary,
      tags: e.tags,
      ts: e.ts,
    })),
    activeTasks: tasks
      .filter((t) => t.status === "active")
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        next_run: t.next_run,
      })),
  };
}

// ─── Row 7: Technical Metadata ───────────────────────────────────────────

export interface MetadataCardProps {
  tier: string | null;
  deploymentStage: string;
  renewalDate: string | null;
  arr: number;
  creditLimit: number;
  automationsLive: number;
  activeUsers: number;
  salesforceAccountId: string | null;
  mondayItemId: string | null;
  mondayWorkspaceId: string | null;
  slackChannel: string | null;
  emailAlias: string | null;
  driveFolderId: string | null;
  kognitosV1DepartmentId: string | null;
  kognitosV2WorkspaceId: string | null;
  protectedFields: string[];
  lastManuallyEditedAt: string | null;
}

export function buildMetadataCardProps(
  customer: Customer,
  profile: Profile | null
): MetadataCardProps {
  return {
    tier: profile?.tier ?? null,
    deploymentStage: profile?.deployment_stage ?? "onboarding",
    renewalDate: profile?.renewal_date ?? null,
    arr: profile?.arr ?? 0,
    creditLimit: profile?.credit_limit ?? 0,
    automationsLive: profile?.automations_live ?? 0,
    activeUsers: profile?.active_users ?? 0,
    salesforceAccountId: customer.salesforce_account_id,
    mondayItemId: customer.monday_item_id,
    mondayWorkspaceId: customer.monday_workspace_id,
    slackChannel: customer.slack_channel,
    emailAlias: customer.email_alias,
    driveFolderId: customer.drive_folder_id,
    kognitosV1DepartmentId: customer.kognitos_v1_department_id,
    kognitosV2WorkspaceId: customer.kognitos_v2_workspace_id,
    protectedFields: customer.deliveryops_protected_fields ?? [],
    lastManuallyEditedAt: customer.last_manually_edited_at,
  };
}
