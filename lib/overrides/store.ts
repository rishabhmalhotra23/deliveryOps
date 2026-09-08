// Human corrections to values this app doesn't own. See migration 0041 for
// why this exists at all: Salesforce-derived numbers are computed at read
// time from the sf_* cache, so they have no column to edit, and correcting
// one used to mean editing a hardcoded map and deploying.

import { requireAdmin } from "@/lib/supabase/server";

export const OVERRIDE_ENTITY_TYPES = ["customer", "process", "profile"] as const;
export type OverrideEntityType = (typeof OVERRIDE_ENTITY_TYPES)[number];

export interface FieldOverride {
  id: string;
  entity_type: OverrideEntityType;
  entity_id: string;
  field: string;
  value: unknown;
  synced_value: unknown;
  reason: string | null;
  set_by: string;
  set_at: string;
  updated_at: string;
}

export class InvalidOverrideError extends Error {}

/** Fields that may be overridden, and what they mean.
 *
 *  An allow-list because `field` reaches a resolver keyed by name: a typo
 *  would store an override that silently never applies, which is worse than
 *  a rejected write. Adding a field here is a code change, but adding an
 *  override for an existing field is not — and the second is the operation
 *  people actually perform. */
export const OVERRIDABLE_FIELDS: Record<
  string,
  { entityType: OverrideEntityType; label: string; kind: "money" | "date" | "text" | "number"; source: string }
> = {
  confirmed_arr: {
    entityType: "customer",
    label: "ARR",
    kind: "money",
    source: "Salesforce",
  },
  renewal_date: {
    entityType: "customer",
    label: "Renewal date",
    kind: "date",
    source: "Salesforce",
  },
};

export async function listOverrides(entityType?: OverrideEntityType): Promise<FieldOverride[]> {
  const sb = requireAdmin();
  let q = sb.from("field_overrides").select("*");
  if (entityType) q = q.eq("entity_type", entityType);
  const { data, error } = await q;
  if (error) throw error;
  return (data as FieldOverride[]) ?? [];
}

/** `{ [customerKey]: value }` for one field, which is the shape every ARR
 *  caller wants — the pure derivation functions take a customer key, not a
 *  uuid, so the join happens once here rather than at each of the eight call
 *  sites. */
export async function loadOverrideMap(field: string): Promise<Record<string, unknown>> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from("field_overrides")
    .select("value, customers!inner(key)")
    .eq("entity_type", "customer")
    .eq("field", field);
  if (error) throw error;
  // PostgREST types an embedded relation as an array even when the FK makes
  // it at most one row, so this normalises both shapes rather than asserting
  // one of them.
  const rows = (data as { value: unknown; customers: { key: string } | { key: string }[] | null }[] | null) ?? [];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const rel = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    if (rel?.key) out[rel.key] = row.value;
  }
  return out;
}

export interface SetOverrideInput {
  entityType: OverrideEntityType;
  entityId: string;
  field: string;
  value: unknown;
  /** What the source said at the moment of the correction. */
  syncedValue?: unknown;
  reason?: string | null;
  setBy: string;
}

export async function setOverride(input: SetOverrideInput): Promise<FieldOverride> {
  const spec = OVERRIDABLE_FIELDS[input.field];
  if (!spec) {
    throw new InvalidOverrideError(
      `"${input.field}" can't be overridden. Overridable: ${Object.keys(OVERRIDABLE_FIELDS).join(", ")}.`
    );
  }
  if (spec.entityType !== input.entityType) {
    throw new InvalidOverrideError(
      `"${input.field}" belongs to ${spec.entityType}, not ${input.entityType}.`
    );
  }
  if (input.value == null || input.value === "") {
    throw new InvalidOverrideError("An override needs a value. Clear it instead to fall back to the source.");
  }

  const sb = requireAdmin();
  const { data, error } = await sb
    .from("field_overrides")
    .upsert(
      {
        entity_type: input.entityType,
        entity_id: input.entityId,
        field: input.field,
        value: input.value,
        synced_value: input.syncedValue ?? null,
        reason: input.reason?.trim() || null,
        set_by: input.setBy,
      },
      { onConflict: "entity_type,entity_id,field" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as FieldOverride;
}

/** Removes the correction so the field falls back to whatever the source
 *  says. Deliberately a delete rather than a `cleared_at` flag: a reverted
 *  override carries no information the events log doesn't, and keeping rows
 *  around would make the unique index — the thing that guarantees one live
 *  override per field — much harder to reason about. */
export async function clearOverride(
  entityType: OverrideEntityType,
  entityId: string,
  field: string
): Promise<boolean> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from("field_overrides")
    .delete()
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("field", field)
    .select("id");
  if (error) throw error;
  return ((data as unknown[]) ?? []).length > 0;
}
