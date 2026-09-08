// Runtime labels for the delivery vocabularies.
//
// The TypeScript maps in labels.ts remain the compile-time source of truth —
// they are what force a new enum value to be given a label, and what keeps
// `Record<MigrationStage, string>` exhaustive. But since 0042 a label is also
// EDITABLE in Configure -> Vocabularies, and a value added in the product
// exists in the database without existing in any union.
//
// So this resolves in one direction only: the database wins where it has an
// entry, the compiled map is the fallback, and `sentenceCase()` catches a
// value neither knows about. That ordering means an edited label takes effect
// everywhere without the compiled maps becoming dead weight, and a
// product-added value still renders as something a human can read.
//
// Threaded as a prop alongside `colorMap` rather than read from a module
// global: the app is server-rendered per request, so mutating module state
// with per-request data would leak one request's labels into another's.

import type { ColorField } from "@/lib/delivery/hues";
import { lifecycleLabel, healthLabel, stageLabel } from "@/lib/delivery/labels";
import type { MigrationStage, ProcessHealth, ProcessLifecycle } from "@/lib/supabase/types";

export interface VocabEntry {
  label: string;
  shortLabel: string | null;
  active: boolean;
  /** Configure's drag order. Object key order is insertion order, not this,
   *  so a picker built without sorting would ignore the order somebody set. */
  sortOrder: number;
}

/** `{ [ColorField]: { [value]: entry } }`. Only the three chip-rendered
 *  vocabularies; phase, blocked-on, work mode and platform still render from
 *  the compiled maps because nothing colours or reorders them. */
export type VocabMap = Partial<Record<ColorField, Record<string, VocabEntry>>>;

/** The compiled fallback for each field, so a database miss still reads
 *  correctly rather than showing a raw enum label. */
const COMPILED: Record<ColorField, (v: string) => string> = {
  stage: (v) => stageLabel(v as MigrationStage),
  health: (v) => healthLabel(v as ProcessHealth),
  lifecycle: (v) => lifecycleLabel(v as ProcessLifecycle),
};

export function vocabLabel(field: ColorField, value: string | null, vocab: VocabMap = {}): string {
  if (!value) return "—";
  const entry = vocab[field]?.[value];
  if (entry?.label) return entry.label;
  return COMPILED[field](value);
}

/** Board cards are 268px wide, where "Migrated, pending commercial" wraps to
 *  three lines. Falls back through the short compiled label, then the long
 *  one. */
export function vocabShortLabel(
  field: ColorField,
  value: string | null,
  vocab: VocabMap = {}
): string {
  if (!value) return "—";
  const entry = vocab[field]?.[value];
  if (entry?.shortLabel) return entry.shortLabel;
  if (entry?.label) return entry.label;
  if (field === "stage") return stageLabel(value as MigrationStage, { short: true });
  return COMPILED[field](value);
}

/** Values to offer in a picker: everything the database knows, minus the
 *  retired ones, in the order Configure set. Falls back to the compiled list
 *  when the database has nothing for this field — which is what keeps the app
 *  working if `vocabulary_values` is empty or unreachable.
 *
 *  `current` is always included even when retired: a row already carrying a
 *  retired value must not have it silently dropped from its own select, which
 *  would make the next save blank the field. */
export function vocabOptions(
  field: ColorField,
  compiledValues: readonly string[],
  vocab: VocabMap = {},
  current?: string | null
): string[] {
  const entries = vocab[field];
  if (!entries || Object.keys(entries).length === 0) return [...compiledValues];
  return Object.entries(entries)
    .filter(([value, e]) => e.active || value === current)
    .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
    .map(([value]) => value);
}
