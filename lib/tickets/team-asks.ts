// team_asks CRUD — a deliveryOps-only log of what the team needs right now,
// independent of Linear. Never written back to Linear; a human updates the
// underlying ticket themselves (see supabase/migrations/0017_linear_tickets.sql).

import { requireAdmin } from "@/lib/supabase/server";
import type { AskPriorityTier, AskStatus } from "./types";

export interface CreateTeamAskInput {
  ask_text: string;
  requester: string;
  priority_tier?: AskPriorityTier;
  status?: AskStatus;
  notes?: string | null;
  ticket_ids?: string[];
}

export interface UpdateTeamAskInput {
  ask_text?: string;
  requester?: string;
  priority_tier?: AskPriorityTier;
  status?: AskStatus;
  notes?: string | null;
}

export async function createTeamAsk(input: CreateTeamAskInput) {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from("team_asks")
    .insert({
      ask_text: input.ask_text,
      requester: input.requester,
      priority_tier: input.priority_tier ?? "soon",
      status: input.status ?? "open",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const ask = data as { id: string };
  if (input.ticket_ids && input.ticket_ids.length > 0) {
    await linkTickets(ask.id, input.ticket_ids);
  }
  return ask;
}

export async function updateTeamAsk(id: string, input: UpdateTeamAskInput) {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from("team_asks")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTeamAsk(id: string): Promise<void> {
  const sb = requireAdmin();
  const { error } = await sb.from("team_asks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function linkTickets(askId: string, ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const sb = requireAdmin();
  const rows = ticketIds.map((ticket_id) => ({ ask_id: askId, ticket_id }));
  const { error } = await sb.from("team_ask_tickets").upsert(rows, { onConflict: "ask_id,ticket_id" });
  if (error) throw new Error(error.message);
}

export async function unlinkTicket(askId: string, ticketId: string): Promise<void> {
  const sb = requireAdmin();
  const { error } = await sb
    .from("team_ask_tickets")
    .delete()
    .eq("ask_id", askId)
    .eq("ticket_id", ticketId);
  if (error) throw new Error(error.message);
}
