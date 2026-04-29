// Per-customer rules — free-form Markdown that the agent must follow.
// Port of legacy/storage/rules.py.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type Rules } from "@/lib/supabase/types";
import { requireCustomerByKey } from "@/lib/customers";

const DEFAULT_RULES = `# Customer rules

<!-- Add dos and don'ts for the agent. These rules are injected into every
     agent interaction and override general guidelines. -->

## Communication preferences
- 

## Topics to avoid
- 

## Escalation policies
- 

## Other notes
- 
`;

export async function getRules(customerKey: string): Promise<string> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  const { data, error } = await sb
    .from(TABLES.rules)
    .select("*")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;

  if (data) return (data as Rules).content;

  const { data: created, error: insertErr } = await sb
    .from(TABLES.rules)
    .insert({ customer_id: customer.id, content: DEFAULT_RULES })
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return (created as Rules).content;
}

export async function updateRules(
  customerKey: string,
  content: string
): Promise<string> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  // Upsert pattern: try update first, insert on miss.
  const { data: existing } = await sb
    .from(TABLES.rules)
    .select("id")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    const { data, error } = await sb
      .from(TABLES.rules)
      .update({ content })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return (data as Rules).content;
  }

  const { data, error } = await sb
    .from(TABLES.rules)
    .insert({ customer_id: customer.id, content })
    .select("*")
    .single();
  if (error) throw error;
  return (data as Rules).content;
}
