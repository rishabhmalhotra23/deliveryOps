// Conversation persistence — every Slack/email exchange survives as both a
// row in `conversations` and a structured event in `events`.
// Port of legacy/storage/conversations.py.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type Conversation } from "@/lib/supabase/types";
import { requireCustomerByKey } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";

export async function saveConversation(
  customerKey: string,
  input: {
    channel: string;
    user_id: string;
    user_name?: string;
    user_message: string;
    bot_response: string;
  }
): Promise<Conversation> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();
  const ts = new Date();

  const { data, error } = await sb
    .from(TABLES.conversations)
    .insert({
      customer_id: customer.id,
      channel: input.channel,
      user_id: input.user_id,
      user_name: input.user_name ?? "",
      user_message: input.user_message,
      bot_response: input.bot_response,
      ts: ts.toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;

  await appendEvent(
    customerKey,
    "SLACK_CONVERSATION",
    {
      channel: input.channel,
      user_id: input.user_id,
      user_name: input.user_name ?? "",
      message: input.user_message.slice(0, 2000),
      response: input.bot_response.slice(0, 2000),
    },
    {
      summary: `Slack (${input.user_name || input.user_id}): ${input.user_message.slice(0, 100)}`,
      tags: ["slack", "conversation"],
      ts,
    }
  );

  return data as Conversation;
}

export async function recentConversations(
  customerKey: string,
  limit: number = 25
): Promise<Conversation[]> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.conversations)
    .select("*")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .order("ts", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return (data as Conversation[]) ?? [];
}
