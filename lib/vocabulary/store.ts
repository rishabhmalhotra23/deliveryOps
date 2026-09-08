// Reads and writes the delivery vocabularies' presentation (label, short
// label, colour, order) and extends them.
//
// See migration 0042 for why the enum types stay and only the presentation
// moved into a table: the 17 exhaustive `Record<MigrationStage, ...>` maps in
// this codebase are what force a new value to be given a label and a colour,
// and TypeScript fails the build if one is missed. Dropping the enums would
// trade "extending needs a migration" for "extending silently renders a blank
// grey chip".
//
// So the TS unions remain the compile-time-known set, and everything here is
// the runtime set — which is a superset once somebody adds a value in the
// product. Every consumer already has a fallback for an unknown value
// (`sentenceCase()` in labels.ts, `?? "neutral"` in hues.ts), so an
// un-seeded value degrades rather than breaks.

import { requireAdmin } from "@/lib/supabase/server";
import { HUES, type ColorField, type ColorMap, type Hue } from "@/lib/delivery/hues";
import type { VocabMap } from "@/lib/delivery/vocab";

/** The seven enums add_vocabulary_value() will extend. Mirrors its
 *  allow-list; the function is the enforcement, this is for the UI. */
export const EXTENDABLE_VOCABULARIES = [
  "migration_stage",
  "process_lifecycle",
  "process_phase",
  "process_health",
  "process_blocked_on",
  "process_work_mode",
  "process_platform",
] as const;
export type VocabularyName = (typeof EXTENDABLE_VOCABULARIES)[number];

export const VOCABULARY_LABELS: Record<VocabularyName, string> = {
  migration_stage: "Migration stage",
  process_lifecycle: "Lifecycle",
  process_phase: "Phase",
  process_health: "Health",
  process_blocked_on: "Blocked on",
  process_work_mode: "Work mode",
  process_platform: "Platform",
};

export interface VocabularyValue {
  id: string;
  vocabulary: string;
  value: string;
  label: string;
  short_label: string | null;
  hue: string | null;
  sort_order: number;
  active: boolean;
}

/** The three vocabularies whose values render as coloured chips, mapped to
 *  the `ColorField` key `resolveHue()` uses. Only these three are coloured —
 *  phase, blocked_on, work_mode and platform render as plain text. */
export const COLOR_FIELD_VOCABULARY: Record<ColorField, VocabularyName> = {
  stage: "migration_stage",
  health: "process_health",
  lifecycle: "process_lifecycle",
};

export class InvalidVocabularyInputError extends Error {}

export async function listVocabularyValues(
  vocabulary?: VocabularyName
): Promise<VocabularyValue[]> {
  const sb = requireAdmin();
  let q = sb.from("vocabulary_values").select("*");
  if (vocabulary) q = q.eq("vocabulary", vocabulary);
  const { data, error } = await q
    .order("vocabulary", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data as VocabularyValue[]) ?? [];
}

/** `{ [vocabulary]: { [value]: row } }` — the shape the label and hue
 *  resolvers want, so a page loads it once and every chip on it resolves in
 *  memory. */
export async function loadVocabularyMap(): Promise<
  Record<string, Record<string, VocabularyValue>>
> {
  const rows = await listVocabularyValues();
  const out: Record<string, Record<string, VocabularyValue>> = {};
  for (const row of rows) {
    (out[row.vocabulary] ??= {})[row.value] = row;
  }
  return out;
}

/** The chip colours, in the `${field}:${value}` shape resolveHue() already
 *  takes — so moving colour out of localStorage needed no change to any
 *  consumer, just a different source for the same map.
 *
 *  Configure -> Colours used to write `dops.viewPrefs` in localStorage, which
 *  made the scheme per-browser: two people looking at the same board saw
 *  different colours and a new laptop started from defaults. Colour belongs to
 *  the value. */
export async function loadColorMap(): Promise<ColorMap> {
  const rows = await listVocabularyValues();
  const byVocabulary = new Map<string, ColorField>(
    Object.entries(COLOR_FIELD_VOCABULARY).map(([field, vocab]) => [vocab, field as ColorField])
  );
  const out: ColorMap = {};
  for (const row of rows) {
    const field = byVocabulary.get(row.vocabulary);
    if (!field || !row.hue) continue;
    if (!(HUES as readonly string[]).includes(row.hue)) continue;
    out[`${field}:${row.value}`] = row.hue as Hue;
  }
  return out;
}

