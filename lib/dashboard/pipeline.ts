// Upcoming pipeline — SF opportunities closing in the current quarter.
// Gives the CS team a forward-looking view of what's incoming so they
// can prepare renewals and expansions before they land.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";

function currentQuarterBounds(): { start: string; end: string; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  const qStart = Math.floor(m / 3) * 3; // 0, 3, 6, or 9
  const qEnd = qStart + 2;

  const pad = (n: number) => String(n + 1).padStart(2, "0");
  const lastDay = (year: number, month: number) =>
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const start = `${y}-${pad(qStart)}-01`;
  const end = `${y}-${pad(qEnd)}-${lastDay(y, qEnd)}`;
  const q = Math.floor(m / 3) + 1;
  const label = `Q${q} ${y}`;
  return { start, end, label };
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
  const { start, end, label } = currentQuarterBounds();

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
