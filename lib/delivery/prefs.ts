"use client";

// Per-user view preferences for the merged Delivery workspace — which
// columns/card-fields show, drag-resized widths (kept separate per wide/
// narrow table variant so a wide-table drag can never leak into the narrow
// split-panel set), custom chip colours, which filter chips are pinned, and
// the split-panel vs. centre-overlay detail pattern. Client-only for this
// pass (no per-user Supabase row yet) — same tradeoff the mockup itself made.

import { useEffect, useState } from "react";
import { CARD_FIELDS, COLDEFS, DEFAULT_CARD_FIELDS, DEFAULT_COLS, type ColKey } from "./columns";
import type { ColorMap } from "./hues";

// `person` matches ANY owner role (FDE, TAM or engineering) rather than one
// column. It backs Configure -> Roster's "still assigned to N processes"
// link: that count spans all four owner FKs, so filtering by FDE alone
// showed nothing for the 9 of 21 roster people who hold no FDE assignments
// but 34 TAM/engineering ones between them.
export type FilterField = "stage" | "owner" | "customer" | "health" | "partner" | "platform" | "lifecycle" | "phase" | "tam" | "person";

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

const KNOWN_COLS = new Set<string>(COLDEFS.map((c) => c.key));
const KNOWN_CARD_FIELDS = new Set<string>(CARD_FIELDS);
const KNOWN_FILTERS = new Set<string>(["stage", "owner", "customer", "health", "partner", "platform", "lifecycle", "phase", "tam", "person"]);

/** Anything persisted is untrusted input: a renamed column key or a
 *  half-written value used to throw on render (`COLDEF_BY_KEY[key].narrowW`
 *  on undefined) on every single load, with no way out but clearing storage
 *  by hand. Unknown keys and wrong types are dropped instead. */
function sanitize(raw: unknown): ViewPrefs {
  const saved = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ViewPrefs>;

  const cols = Array.isArray(saved.cols) ? saved.cols.filter((c): c is ColKey => KNOWN_COLS.has(c as string)) : [];
  const cardFields = Array.isArray(saved.cardFields)
    ? saved.cardFields.filter((c): c is ColKey => KNOWN_CARD_FIELDS.has(c as string))
    : [];
  const filterKeys = Array.isArray(saved.filterKeys)
    ? saved.filterKeys.filter((f): f is FilterField => KNOWN_FILTERS.has(f as string))
    : [];

  const colW: Record<string, number> = {};
  if (typeof saved.colW === "object" && saved.colW !== null) {
    for (const [k, v] of Object.entries(saved.colW)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) colW[k] = v;
    }
  }

  const colorMap: ColorMap = {};
  if (typeof saved.colorMap === "object" && saved.colorMap !== null) {
    for (const [k, v] of Object.entries(saved.colorMap)) {
      if (typeof v === "string") colorMap[k] = v as ColorMap[string];
    }
  }

  return {
    cols: cols.length > 0 ? cols : DEFAULTS.cols,
    colW,
    cardFields: cardFields.length > 0 ? cardFields : DEFAULTS.cardFields,
    colorMap,
    filterKeys: filterKeys.length > 0 ? filterKeys : DEFAULTS.filterKeys,
    pattern: saved.pattern === "overlay" ? "overlay" : "split",
  };
}

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
      if (raw) setPrefs(sanitize(JSON.parse(raw)));
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
