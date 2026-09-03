import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/supabase/server";
import type { TicketRow } from "@/lib/tickets/types";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 20;

const SELECT_COLUMNS = "id, title, url, linear_status, status_type, classification, in_scope";

// GET /api/linear-tickets/search?q=... — autocomplete against the existing
// linear_tickets cache (kept fresh by the daily sync), for a process's
// ticket picker. Matches on id or title, case-insensitive.
//
// Two separate .ilike() queries merged here, rather than a single .or()
// call with the raw query interpolated into its filter string — `q` is
// unsanitized user input, and or()'s comma/parenthesis syntax would let a
// crafted value alter the filter rather than just search for text.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ tickets: [] });

  const sb = requireAdmin();
  const pattern = `%${q}%`;
  const [byId, byTitle] = await Promise.all([
    sb.from("linear_tickets").select(SELECT_COLUMNS).ilike("id", pattern).limit(RESULT_LIMIT),
    sb.from("linear_tickets").select(SELECT_COLUMNS).ilike("title", pattern).limit(RESULT_LIMIT),
  ]);
  if (byId.error) return NextResponse.json({ error: byId.error.message }, { status: 500 });
  if (byTitle.error) return NextResponse.json({ error: byTitle.error.message }, { status: 500 });

  const seen = new Set<string>();
  const tickets: Partial<TicketRow>[] = [];
  for (const row of [...(byId.data ?? []), ...(byTitle.data ?? [])] as Partial<TicketRow>[]) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    tickets.push(row);
    if (tickets.length >= RESULT_LIMIT) break;
  }
  return NextResponse.json({ tickets });
}
