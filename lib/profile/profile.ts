// Profile + internal-profile reads/writes.
// Port of legacy/storage/profile.py — JSON files become typed Postgres rows.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type Profile, type InternalProfile } from "@/lib/supabase/types";
import { requireCustomerByKey } from "@/lib/customers";

const DEFAULT_PROFILE: Omit<Profile, "id" | "customer_id" | "created_at" | "updated_at" | "deleted_at"> = {
  industry: "",
  employee_count: 0,
  website: "",
  headquarters: "",
  fiscal_year_end: "",
  tier: null,
  start_date: null,
  renewal_date: null,
  arr: 0,
  credit_limit: 0,
  billing_contact: "",
  deployment_stage: "onboarding",
  automations_live: 0,
  active_users: 0,
  credits_used_mtd: 0,
  last_active_date: null,
  contacts: [],
  business_objectives: [],
  success_criteria: [],
  target_roi: "",
  custom: {},
  last_updated_by: null,
};

const DEFAULT_INTERNAL: Omit<
  InternalProfile,
  "id" | "customer_id" | "created_at" | "updated_at" | "deleted_at"
> = {
  health_score: 0,
  nps_score: 0,
  csat_score: 0,
  last_qbr_date: null,
  next_qbr_date: null,
  churn_risk: "low",
  strategic_notes: "",
  internal_notes: "",
  last_updated_by: null,
  custom: {},
};

export async function getProfile(customerKey: string): Promise<Profile> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  const { data, error } = await sb
    .from(TABLES.profiles)
    .select("*")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;

  if (data) return data as Profile;

  const { data: created, error: insertErr } = await sb
    .from(TABLES.profiles)
    .insert({ customer_id: customer.id, ...DEFAULT_PROFILE })
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return created as Profile;
}

const PROFILE_SCHEMA_FIELDS: ReadonlyArray<keyof Profile> = [
  "industry",
  "employee_count",
  "website",
  "headquarters",
  "fiscal_year_end",
  "tier",
  "start_date",
  "renewal_date",
  "arr",
  "credit_limit",
  "billing_contact",
  "deployment_stage",
  "automations_live",
  "active_users",
  "credits_used_mtd",
  "last_active_date",
  "contacts",
  "business_objectives",
  "success_criteria",
  "target_roi",
];

const INTERNAL_PROFILE_SCHEMA_FIELDS: ReadonlyArray<keyof InternalProfile> = [
  "health_score",
  "nps_score",
  "csat_score",
  "last_qbr_date",
  "next_qbr_date",
  "churn_risk",
  "strategic_notes",
  "internal_notes",
];

export async function updateProfile(
  customerKey: string,
  updates: Record<string, unknown>,
  opts: { updatedBy?: string } = {}
): Promise<Profile> {
  const profile = await getProfile(customerKey);
  const sb = requireAdmin();

  const knownFields = new Set<string>(PROFILE_SCHEMA_FIELDS as readonly string[]);
  const patch: Record<string, unknown> = {};
  const customPatch: Record<string, unknown> = { ...(profile.custom ?? {}) };

  for (const [key, value] of Object.entries(updates)) {
    if (key === "custom" && value && typeof value === "object") {
      Object.assign(customPatch, value as Record<string, unknown>);
    } else if (knownFields.has(key)) {
      patch[key] = value;
    } else {
      customPatch[key] = value;
    }
  }

  const { data, error } = await sb
    .from(TABLES.profiles)
    .update({
      ...patch,
      custom: customPatch,
      last_updated_by: opts.updatedBy ?? null,
    })
    .eq("id", profile.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function getInternalProfile(customerKey: string): Promise<InternalProfile> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  const { data, error } = await sb
    .from(TABLES.internalProfiles)
    .select("*")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;

  if (data) return data as InternalProfile;

  const { data: created, error: insertErr } = await sb
    .from(TABLES.internalProfiles)
    .insert({ customer_id: customer.id, ...DEFAULT_INTERNAL })
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return created as InternalProfile;
}

export async function updateInternalProfile(
  customerKey: string,
  updates: Record<string, unknown>,
  opts: { updatedBy?: string } = {}
): Promise<InternalProfile> {
  const profile = await getInternalProfile(customerKey);
  const sb = requireAdmin();

  const knownFields = new Set<string>(INTERNAL_PROFILE_SCHEMA_FIELDS as readonly string[]);
  const patch: Record<string, unknown> = {};
  const customPatch: Record<string, unknown> = { ...(profile.custom ?? {}) };

  for (const [key, value] of Object.entries(updates)) {
    if (key === "custom" && value && typeof value === "object") {
      Object.assign(customPatch, value as Record<string, unknown>);
    } else if (knownFields.has(key)) {
      patch[key] = value;
    } else {
      customPatch[key] = value;
    }
  }

  const { data, error } = await sb
    .from(TABLES.internalProfiles)
    .update({
      ...patch,
      custom: customPatch,
      last_updated_by: opts.updatedBy ?? null,
    })
    .eq("id", profile.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as InternalProfile;
}
