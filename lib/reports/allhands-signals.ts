// Two report-specific signals that tie migration status to commercial
// urgency — the one place Delivery and Customer Success genuinely need the
// same information at the same time (Rishabh, 2026-08-07):
//   1. Upcoming-renewal spotlight — shown only when something is actually
//      due soon; the whole block is omitted otherwise (never an empty state).
//   2. At-risk-and-migrating cross-signal — customers tagged At Risk who
//      also have active migration work right now.

import { categoryFromCustomer } from "@/app/_components/brand";
import type { Process, ProcessLifecycle, MigrationStage } from "@/lib/supabase/types";
import { IN_FLIGHT_STAGES } from "@/lib/supabase/types";

export interface CustomerForSignals {
  id: string;
  key: string;
  display_name: string;
  custom_category: string | null;
  lifecycle_group: string | null;
}

export interface ArrForSignals {
  arr: number;
  renewal_date: string | null;
}

type ProcessForSignals = Pick<Process, "lifecycle" | "migration_stage">;

const RENEWAL_WINDOW_DAYS = 90;

export interface RenewalSpotlight {
  customerKey: string;
  customerName: string;
  renewalInDays: number;
  arr: number;
  liveProcessCount: number;
  migratingProcessCount: number;
}

function isMigrating(stage: MigrationStage): boolean {
  return IN_FLIGHT_STAGES.includes(stage);
}

function isLive(lifecycle: ProcessLifecycle): boolean {
  return lifecycle === "live";
}

// Renewal dates are stored date-only (SF close_date, e.g. "2026-09-24"), which
// parses to midnight UTC. `now` is typically `new Date()` at call time and
// carries a real time-of-day, so diffing the two raw timestamps lets the
// elapsed fraction of "today" erode the day count — a renewal that is
// genuinely 91 calendar days out can round down to "90 days" late in the day
// and wrongly land inside the window (or the reverse near the 0-day edge).
// Snapping `now` to midnight UTC first (same fix as lib/reports/date-range.ts's
// startOfDayUTC) makes the day count exact and independent of time-of-day.
function startOfDayUTC(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** The single soonest-renewing customer within RENEWAL_WINDOW_DAYS, or null.
 *  Only ever surfaces one — this is a spotlight, not a table; if several
 *  customers qualify, the nearest renewal is the one that matters most.
 *
 *  Ties are broken deterministically: soonest renewal, then highest ARR, then
 *  lexicographically smallest customer key. Without this the winner depended
 *  on whatever order Supabase happened to return the `customers` rows in (that
 *  query has no .order()), so the spotlight could switch customers between two
 *  page loads or between the page and its PNG export. Real case as of
 *  2026-08-07: Conectiv, Scan Health and Pepsi all renew 24 days out. */
export function findRenewalSpotlight(
  customers: CustomerForSignals[],
  arrByCustomer: Map<string, ArrForSignals>,
  processesByCustomer: Map<string, ProcessForSignals[]>,
  now: Date
): RenewalSpotlight | null {
  let best: { customer: CustomerForSignals; days: number; arr: ArrForSignals } | null = null;
  const today = startOfDayUTC(now);

  for (const customer of customers) {
    const arr = arrByCustomer.get(customer.id);
    if (!arr?.renewal_date) continue;
    const days = Math.round((new Date(arr.renewal_date).getTime() - today.getTime()) / 86_400_000);
    if (days < 0 || days > RENEWAL_WINDOW_DAYS) continue;
    if (!best) {
      best = { customer, days, arr };
      continue;
    }
    if (days < best.days) {
      best = { customer, days, arr };
      continue;
    }
    if (days > best.days) continue;
    // Tied on days — higher ARR first, then smaller key.
    if (arr.arr > best.arr.arr) {
      best = { customer, days, arr };
      continue;
    }
    if (arr.arr === best.arr.arr && customer.key < best.customer.key) {
      best = { customer, days, arr };
    }
  }

  if (!best) return null;
  const processes = processesByCustomer.get(best.customer.id) ?? [];
  return {
    customerKey: best.customer.key,
    customerName: best.customer.display_name,
    renewalInDays: best.days,
    arr: best.arr.arr,
    liveProcessCount: processes.filter((p) => isLive(p.lifecycle)).length,
    migratingProcessCount: processes.filter((p) => isMigrating(p.migration_stage)).length,
  };
}

export interface AtRiskMigratingEntry {
  customerKey: string;
  customerName: string;
  migratingProcessCount: number;
}

/** Customers whose *current* category resolves to "At Risk" (via the same
 *  categoryFromCustomer() rule used everywhere else in the app) and who have
 *  at least one process in an in-flight migration stage right now. */
export function findAtRiskMigratingCustomers(
  customers: CustomerForSignals[],
  processesByCustomer: Map<string, ProcessForSignals[]>
): AtRiskMigratingEntry[] {
  const out: AtRiskMigratingEntry[] = [];
  for (const customer of customers) {
    const category = categoryFromCustomer(customer);
    if (category !== "At Risk") continue;
    const migratingCount = (processesByCustomer.get(customer.id) ?? []).filter((p) => isMigrating(p.migration_stage)).length;
    if (migratingCount === 0) continue;
    out.push({ customerKey: customer.key, customerName: customer.display_name, migratingProcessCount: migratingCount });
  }
  return out;
}
