// Weekly Delivery Review — customer-grouped, per-process detail, for the
// Delivery + Customer Success team (Rishabh, 2026-08-07: "club customers'
// work and data together" — grouping by customer, not by status bucket,
// after seeing both laid out). Reads `processes` natively, no Monday-legacy
// translation needed since this is new UI.

import type { Process, ProcessBlockedOn } from "@/lib/supabase/types";
import { ARCHIVE_LIFECYCLES as ARCHIVE_LIFECYCLE_LIST } from "@/lib/supabase/types";

export type DeliveryReviewStatus = "done" | "coming_up" | "blocked" | "live";

export interface Period {
  start: Date;
  end: Date;
}

// Reuse the canonical taxonomy (lib/supabase/types.ts) rather than
// redeclaring the archive lifecycles locally — that list is the single
// source of truth for the active/delivered/archive partition of
// PROCESS_LIFECYCLES.
const ARCHIVE_LIFECYCLES = new Set(ARCHIVE_LIFECYCLE_LIST);

function inPeriod(iso: string | null, period: Period): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= period.start && d <= period.end;
}

/** Per-process status for this report. Blocked beats everything else — a
 *  process that is technically "live" but flagged at_risk still needs
 *  attention. Archived lifecycles return null: excluded entirely, they're
 *  not part of a "what's happening right now" review. */
export function statusForProcess(p: Process, period: Period): DeliveryReviewStatus | null {
  if (ARCHIVE_LIFECYCLES.has(p.lifecycle)) return null;
  if (p.blocked_on !== "none" || p.health === "at_risk" || p.health === "off_track" || p.needs_attention) {
    return "blocked";
  }
  if (p.lifecycle === "live") {
    return inPeriod(p.go_live_date, period) || inPeriod(p.went_live_at, period) ? "done" : "live";
  }
  return "coming_up";
}

const BLOCKED_ON_LABEL: Record<ProcessBlockedOn, string> = {
  none: "",
  customer: "Blocked on customer",
  kognitos_engg: "Blocked on engineering",
  kognitos_delivery: "Blocked on delivery",
  partner: "Blocked on partner",
};

export interface DeliveryReviewProcessItem {
  id: string;
  name: string;
  status: DeliveryReviewStatus;
  phase: string | null;
  complexity: string | null;
  platform: string;
  goLiveDate: string | null;
  kickoffDate: string | null;
  ttvDays: number | null;
  blockedReasonLabel: string | null; // e.g. "Blocked on customer" — null when not blocked
  blockedNote: string | null; // free-text from Process.blockers
  daysSinceUpdate: number;
  linkedTicketIds: string[];
}

function toItem(p: Process, status: DeliveryReviewStatus, now: Date): DeliveryReviewProcessItem {
  return {
    id: p.id,
    name: p.process_name,
    status,
    phase: p.phase,
    complexity: p.complexity,
    platform: p.platform,
    goLiveDate: p.go_live_date,
    kickoffDate: p.kickoff_date,
    ttvDays: p.ttv_days,
    blockedReasonLabel: status === "blocked" && p.blocked_on !== "none" ? BLOCKED_ON_LABEL[p.blocked_on] : null,
    blockedNote: p.blockers,
    daysSinceUpdate: Math.floor((now.getTime() - new Date(p.updated_at).getTime()) / 86_400_000),
    linkedTicketIds: p.linear_ticket_ids,
  };
}

export interface DeliveryReviewCustomerGroup {
  customerKey: string;
  customerName: string;
  arr: number;
  renewalInDays: number | null;
  hasBlocked: boolean;
  processes: DeliveryReviewProcessItem[];
}

export interface LongestUntouchedItem {
  customerName: string;
  processName: string;
  daysSinceUpdate: number;
  lifecycle: string;
}

export interface DeliveryReviewReport {
  customerGroups: DeliveryReviewCustomerGroup[];
  longestUntouched: LongestUntouchedItem[];
}

const STALE_THRESHOLD_DAYS = 30;
const LONGEST_UNTOUCHED_MAX = 10;

// Renewal dates are stored date-only (SF close_date, e.g. "2026-09-24"), which
// parses to midnight UTC. `now` typically carries a real time-of-day, so
// diffing the two raw timestamps lets the elapsed fraction of "today" erode
// the day count — a renewal that is genuinely 18 calendar days out can read
// as 17 (or 18 vs 19) depending what time of day the report runs. Snapping
// `now` to midnight UTC first makes the day count exact and independent of
// time-of-day — same fix as lib/reports/allhands-signals.ts's
// findRenewalSpotlight, which hit this exact bug during the All-Hands review.
function startOfDayUTC(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function buildDeliveryReview(
  processes: Process[],
  customers: Array<{ id: string; key: string; display_name: string }>,
  arrByCustomer: Map<string, { arr: number; renewal_date: string | null }>,
  period: Period,
  now: Date
): DeliveryReviewReport {
  const custById = new Map(customers.map((c) => [c.id, c]));
  const itemsByCustomer = new Map<string, DeliveryReviewProcessItem[]>();

  for (const p of processes) {
    if (!p.customer_id) continue;
    const status = statusForProcess(p, period);
    if (!status) continue;
    const list = itemsByCustomer.get(p.customer_id) ?? [];
    list.push(toItem(p, status, now));
    itemsByCustomer.set(p.customer_id, list);
  }

  const today = startOfDayUTC(now);

  const customerGroups: DeliveryReviewCustomerGroup[] = [];
  for (const [customerId, items] of itemsByCustomer) {
    const customer = custById.get(customerId);
    if (!customer) continue;
    const arr = arrByCustomer.get(customerId);
    const renewalInDays = arr?.renewal_date
      ? Math.round((new Date(arr.renewal_date).getTime() - today.getTime()) / 86_400_000)
      : null;
    customerGroups.push({
      customerKey: customer.key,
      customerName: customer.display_name,
      arr: arr?.arr ?? 0,
      renewalInDays,
      hasBlocked: items.some((i) => i.status === "blocked"),
      processes: items,
    });
  }

  customerGroups.sort((a, b) => {
    if (a.hasBlocked !== b.hasBlocked) return a.hasBlocked ? -1 : 1;
    if (a.renewalInDays != null && b.renewalInDays != null) return a.renewalInDays - b.renewalInDays;
    if (a.renewalInDays != null) return -1;
    if (b.renewalInDays != null) return 1;
    return a.customerName.localeCompare(b.customerName);
  });

  const longestUntouched: LongestUntouchedItem[] = processes
    .filter((p) => !ARCHIVE_LIFECYCLES.has(p.lifecycle) && p.lifecycle !== "live")
    .map((p) => ({
      customerName: custById.get(p.customer_id ?? "")?.display_name ?? p.account,
      processName: p.process_name,
      daysSinceUpdate: Math.floor((now.getTime() - new Date(p.updated_at).getTime()) / 86_400_000),
      lifecycle: p.lifecycle,
    }))
    .filter((i) => i.daysSinceUpdate >= STALE_THRESHOLD_DAYS)
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, LONGEST_UNTOUCHED_MAX);

  return { customerGroups, longestUntouched };
}
