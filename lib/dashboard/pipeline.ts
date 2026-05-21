// Upcoming pipeline — SF opportunities closing in the next 90 days.
// Gives the CS team a rolling forward-looking view of what's incoming so
// they can prepare renewals and expansions before they land. A rolling
// window (rather than calendar-quarter) means the section stays useful
// late in a quarter when most upcoming closes are actually in Q+1.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";

const WINDOW_DAYS = 90;

function windowBounds(): { start: string; end: string; label: string } {
  const now = new Date();
  const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const isoDate = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  return {
    start: isoDate(now),
    end: isoDate(end),
    label: `Next ${WINDOW_DAYS} days`,
  };
}

export interface PipelineOpportunity {
  sf_id: string;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  owner_name: string | null;
  customer_key: string | null;
  customer_display_name: string | null;
}

export interface PipelineBundle {
  opportunities: PipelineOpportunity[];
  total_amount: number;
  count: number;
  quarter_label: string;
}

interface OppRow {
  sf_id: string;
  customer_id: string;
  name: string;
  stage_name: string | null;
  amount: number | null;
  close_date: string | null;
  probability: number | null;
  owner_name: string | null;
}

export async function loadUpcomingPipeline(): Promise<PipelineBundle> {
  const sb = requireAdmin();
  const { start, end, label } = windowBounds();

  const [opps, customers] = await Promise.all([
    sb
      .from("sf_opportunities")
      .select("sf_id, customer_id, name, stage_name, amount, close_date, probability, owner_name")
      .eq("is_closed", false)
      .gte("close_date", start)
      .lte("close_date", end)
      .order("amount", { ascending: false })
      .limit(50),
    listCustomers().catch(() => []),
  ]);

  const custById = new Map(customers.map((c) => [c.id, c]));

  const opportunities: PipelineOpportunity[] = ((opps.data as OppRow[] | null) ?? []).map((o) => {
    const cust = custById.get(o.customer_id);
    return {
      sf_id: o.sf_id,
      name: o.name,
      stage_name: o.stage_name,
      amount: o.amount,
      close_date: o.close_date,
      probability: o.probability,
      owner_name: o.owner_name,
      customer_key: cust?.key ?? null,
      customer_display_name: cust?.display_name ?? null,
    };
  });

  const total_amount = opportunities.reduce((s, o) => s + (o.amount ?? 0), 0);

  return {
    opportunities,
    total_amount,
    count: opportunities.length,
    quarter_label: label,
  };
}
