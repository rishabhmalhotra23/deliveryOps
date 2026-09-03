// process_linear_tickets (0034) — a real many-to-many link between a
// process and the linear_tickets cache, mirroring the shape team_ask_tickets
// already established for the same kind of link (lib/tickets/team-asks.ts).
//
// attachTicket/detachTicket also mirror into processes.linear_ticket_ids
// (via updateProcess(), so field_provenance stays consistent) — every
// existing reader of that array, notably loader.ts's hasV2Evidence(), keeps
// working unchanged.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type Process } from "@/lib/supabase/types";
import { updateProcess, getProcess } from "@/lib/processes/store";
import type { TicketRow } from "@/lib/tickets/types";

export async function listProcessTickets(processId: string): Promise<TicketRow[]> {
  const sb = requireAdmin();
  const { data: links, error: linksError } = await sb
    .from(TABLES.processLinearTickets)
    .select("ticket_id")
    .eq("process_id", processId);
  if (linksError) throw linksError;

  const ticketIds = ((links as { ticket_id: string }[] | null) ?? []).map((l) => l.ticket_id);
  if (ticketIds.length === 0) return [];

  const { data, error } = await sb.from("linear_tickets").select("*").in("id", ticketIds);
  if (error) throw error;
  return (data as TicketRow[]) ?? [];
}

async function mirrorLinearTicketIds(processId: string, actor: string): Promise<void> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processLinearTickets)
    .select("ticket_id")
    .eq("process_id", processId);
  if (error) throw error;
  const ticketIds = ((data as { ticket_id: string }[] | null) ?? []).map((l) => l.ticket_id);
  await updateProcess(processId, { linear_ticket_ids: ticketIds } as Partial<Process>, actor);
}

export async function attachTicket(processId: string, ticketId: string, actor: string): Promise<void> {
  const process = await getProcess(processId);
  if (!process) throw new Error(`Unknown process: ${processId}`);

  const sb = requireAdmin();
  const { error } = await sb
    .from(TABLES.processLinearTickets)
    .upsert(
      { process_id: processId, ticket_id: ticketId, created_by: actor },
      { onConflict: "process_id,ticket_id", ignoreDuplicates: true }
    );
  if (error) throw error;

  await mirrorLinearTicketIds(processId, actor);
}

export async function detachTicket(processId: string, ticketId: string, actor: string): Promise<void> {
  const sb = requireAdmin();
  const { error } = await sb
    .from(TABLES.processLinearTickets)
    .delete()
    .eq("process_id", processId)
    .eq("ticket_id", ticketId);
  if (error) throw error;

  await mirrorLinearTicketIds(processId, actor);
}
