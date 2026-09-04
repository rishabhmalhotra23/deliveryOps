// The 8-hue chip colour system backing Migration stage / Health / Lifecycle
// chips across the table, board and Configure dialog. Colours are per VALUE,
// not per row or per surface — Configure's Colours tab writes into the same
// `colorMap` this module resolves through, so a recolor there instantly
// follows the value everywhere (table chip, board chip, lane dot).
//
// Rendered via inline `style`, not Tailwind utility classes: the hue is only
// known at runtime (user-assigned in Configure), and a template-literal class
// name like `text-[color:var(--st-${hue}-fg)]` would never be seen by
// Tailwind's static source scanner and so would never get generated.

import type React from "react";
import type { MigrationStage, ProcessHealth, ProcessLifecycle } from "@/lib/supabase/types";

export const HUES = ["neutral", "indigo", "blue", "emerald", "amber", "orange", "red", "fuchsia"] as const;
export type Hue = (typeof HUES)[number];

export function hueStyle(hue: Hue): React.CSSProperties {
  return {
    color: `var(--st-${hue}-fg)`,
    background: `var(--st-${hue}-bg)`,
    borderColor: `var(--st-${hue}-bd)`,
  };
}

/** Chip colours for a native control (`<select>`), fed in as custom
 *  properties so `.dops-chip`'s !important declarations can consume them —
 *  see the comment on `.dops-chip` in app/globals.css for why a plain inline
 *  colour loses in dark mode. */
export function chipVars(hue: Hue): React.CSSProperties {
  return {
    ["--chip-fg" as string]: `var(--st-${hue}-fg)`,
    ["--chip-bg" as string]: `var(--st-${hue}-bg)`,
    ["--chip-bd" as string]: `var(--st-${hue}-bd)`,
  } as React.CSSProperties;
}

export function hueDotStyle(hue: Hue): React.CSSProperties {
  return { background: `var(--st-${hue}-fg)` };
}

export type ColorField = "stage" | "health" | "lifecycle";
/** Keyed `${field}:${value}` -> hue. Persisted in ViewPrefs (localStorage). */
export type ColorMap = Record<string, Hue>;

const DEFAULT_STAGE_HUE: Record<MigrationStage, Hue> = {
  not_required: "neutral",
  in_development: "indigo",
  engg_pending: "orange",
  parity_testing: "blue",
  customer_validation: "amber",
  live_on_v2: "emerald",
  v2_native: "emerald",
  migrated_pending_commercial: "fuchsia",
};

const DEFAULT_HEALTH_HUE: Record<ProcessHealth, Hue> = {
  on_track: "emerald",
  at_risk: "amber",
  off_track: "red",
};

// Lifecycle used to ship entirely uncoloured (every value mapped to
// "neutral"), which made the column read as dead text: Discovery, In
// development and UAT were visually identical, so the one field that says
// where a process actually is carried no signal at all. Reviewed 2026-09-04
// and given real hues.
//
// Cool -> warm -> green along the happy path (upcoming, discovery, in
// development, UAT, live) and warm/red for the off-ramps, so a lane of chips
// reads as progress at a glance. Where a value shares a name with a migration
// stage the hue is deliberately NOT forced to match — `in_development` is
// indigo as a stage and fuchsia as a lifecycle, because the two columns sit
// side by side in the table and identical chips there would imply the two
// fields are the same field.
//
// Backlog, Cancelled and Retired share neutral on purpose: all three mean
// "no signal", and Churned carries the red instead. Any of these is
// overridable per value in Configure -> Colours, which writes into colorMap
// and wins over every default here.
const DEFAULT_LIFECYCLE_HUE: Record<ProcessLifecycle, Hue> = {
  backlog: "neutral",
  upcoming: "blue",
  discovery: "indigo",
  in_development: "fuchsia",
  uat: "amber",
  live: "emerald",
  on_hold: "orange",
  needs_triage: "red",
  cancelled: "neutral",
  churned: "red",
  retired: "neutral",
};

const DEFAULTS_BY_FIELD: Record<ColorField, Record<string, Hue>> = {
  stage: DEFAULT_STAGE_HUE,
  health: DEFAULT_HEALTH_HUE,
  lifecycle: DEFAULT_LIFECYCLE_HUE,
};

export function resolveHue(field: ColorField, value: string, colorMap: ColorMap): Hue {
  const override = colorMap[`${field}:${value}`];
  if (override) return override;
  return DEFAULTS_BY_FIELD[field][value] ?? "neutral";
}
