// Field-level staleness for customers/profiles/internal_profiles. A field is
// stale once it's gone longer than its threshold without being confirmed —
// confirmed means either a field_provenance stamp (an actual edit) or, if
// it's never been touched, the record's own updated_at as a fallback.
//
// This deliberately does not distinguish "manually confirmed" from "still
// showing the import-time default" beyond that fallback — the goal is
// surfacing "someone should look at this," not proving nothing changed.

import type { FieldProvenance } from "@/lib/supabase/types";

export type FreshnessSource = "customer" | "profile" | "internal_profile";

export interface FreshnessFieldConfig {
  key: string;
  label: string;
  thresholdDays: number;
  source: FreshnessSource;
}

// The fields this pass tracks staleness for. Add here to cover more —
// nothing else needs to change for a field on profiles/internal_profiles/
// customers, since computeStaleFields reads generically by key.
export const CUSTOMER_FRESHNESS_FIELDS: FreshnessFieldConfig[] = [
  { key: "health_score", label: "Health score", thresholdDays: 30, source: "internal_profile" },
  { key: "churn_risk", label: "Churn risk", thresholdDays: 30, source: "internal_profile" },
  { key: "renewal_date", label: "Renewal date", thresholdDays: 90, source: "profile" },
  { key: "arr", label: "ARR", thresholdDays: 90, source: "profile" },
  { key: "tier", label: "Tier", thresholdDays: 90, source: "profile" },
  { key: "contacts", label: "Contacts", thresholdDays: 90, source: "profile" },
];

export interface StaleField extends FreshnessFieldConfig {
  daysSinceConfirmed: number;
  lastConfirmedBy: string | null;
  lastConfirmedAt: string | null;
}

interface RecordLike {
  field_provenance?: FieldProvenance | null;
  updated_at: string;
}

export interface StalenessSources {
  customer?: RecordLike;
  profile?: RecordLike;
  internalProfile?: RecordLike;
}

const MS_PER_DAY = 86_400_000;

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

function recordFor(sources: StalenessSources, source: FreshnessSource): RecordLike | undefined {
  if (source === "customer") return sources.customer;
  if (source === "profile") return sources.profile;
  return sources.internalProfile;
}

export function computeStaleFields(
  fields: FreshnessFieldConfig[],
  sources: StalenessSources,
  now: Date = new Date()
): StaleField[] {
  const stale: StaleField[] = [];
  for (const field of fields) {
    const record = recordFor(sources, field.source);
    if (!record) continue;

    const stamp = record.field_provenance?.[field.key];
    const lastConfirmedAt = stamp?.at ?? record.updated_at;
    const days = daysBetween(new Date(lastConfirmedAt), now);
    if (days >= field.thresholdDays) {
      stale.push({
        ...field,
        daysSinceConfirmed: days,
        lastConfirmedBy: stamp?.by ?? null,
        lastConfirmedAt: stamp?.at ?? null,
      });
    }
  }
  return stale;
}
