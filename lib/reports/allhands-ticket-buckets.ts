// Hard-blocker breakdowns for the All-Hands report — two axes over the SAME
// open hard_blocker ticket set (never a mix of severities; a bucket showing
// "31 tickets" that's mostly cosmetic feedback isn't a blocker signal).
//
// Domain buckets (Quill, IDP, Browser, ...) answer "which category has the
// most blockers". Customer buckets answer "which migration has the most
// blockers" — domain buckets alone hide a single migration (Conectiv) that
// racks up hard blockers across several domains at once, since no one domain
// bucket captures that concentration.

import type { Process } from "@/lib/supabase/types";
import type { TicketRow, TicketDomain } from "@/lib/tickets/types";
import { DOMAIN_LABELS } from "@/lib/tickets/types";

export interface DomainBucket {
  domain: TicketDomain | "unclassified";
  label: string;
  count: number;
  sampleTitles: string[];
}

export function computeDomainBuckets(hardBlockerTickets: TicketRow[]): DomainBucket[] {
  const groups = new Map<string, TicketRow[]>();
  for (const t of hardBlockerTickets) {
    const key = t.domain ?? "unclassified";
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([domain, tickets]) => ({
      domain: domain as TicketDomain | "unclassified",
      label: domain === "unclassified" ? "Unclassified" : DOMAIN_LABELS[domain as TicketDomain],
      count: tickets.length,
      sampleTitles: tickets.slice(0, 3).map((t) => t.title),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface CustomerTicketConcentration {
  customerName: string;
  ticketCount: number;
  sampleTitles: string[];
}

export function computeCustomerTicketConcentration(
  customers: Array<{ id: string; display_name: string }>,
  processesByCustomer: Map<string, Process[]>,
  hardBlockerTicketsById: Map<string, TicketRow>
): CustomerTicketConcentration[] {
  const results: CustomerTicketConcentration[] = [];

  for (const c of customers) {
    const processes = processesByCustomer.get(c.id) ?? [];
    const ticketIds = new Set<string>();
    for (const p of processes) {
      for (const id of p.linear_ticket_ids) ticketIds.add(id);
    }

    const tickets = [...ticketIds]
      .map((id) => hardBlockerTicketsById.get(id))
      .filter((t): t is TicketRow => Boolean(t));
    if (tickets.length === 0) continue;

    results.push({
      customerName: c.display_name,
      ticketCount: tickets.length,
      sampleTitles: tickets.slice(0, 3).map((t) => t.title),
    });
  }

  return results.sort((a, b) => b.ticketCount - a.ticketCount);
}
