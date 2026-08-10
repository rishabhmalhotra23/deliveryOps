// Per-customer open-ticket concentration for the All-Hands report. Domain
// buckets (Quill, IDP, Browser, ...) already exist as loadTicketsBundle()'s
// domain_groups — this file adds the other axis: some migrations (Conectiv)
// accumulate a disproportionate number of open tickets that span several
// domains at once, so a domain-only view hides the concentration. Surfacing
// it by customer instead makes that visible.

import type { Process } from "@/lib/supabase/types";
import type { TicketRow } from "@/lib/tickets/types";

export interface CustomerTicketConcentration {
  customerName: string;
  openTicketCount: number;
  hardBlockerCount: number;
  sampleTitles: string[];
}

export function computeCustomerTicketConcentration(
  customers: Array<{ id: string; display_name: string }>,
  processesByCustomer: Map<string, Process[]>,
  openTicketsById: Map<string, TicketRow>
): CustomerTicketConcentration[] {
  const results: CustomerTicketConcentration[] = [];

  for (const c of customers) {
    const processes = processesByCustomer.get(c.id) ?? [];
    const ticketIds = new Set<string>();
    for (const p of processes) {
      for (const id of p.linear_ticket_ids) ticketIds.add(id);
    }

    const openTickets = [...ticketIds]
      .map((id) => openTicketsById.get(id))
      .filter((t): t is TicketRow => Boolean(t));
    if (openTickets.length === 0) continue;

    results.push({
      customerName: c.display_name,
      openTicketCount: openTickets.length,
      hardBlockerCount: openTickets.filter((t) => t.classification === "hard_blocker").length,
      sampleTitles: openTickets.slice(0, 3).map((t) => t.title),
    });
  }

  return results.sort((a, b) => b.openTicketCount - a.openTicketCount);
}
