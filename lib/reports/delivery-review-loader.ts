// Weekly Delivery Review loader — composes the pure buildDeliveryReview()
// derivation (lib/reports/delivery-review.ts, Task 2) with the shared
// date-range resolver (lib/reports/date-range.ts, built for the All-Hands
// report so this plan doesn't duplicate it) and the confirmed-ARR helper
// (lib/commercials/confirmed-arr.ts). No new business logic here — this
// file only fetches rows and shapes them for the pure function.

import { requireAdmin } from "@/lib/supabase/server";
import { resolveRange, type DateRange, type RangeRequest } from "@/lib/reports/date-range";
import { buildDeliveryReview, type DeliveryReviewReport } from "@/lib/reports/delivery-review";
import {
  getConfirmedArrForCustomer,
  CONFIRMED_ARR_OVERRIDES,
  type OppForConfirmedArr,
} from "@/lib/commercials/confirmed-arr";
import { TABLES, type Process } from "@/lib/supabase/types";

export interface DeliveryReviewLoaderResult extends DeliveryReviewReport {
  range: DateRange;
  generatedAt: string;
}

interface CustomerRow {
  id: string;
  key: string;
  display_name: string;
}

export async function loadDeliveryReview(req: RangeRequest = {}): Promise<DeliveryReviewLoaderResult> {
  const sb = requireAdmin();
  const range = resolveRange(req);
  const now = new Date();

  const [processesRes, customersRes, oppsRes] = await Promise.all([
    // Deterministic row order — without it, process rows within a customer
    // card have no defined order and can shift between page loads (Important
    // 3). buildDeliveryReview() re-sorts by status-rank then name for display,
    // but that re-sort should operate on a stable base order, not raw
    // whatever-Postgres-felt-like-that-day order.
    sb.from(TABLES.processes).select("*").order("id", { ascending: true }),
    sb.from("customers").select("id, key, display_name").is("deleted_at", null),
    sb.from("sf_opportunities").select("customer_id, amount, close_date, is_won, is_closed, stage_name"),
  ]);
  // Throw rather than silently degrade to empty arrays on a failed read — a
  // read-failure disguised as "zero active work" was a real Critical finding
  // in the sibling All-Hands report plan's final review (2026-08-07). Matches
  // the existing precedent in lib/processes/loader.ts's fetchAllProcessRows().
  if (processesRes.error) throw processesRes.error;
  if (customersRes.error) throw customersRes.error;
  if (oppsRes.error) throw oppsRes.error;

  const customers = (customersRes.data as CustomerRow[] | null) ?? [];

  const oppsByCustomer = new Map<string, OppForConfirmedArr[]>();
  for (const o of (oppsRes.data as (OppForConfirmedArr & { customer_id: string })[] | null) ?? []) {
    const list = oppsByCustomer.get(o.customer_id) ?? [];
    list.push(o);
    oppsByCustomer.set(o.customer_id, list);
  }
  // ConfirmedArrResult.source_close_date is null when there's no Closed-Won
  // opp to confirm ARR from — distinct from a confirmed $0. Surface that as a
  // null `arr` (Important 4) rather than defaulting to 0, which would
  // fabricate a figure the data doesn't support (real cases: iHeartRadio,
  // SSD/SKP, TSM Law, Wipro FSS). A per-customer override (e.g. Norco) still
  // counts as a confirmed source even if the derived opp-based lookup found
  // none, since the override itself *is* GTM-confirmed truth.
  const arrByCustomer = new Map(
    customers.map((c) => {
      const confirmed = getConfirmedArrForCustomer(c.key, oppsByCustomer.get(c.id) ?? []);
      const hasConfirmedSource = confirmed.source_close_date != null || c.key in CONFIRMED_ARR_OVERRIDES;
      return [c.id, { arr: hasConfirmedSource ? confirmed.arr : null, renewal_date: confirmed.renewal_date }];
    })
  );

  const processes = (processesRes.data as Process[] | null) ?? [];

  // Caveat carried over from Task 2 (lib/reports/delivery-review.ts):
  // statusForProcess() only classifies a "live" process as "done" (shipped
  // this period) when go_live_date or went_live_at falls inside the window;
  // otherwise it reads as "live" (steady state, no news). No write path
  // currently stamps either field when a process's `lifecycle` flips to
  // "live" outside the legacy V2-migration flow (lib/migrations/store.ts
  // only stamps went_live_at for migration_stage -> live_on_v2). A process
  // that went live this week via a plain lifecycle edit can therefore
  // under-report as "live" instead of "done" here. That's a gap in the
  // write path, not in this loader or the derivation it calls.
  const report = buildDeliveryReview(
    processes,
    customers,
    arrByCustomer,
    { start: range.start, end: range.end },
    now
  );

  return { ...report, range, generatedAt: now.toISOString() };
}
