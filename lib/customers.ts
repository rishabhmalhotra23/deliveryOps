// Customer registry — Phase-1 replacement for legacy/curator/customers.py.
// All reads/writes go through Supabase; helpers cache by customer key for the
// duration of a single request.

import { requireAdmin } from "./supabase/server";
import { TABLES, type Customer } from "./supabase/types";

export class CustomerNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown customer: ${key}`);
    this.name = "CustomerNotFoundError";
  }
}

export async function getCustomerByKey(key: string): Promise<Customer | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .select("*")
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Customer | null) ?? null;
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Customer | null) ?? null;
}

export async function requireCustomerByKey(key: string): Promise<Customer> {
  const c = await getCustomerByKey(key);
  if (!c) throw new CustomerNotFoundError(key);
  return c;
}

export async function listCustomers(): Promise<Customer[]> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .select("*")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data as Customer[]) ?? [];
}

// Resolve "acme" or "acme-platform" channel → customer key.
// Slack channels for a given customer typically share the prefix.
export async function resolveCustomerFromChannel(channelName: string): Promise<Customer | null> {
  const sb = requireAdmin();
  const normalized = channelName.replace(/^#/, "").toLowerCase();
  const { data, error } = await sb
    .from(TABLES.customers)
    .select("*")
    .is("deleted_at", null);
  if (error) throw error;
  const customers = (data as Customer[]) ?? [];

  // Exact match first
  const exact = customers.find((c) => c.slack_channel?.toLowerCase() === normalized);
  if (exact) return exact;

  // Then prefix match against the customer key
  const prefix = customers.find((c) => normalized.startsWith(c.key.toLowerCase()));
  return prefix ?? null;
}

export async function createCustomer(input: {
  key: string;
  display_name: string;
  slack_channel?: string;
  email_alias?: string;
  drive_folder_id?: string;
}): Promise<Customer> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .insert({
      key: input.key,
      display_name: input.display_name,
      slack_channel: input.slack_channel ?? null,
      email_alias: input.email_alias ?? null,
      drive_folder_id: input.drive_folder_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Customer;
}
