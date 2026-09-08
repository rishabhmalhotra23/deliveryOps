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

/** The six enums add_vocabulary_value() will extend. Mirrors its allow-list;
 *  the function is the enforcement, this is for the UI. `process_phase` was
 *  the seventh until 2026-09-08, when the column and the enum were dropped —
 *  see migration 0044. */
export const EXTENDABLE_VOCABULARIES = [
  "migration_stage",
  "process_lifecycle",
  "process_health",
  "process_blocked_on",
  "process_work_mode",
  "process_platform",
] as const;
export type VocabularyName = (typeof EXTENDABLE_VOCABULARIES)[number];

export const VOCABULARY_LABELS: Record<VocabularyName, string> = {
  migration_stage: "Migration stage",
  process_lifecycle: "Lifecycle",
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
  /** customer_category only: the customer_zone.value it groups under. */
  rollup: string | null;
  /** customer_zone only: the sub-label beside a group header. */
  description: string | null;
}

/** The three vocabularies whose values render as coloured chips, mapped to
 *  the `ColorField` key `resolveHue()` uses. Only these three are coloured —
 *  blocked_on, work_mode and platform render as plain text. */
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

/** Vocabularies backed by plain `text`, not a Postgres enum (0045).
 *
 *  `customers.custom_category` has been free text since 0005, and zones are
 *  derived rather than stored at all — so these need no `ALTER TYPE`, which
 *  means adding one is an ordinary INSERT and a value can genuinely be
 *  DELETED rather than only retired. They deliberately do not go through
 *  add_vocabulary_value(), whose entire purpose is the enum path. */
export const FREE_TEXT_VOCABULARIES = ["customer_category", "customer_zone"] as const;
export type FreeTextVocabularyName = (typeof FREE_TEXT_VOCABULARIES)[number];

export const FREE_TEXT_VOCABULARY_LABELS: Record<FreeTextVocabularyName, string> = {
  customer_category: "Customer category",
  customer_zone: "Customer zone",
};

function isFreeText(v: string): v is FreeTextVocabularyName {
  return (FREE_TEXT_VOCABULARIES as readonly string[]).includes(v);
}

/** Accepts an enum vocabulary or a free-text one. Used by the update and
 *  retire paths, which are identical for both — only add and delete differ. */
function assertAnyVocabulary(v: string): string {
  if (isFreeText(v)) return v;
  return assertVocabulary(v);
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
  /** customer_category: which zone it files under. */
  rollup?: string | null;
  /** customer_zone: the sub-label beside its group header. */
  description?: string | null;
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
  assertAnyVocabulary(vocabulary);

  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new InvalidVocabularyInputError("A label can't be blank.");
    update.label = patch.label.trim();
  }
  if (patch.shortLabel !== undefined) update.short_label = patch.shortLabel?.trim() || null;
  if (patch.hue !== undefined) update.hue = assertHue(patch.hue);
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.rollup !== undefined) update.rollup = patch.rollup?.trim() || null;
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
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

// ─── Customer zones and categories (0045) ──────────────────────────────────
// Separate add/delete/rename from the enum paths above because the underlying
// storage is different in kind, not just in degree: `customers.custom_category`
// is plain text, so there is no DDL, no irreversibility, and no reason to
// force a lower_snake_case value on a column that already holds display text.

/** One zone — a group header on /customers, editable label and sub-label. */
export interface CustomerZone {
  value: string;
  label: string;
  description: string | null;
  hue: string | null;
  sortOrder: number;
  active: boolean;
}

/** One category, plus the zone it rolls up into. */
export interface CustomerCategoryDef {
  value: string;
  label: string;
  hue: string | null;
  /** The customer_zone.value this files under. */
  zone: string;
  sortOrder: number;
  active: boolean;
}

/** Everything /customers needs to render zones and category chips, loaded in
 *  one query and threaded as a prop.
 *
 *  Returned rather than fetched per-consumer on purpose — the same convention
 *  the override map and vocab map already follow (see CLAUDE.md: "loaders take
 *  their inputs, they don't fetch them"). Both of 2026-09-08's database bugs
 *  came from breaking that. */
export interface CustomerVocabulary {
  zones: CustomerZone[];
  categories: CustomerCategoryDef[];
}

export async function loadCustomerVocabulary(): Promise<CustomerVocabulary> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from("vocabulary_values")
    .select("*")
    .in("vocabulary", ["customer_zone", "customer_category"])
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const rows = (data as VocabularyValue[]) ?? [];

  return {
    zones: rows
      .filter((r) => r.vocabulary === "customer_zone")
      .map((r) => ({
        value: r.value,
        label: r.label,
        description: r.description,
        hue: r.hue,
        sortOrder: r.sort_order,
        active: r.active,
      })),
    categories: rows
      .filter((r) => r.vocabulary === "customer_category")
      .map((r) => ({
        value: r.value,
        label: r.label,
        hue: r.hue,
        // Falls back to the first zone rather than throwing: a category with a
        // null rollup is a seeding gap, and filing it somewhere visible beats
        // failing the page.
        zone: r.rollup ?? "focus",
        sortOrder: r.sort_order,
        active: r.active,
      })),
  };
}

