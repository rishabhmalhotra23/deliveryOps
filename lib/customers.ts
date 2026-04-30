// Customer registry. Phase 2 model: DeliveryOps is the source of truth for
// every customer; external systems are signal sources we sync from. Manual
// edits (via UI or operations chat) lock the corresponding fields against
// future sync overwrites — we record them in deliveryops_protected_fields.

import { requireAdmin } from "./supabase/server";
import { TABLES, type Customer } from "./supabase/types";

export class CustomerNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown customer: ${key}`);
    this.name = "CustomerNotFoundError";
  }
}

// Field names that, when changed manually in DeliveryOps, get added to
// deliveryops_protected_fields. The sync runner skips these. Other fields
// (display_name from Monday, integration IDs, etc.) stay sync-driven.
export const SYNC_OWNED_BY_DELIVERY_OPS_WHEN_EDITED = new Set([
  "ae_owner",
  "partner",
  "custom_category",
  "lifecycle_group",
  "slack_channel",
  "email_alias",
]);

// ─── Reads ────────────────────────────────────────────────────────────────

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

// Filter that powers the operations chat. All filters are optional and AND'd.
export interface CustomerFilter {
  ae_owner?: string;
  ae_owner_in?: string[];
  partner?: string;
  custom_category?: string;
  custom_category_in?: string[];
  lifecycle_group?: string;
  exclude_categories?: string[];
  has_salesforce?: boolean;
  search?: string;
}

export async function findCustomers(filter: CustomerFilter): Promise<Customer[]> {
  const sb = requireAdmin();
  let q = sb.from(TABLES.customers).select("*").is("deleted_at", null);

  if (filter.ae_owner) q = q.eq("ae_owner", filter.ae_owner);
  if (filter.ae_owner_in?.length) q = q.in("ae_owner", filter.ae_owner_in);
  if (filter.partner) q = q.eq("partner", filter.partner);
  if (filter.custom_category) q = q.eq("custom_category", filter.custom_category);
  if (filter.custom_category_in?.length) q = q.in("custom_category", filter.custom_category_in);
  if (filter.lifecycle_group) q = q.eq("lifecycle_group", filter.lifecycle_group);
  if (filter.exclude_categories?.length) {
    // Postgrest "not in" via raw filter
    q = q.not("custom_category", "in", `(${filter.exclude_categories.map((c) => `"${c}"`).join(",")})`);
  }
  if (filter.has_salesforce === true) q = q.not("salesforce_account_id", "is", null);
  if (filter.has_salesforce === false) q = q.is("salesforce_account_id", null);
  if (filter.search) {
    const pat = `%${filter.search.replace(/[%_]/g, "")}%`;
    q = q.or(`display_name.ilike.${pat},key.ilike.${pat},ae_owner.ilike.${pat}`);
  }

  q = q.order("display_name", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;
  return (data as Customer[]) ?? [];
}

export async function resolveCustomerFromChannel(channelName: string): Promise<Customer | null> {
  const sb = requireAdmin();
  const normalized = channelName.replace(/^#/, "").toLowerCase();
  const { data, error } = await sb
    .from(TABLES.customers)
    .select("*")
    .is("deleted_at", null);
  if (error) throw error;
  const customers = (data as Customer[]) ?? [];

  const exact = customers.find((c) => c.slack_channel?.toLowerCase() === normalized);
  if (exact) return exact;
  const prefix = customers.find((c) => normalized.startsWith(c.key.toLowerCase()));
  return prefix ?? null;
}

// ─── Writes ───────────────────────────────────────────────────────────────

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
  ae_owner?: string | null;
  lifecycle_group?: string | null;
  custom_category?: string | null;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.customers)
    .insert(toInsertRow(input))
    .select("*")
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function upsertCustomer(input: CreateCustomerInput): Promise<Customer> {
  const sb = requireAdmin();
  const existing = await getCustomerByKey(input.key);
  if (!existing) return createCustomer(input);

  // Sync-driven update. Skip protected fields so a Monday/SF row can't
  // overwrite a manually-edited value.
  const protectedSet = new Set(existing.deliveryops_protected_fields ?? []);
  const update: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(toInsertRow(input))) {
    if (field === "key") continue;
    if (protectedSet.has(field)) continue;
    if (value !== undefined) update[field] = value ?? existing[field as keyof Customer] ?? null;
  }

  if (Object.keys(update).length === 0) return existing;

  const { data, error } = await sb
    .from(TABLES.customers)
    .update(update)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Customer;
}

// Manual edit — sets fields and protects them from future sync overwrites.
// Used by the operations chat + dashboard inline edits.
export async function updateCustomerManually(
  key: string,
  updates: Partial<Pick<Customer, "ae_owner" | "partner" | "custom_category" | "lifecycle_group" | "slack_channel" | "email_alias" | "display_name">>
): Promise<Customer> {
  const existing = await requireCustomerByKey(key);
  const sb = requireAdmin();

  const protectedSet = new Set(existing.deliveryops_protected_fields ?? []);
  for (const field of Object.keys(updates)) {
    if (SYNC_OWNED_BY_DELIVERY_OPS_WHEN_EDITED.has(field)) {
      protectedSet.add(field);
    }
  }

  const { data, error } = await sb
    .from(TABLES.customers)
    .update({
      ...updates,
      deliveryops_protected_fields: Array.from(protectedSet),
      last_manually_edited_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function bulkUpdateCustomerField<K extends keyof Customer>(
  customerKeys: string[],
  field: K,
  value: Customer[K]
): Promise<Customer[]> {
  if (!customerKeys.length) return [];
  if (!SYNC_OWNED_BY_DELIVERY_OPS_WHEN_EDITED.has(field as string)) {
    throw new Error(`Field "${String(field)}" is not eligible for bulk manual edit.`);
  }

  const updated: Customer[] = [];
  for (const key of customerKeys) {
    const next = await updateCustomerManually(key, {
      [field]: value,
    } as unknown as Parameters<typeof updateCustomerManually>[1]);
    updated.push(next);
  }
  return updated;
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

// ─── helpers ─────────────────────────────────────────────────────────────

export function slugifyCustomerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function toInsertRow(input: CreateCustomerInput): Record<string, unknown> {
  return {
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
    ae_owner: input.ae_owner ?? null,
    lifecycle_group: input.lifecycle_group ?? null,
    custom_category: input.custom_category ?? null,
  };
}
