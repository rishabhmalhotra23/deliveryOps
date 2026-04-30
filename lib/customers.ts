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

export interface CreateCustomerInput {
  key: string;
  display_name: string;
  slack_channel?: string | null;
  email_alias?: string | null;
  drive_folder_id?: string | null;
  monday_item_id?: string | null;
  monday_workspace_id?: string | null;
  salesforce_account_id?: string | null;
  kognitos_v1_department_id?: string | null;
  kognitos_v1_workspace_id?: string | null;
  kognitos_v2_workspace_id?: string | null;
  partner?: string | null;
  ce_owner?: string | null;
  lifecycle_group?: string | null;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .insert({
      key: input.key,
      display_name: input.display_name,
      slack_channel: input.slack_channel ?? null,
      email_alias: input.email_alias ?? null,
      drive_folder_id: input.drive_folder_id ?? null,
      monday_item_id: input.monday_item_id ?? null,
      monday_workspace_id: input.monday_workspace_id ?? null,
      salesforce_account_id: input.salesforce_account_id ?? null,
      kognitos_v1_department_id: input.kognitos_v1_department_id ?? null,
      kognitos_v1_workspace_id: input.kognitos_v1_workspace_id ?? null,
      kognitos_v2_workspace_id: input.kognitos_v2_workspace_id ?? null,
      partner: input.partner ?? null,
      ce_owner: input.ce_owner ?? null,
      lifecycle_group: input.lifecycle_group ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function upsertCustomer(input: CreateCustomerInput): Promise<Customer> {
  const sb = requireAdmin();
  const existing = await getCustomerByKey(input.key);
  if (!existing) return createCustomer(input);

  const { data, error } = await sb
    .from(TABLES.customers)
    .update({
      display_name: input.display_name,
      slack_channel: input.slack_channel ?? existing.slack_channel,
      email_alias: input.email_alias ?? existing.email_alias,
      drive_folder_id: input.drive_folder_id ?? existing.drive_folder_id,
      monday_item_id: input.monday_item_id ?? existing.monday_item_id,
      monday_workspace_id: input.monday_workspace_id ?? existing.monday_workspace_id,
      salesforce_account_id: input.salesforce_account_id ?? existing.salesforce_account_id,
      kognitos_v1_department_id: input.kognitos_v1_department_id ?? existing.kognitos_v1_department_id,
      kognitos_v1_workspace_id: input.kognitos_v1_workspace_id ?? existing.kognitos_v1_workspace_id,
      kognitos_v2_workspace_id: input.kognitos_v2_workspace_id ?? existing.kognitos_v2_workspace_id,
      partner: input.partner ?? existing.partner,
      ce_owner: input.ce_owner ?? existing.ce_owner,
      lifecycle_group: input.lifecycle_group ?? existing.lifecycle_group,
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function deleteCustomer(key: string): Promise<boolean> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .update({ deleted_at: new Date().toISOString() })
    .eq("key", key)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// Slugify a Monday customer name into a stable customer key.
//   "Dish - Ecostar"             → "dish-ecostar"
//   "Charleston County School District" → "charleston-county-school-district"
//   "SSD/SKP"                    → "ssd-skp"
//   "Bradley & Beams"            → "bradley-beams"
export function slugifyCustomerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}
