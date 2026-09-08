// Tunable scalars that used to be TypeScript constants (0043).
//
// Every getter falls back to the value the constant held. That is deliberate
// and load-bearing: a missing row, an unreachable database or a half-applied
// migration degrades to today's behaviour rather than to zero. A value model
// that silently returns 0 would render every "value delivered" figure as
// nothing and look like a data problem rather than a config problem.

import { requireAdmin } from "@/lib/supabase/server";

export interface AppSetting {
  key: string;
  value: unknown;
  description: string;
  updated_by: string | null;
  updated_at: string;
}

export class InvalidSettingError extends Error {}

/** The compiled defaults, and the allow-list of what may be written. A key
 *  absent from here is rejected: a typo would otherwise store a setting that
 *  nothing ever reads, which is worse than an error. */
export const SETTING_DEFAULTS = {
  "value_model.tier_hours": { low: 1200, medium: 2600, high: 5200 },
  "value_model.rates": { low: 30, mid: 35, high: 45 },
  "value_model.hours_per_fte": 2080,
  "nps.from_address": "ai.cx@kognitos.com",
  "nps.max_auto_reminders": 3,
  "nps.reminder_interval_days": 7,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function listSettings(): Promise<AppSetting[]> {
  const sb = requireAdmin();
  const { data, error } = await sb.from("app_settings").select("*").order("key");
  if (error) throw error;
  return (data as AppSetting[]) ?? [];
}

/** All settings as a plain object, defaults filled in for anything missing.
 *  One query, so a caller that needs several doesn't make several. */
export async function loadSettings(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  try {
    for (const row of await listSettings()) {
      if (row.key in SETTING_DEFAULTS) out[row.key] = row.value;
    }
  } catch {
    // Deliberately swallowed. These are presentation tunables; a reporting
    // page should render with the compiled model rather than 500 because a
    // settings read failed.
  }
  return out;
}

export async function setSetting(
  key: string,
  value: unknown,
  updatedBy: string
): Promise<AppSetting> {
  if (!(key in SETTING_DEFAULTS)) {
    throw new InvalidSettingError(
      `Unknown setting "${key}". One of: ${Object.keys(SETTING_DEFAULTS).join(", ")}.`
    );
  }
  if (value == null || value === "") {
    throw new InvalidSettingError("A setting needs a value. There is no way to unset one.");
  }

  // Shape-checked against the default, so a number can't be replaced by a
  // string that every reader then does arithmetic on.
  const expected = SETTING_DEFAULTS[key as SettingKey];
  if (typeof expected === "number" && typeof value !== "number") {
    throw new InvalidSettingError(`"${key}" must be a number.`);
  }
  if (typeof expected === "string" && typeof value !== "string") {
    throw new InvalidSettingError(`"${key}" must be text.`);
  }
  if (typeof expected === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new InvalidSettingError(`"${key}" must be an object of named numbers.`);
    }
    for (const k of Object.keys(expected)) {
      const v = (value as Record<string, unknown>)[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        throw new InvalidSettingError(`"${key}.${k}" must be a number of zero or more.`);
      }
    }
  }

  const sb = requireAdmin();
  const { data, error } = await sb
    .from("app_settings")
    .update({ value, updated_by: updatedBy })
    .eq("key", key)
    .select("*")
    .single();
  if (error) throw error;
  return data as AppSetting;
}

// ─── Typed readers ─────────────────────────────────────────────────────────
// Each takes the loaded settings object rather than fetching, so the pure
// analytics functions stay pure and testable — the same pattern the ARR
// override map uses after it caused an outage by doing otherwise.

export function valueModelTierHours(settings: Record<string, unknown>): Record<string, number> {
  const v = settings["value_model.tier_hours"];
  return isNumberMap(v) ? v : { ...SETTING_DEFAULTS["value_model.tier_hours"] };
}

export function valueModelRates(settings: Record<string, unknown>): Record<string, number> {
  const v = settings["value_model.rates"];
  return isNumberMap(v) ? v : { ...SETTING_DEFAULTS["value_model.rates"] };
}

export function valueModelHoursPerFte(settings: Record<string, unknown>): number {
  const v = settings["value_model.hours_per_fte"];
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? v
    : SETTING_DEFAULTS["value_model.hours_per_fte"];
}

function isNumberMap(v: unknown): v is Record<string, number> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x))
  );
}
