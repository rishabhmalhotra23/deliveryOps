"use client";

// Per-user view preferences for the merged Delivery workspace — which
// columns/card-fields show, drag-resized widths (kept separate per wide/
// narrow table variant so a wide-table drag can never leak into the narrow
// split-panel set), custom chip colours, which filter chips are pinned, and
// the split-panel vs. centre-overlay detail pattern. Client-only for this
// pass (no per-user Supabase row yet) — same tradeoff the mockup itself made.

import { useEffect, useState } from "react";
import { DEFAULT_CARD_FIELDS, DEFAULT_COLS, type ColKey } from "./columns";
import type { ColorMap } from "./hues";

export type FilterField = "stage" | "owner" | "customer" | "health" | "partner" | "platform" | "lifecycle" | "phase" | "tam";

export type DetailPattern = "split" | "overlay";

export interface ViewPrefs {
  cols: ColKey[];
  colW: Record<string, number>;
  cardFields: ColKey[];
  colorMap: ColorMap;
  filterKeys: FilterField[];
  pattern: DetailPattern;
}

const STORAGE_KEY = "dops.viewPrefs";

const DEFAULTS: ViewPrefs = {
  cols: DEFAULT_COLS,
  colW: {},
  cardFields: DEFAULT_CARD_FIELDS,
  colorMap: {},
  filterKeys: ["stage", "owner", "customer", "health"],
  pattern: "split",
};

export function useViewPrefs(): [ViewPrefs, (next: ViewPrefs | ((prev: ViewPrefs) => ViewPrefs)) => void] {
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<ViewPrefs>) });
    } catch {
      /* corrupt or unavailable storage — fall back to defaults */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage full/disabled — prefs just won't persist this session */
    }
  }, [prefs, loaded]);

  return [prefs, setPrefs];
}

/** Column width cap: never let the table grow columns wider than the
 *  scrollport minus room for the sticky checkbox/name/actions cells. */
export function widthCap(tableClientWidth: number): number {
  return Math.max(200, tableClientWidth - 140);
}