/** The label/short-label/order/active map the delivery surfaces render from,
 *  in the `VocabMap` shape lib/delivery/vocab.ts resolves through. Loaded
 *  server-side and threaded as a prop next to the colour map. */
export async function loadVocabMap(): Promise<VocabMap> {
  const rows = await listVocabularyValues();
  const byVocabulary = new Map<string, ColorField>(
    Object.entries(COLOR_FIELD_VOCABULARY).map(([field, vocab]) => [vocab, field as ColorField])
  );
  const out: VocabMap = {};
  for (const row of rows) {
    const field = byVocabulary.get(row.vocabulary);
    if (!field) continue;
    (out[field] ??= {})[row.value] = {
      label: row.label,
      shortLabel: row.short_label,
      active: row.active,
      sortOrder: row.sort_order,
    };
  }
  return out;
}

function assertVocabulary(v: string): VocabularyName {
  if (!(EXTENDABLE_VOCABULARIES as readonly string[]).includes(v)) {
    throw new InvalidVocabularyInputError(
      `Unknown vocabulary "${v}". One of: ${EXTENDABLE_VOCABULARIES.join(", ")}.`
    );
  }
  return v as VocabularyName;
}

function assertHue(hue: string | null | undefined): Hue | null {
  if (hue == null || hue === "") return null;
  if (!(HUES as readonly string[]).includes(hue)) {
    throw new InvalidVocabularyInputError(`Unknown hue "${hue}". One of: ${HUES.join(", ")}.`);
  }
  return hue as Hue;
}

export interface AddVocabularyValueInput {
  vocabulary: string;
  value: string;
  label: string;
  shortLabel?: string | null;
  hue?: string | null;
}

/** Adds a value to the enum AND records its presentation, via the
 *  SECURITY DEFINER function — the app doesn't hold DDL rights itself.
 *
 *  Validated here as well as in the function so the UI gets a useful message
 *  instead of a Postgres exception string; the function's copy is the one
 *  that actually protects the database. */
export async function addVocabularyValue(input: AddVocabularyValueInput): Promise<void> {
  const vocabulary = assertVocabulary(input.vocabulary);
  const value = input.value.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(value)) {
    throw new InvalidVocabularyInputError(
      "A value must be lower_snake_case, start with a letter, and be at most 41 characters."
    );
  }
  if (!input.label.trim()) {
    throw new InvalidVocabularyInputError("A label is required — it's what people will read.");
  }
  const hue = assertHue(input.hue);

  const sb = requireAdmin();
  const { error } = await sb.rpc("add_vocabulary_value", {
    p_vocabulary: vocabulary,
    p_value: value,
    p_label: input.label.trim(),
    p_short_label: input.shortLabel?.trim() || null,
    p_hue: hue,
  });
  if (error) throw error;
}

export interface UpdateVocabularyValueInput {
  label?: string;
  shortLabel?: string | null;
  hue?: string | null;
  sortOrder?: number;
  active?: boolean;
}

/** Restyle or retire an existing value. Never touches the enum: the label
 *  itself is immutable once rows carry it, and Postgres has no DROP VALUE, so
 *  `active: false` is the only honest way to take one out of circulation —
 *  rows already using it keep rendering, pickers stop offering it. */
export async function updateVocabularyValue(
  vocabulary: string,
  value: string,
  patch: UpdateVocabularyValueInput
): Promise<VocabularyValue> {
  assertVocabulary(vocabulary);

  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new InvalidVocabularyInputError("A label can't be blank.");
    update.label = patch.label.trim();
  }
  if (patch.shortLabel !== undefined) update.short_label = patch.shortLabel?.trim() || null;
  if (patch.hue !== undefined) update.hue = assertHue(patch.hue);
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.active !== undefined) update.active = patch.active;
  if (Object.keys(update).length === 0) {
    throw new InvalidVocabularyInputError("Nothing to update.");
  }

  const sb = requireAdmin();
  const { data, error } = await sb
    .from("vocabulary_values")
    .update(update)
    .eq("vocabulary", vocabulary)
    .eq("value", value)
    .select("*")
    .single();
  if (error) throw error;
  return data as VocabularyValue;
}