export interface AddCustomerVocabularyInput {
  vocabulary: FreeTextVocabularyName;
  /** For a category this is the literal text stored on customers rows, so it
   *  is kept verbatim rather than slugified. For a zone it is slugified,
   *  because nothing stores a zone and a stable key is what `rollup` points
   *  at. */
  label: string;
  hue?: string | null;
  /** Category only. */
  rollup?: string | null;
  /** Zone only. */
  description?: string | null;
}

/** Adds a zone or a category. A plain INSERT — no DDL, so unlike
 *  addVocabularyValue() this is reversible. */
export async function addCustomerVocabularyValue(
  input: AddCustomerVocabularyInput
): Promise<VocabularyValue> {
  if (!isFreeText(input.vocabulary)) {
    throw new InvalidVocabularyInputError(`"${input.vocabulary}" is not a customer vocabulary.`);
  }
  const label = input.label.trim();
  if (!label) {
    throw new InvalidVocabularyInputError("A name is required — it's what people will read.");
  }
  if (label.length > 60) {
    throw new InvalidVocabularyInputError("A name must be 60 characters or fewer.");
  }
  const hue = assertHue(input.hue);

  const value =
    input.vocabulary === "customer_zone"
      ? label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
      : label;
  if (!value) {
    throw new InvalidVocabularyInputError("That name has no letters or digits in it.");
  }

  const sb = requireAdmin();
  const existing = await sb
    .from("vocabulary_values")
    .select("value")
    .eq("vocabulary", input.vocabulary)
    .eq("value", value)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    throw new InvalidVocabularyInputError(`"${label}" already exists.`);
  }

  // Appended, not inserted mid-list: order is hand-managed and a new value
  // shouldn't renumber the ones already there.
  const { data: last, error: lastError } = await sb
    .from("vocabulary_values")
    .select("sort_order")
    .eq("vocabulary", input.vocabulary)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { data, error } = await sb
    .from("vocabulary_values")
    .insert({
      vocabulary: input.vocabulary,
      value,
      label,
      hue,
      rollup: input.vocabulary === "customer_category" ? input.rollup?.trim() || "focus" : null,
      description: input.vocabulary === "customer_zone" ? input.description?.trim() || null : null,
      sort_order: ((last as { sort_order: number } | null)?.sort_order ?? 0) + 10,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as VocabularyValue;
}

/** How many rows still point at a value — what turns delete from a blind
 *  action into a decision. Categories are counted on `customers`; zones are
 *  counted on the categories rolling into them. */
export async function countCustomerVocabularyUsage(
  vocabulary: FreeTextVocabularyName,
  value: string
): Promise<number> {
  const sb = requireAdmin();
  if (vocabulary === "customer_category") {
    const { count, error } = await sb
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("custom_category", value);
    if (error) throw error;
    return count ?? 0;
  }
  const { count, error } = await sb
    .from("vocabulary_values")
    .select("id", { count: "exact", head: true })
    .eq("vocabulary", "customer_category")
    .eq("rollup", value);
  if (error) throw error;
  return count ?? 0;
}

/** Deletes a zone or category outright.
 *
 *  Possible here and not for the process vocabularies purely because no enum
 *  is involved. Refused while anything still points at the value: a customer
 *  left holding a deleted category would render an unlabelled chip in no zone,
 *  which is worse than the list being one item longer. Retire it
 *  (`active: false`) to take it out of circulation without touching the rows
 *  that carry it. */
export async function deleteCustomerVocabularyValue(
  vocabulary: FreeTextVocabularyName,
  value: string
): Promise<void> {
  if (!isFreeText(vocabulary)) {
    throw new InvalidVocabularyInputError(`"${vocabulary}" is not a customer vocabulary.`);
  }
  const inUse = await countCustomerVocabularyUsage(vocabulary, value);
  if (inUse > 0) {
    throw new InvalidVocabularyInputError(
      vocabulary === "customer_category"
        ? `${inUse} customer${inUse === 1 ? "" : "s"} still use this category. Retire it instead, or re-file them first.`
        : `${inUse} categor${inUse === 1 ? "y" : "ies"} still roll up into this zone. Move them first.`
    );
  }
  const sb = requireAdmin();
  const { error } = await sb
    .from("vocabulary_values")
    .delete()
    .eq("vocabulary", vocabulary)
    .eq("value", value);
  if (error) throw error;
}

/** Renames a category and repoints every customer carrying it, in one
 *  transaction via rename_customer_category() (0045).
 *
 *  Needed because `customers.custom_category` stores the label itself, not a
 *  slug — updating the vocabulary row alone would leave 15 customers pointing
 *  at a category that no longer exists. Zones need no equivalent: nothing
 *  stores a zone, so their label is edited through updateVocabularyValue().
 *  Returns how many customers moved. */
export async function renameCustomerCategory(from: string, to: string): Promise<number> {
  const label = to.trim();
  if (!label) throw new InvalidVocabularyInputError("A category name is required.");
  const sb = requireAdmin();
  const { data, error } = await sb.rpc("rename_customer_category", {
    p_from: from,
    p_to: label,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
