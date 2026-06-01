// Confirmed ARR — single source for dashboard totals, customer strips,
// and ARR drill-downs.  Matches GTM weekly reporting:
//   • Most recent Closed-Won SF opp with close_date ≤ today
//   • No open/pipeline opps in the headline number
//
// When Salesforce has duplicate or forward-dated renewals that don't match
// GTM truth, add a per-customer override here (key = customers.key).

export type OppForConfirmedArr = {
  amount: number | null;
  close_date: string | null;
  is_won: boolean;
  is_closed: boolean;
  stage_name?: string | null;
};

export interface ConfirmedArrResult {
  arr: number;
  stage: string | null;
  renewal_date: string | null;
  source_close_date: string | null;
}

/** GTM-corrected confirmed ARR when SF cache is wrong or noisy. */
export const CONFIRMED_ARR_OVERRIDES: Readonly<Record<string, number>> = {
  norco: 284_000,
};

export function deriveConfirmedArrFromOpps(opps: OppForConfirmedArr[]): ConfirmedArrResult {
  const today = new Date().toISOString().slice(0, 10);
  const confirmed = opps
    .filter((o) => o.is_won && (o.close_date ?? "") <= today && o.amount != null)
    .sort((a, b) => ((a.close_date ?? "") < (b.close_date ?? "") ? 1 : -1));

  const nextRenewal = opps
    .filter((o) => !o.is_closed && (o.close_date ?? "") > today)
    .sort((a, b) => ((a.close_date ?? "") < (b.close_date ?? "") ? -1 : 1));

  if (confirmed.length === 0) {
    return { arr: 0, stage: null, renewal_date: nextRenewal[0]?.close_date ?? null, source_close_date: null };
  }
  return {
    arr: confirmed[0].amount ?? 0,
    stage: confirmed[0].stage_name ?? null,
    renewal_date: nextRenewal[0]?.close_date ?? null,
    source_close_date: confirmed[0].close_date,
  };
}

export function getConfirmedArrForCustomer(
  customerKey: string | null | undefined,
  opps: OppForConfirmedArr[]
): ConfirmedArrResult {
  const derived = deriveConfirmedArrFromOpps(opps);
  const override = customerKey ? CONFIRMED_ARR_OVERRIDES[customerKey] : undefined;
  if (override == null) return derived;
  return { ...derived, arr: override };
}
