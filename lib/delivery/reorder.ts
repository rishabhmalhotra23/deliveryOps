// The fractional-position math behind every manual drag order in Delivery.
//
// Extracted from process-board.tsx when the table learned to drag rows too
// (2026-09-04). Board lanes order on `board_position` and the table orders on
// `table_position` — two different columns, because board positions are
// numbered per lane (every lane starts at STEP and steps by STEP, so the same
// value repeats across lanes) and ordering a flat list by them interleaves
// lanes meaninglessly. The arithmetic is identical though, and the two
// off-by-one/null-lane bugs pinned in tests/delivery/board-reorder.test.ts
// were expensive enough to find once that they should not be re-derived in a
// second copy. So the column is a parameter and the math lives here.

export const STEP = 1024;

/** Anything with an id and a stable tiebreak timestamp. Generic rather than
 *  typed to DetailProcess so this module stays free of component imports. */
export interface Orderable {
  id: string;
  updated_at: string;
}

export interface PlannedPosition {
  id: string;
  position: number;
}

/** Comparator for a manual order: placed rows first in position order,
 *  everything never dragged keeps the previous stalest-first ordering
 *  underneath them. */
export function byPosition<T extends Orderable>(
  read: (row: T) => number | null
): (a: T, b: T) => number {
  return (a, b) => {
    const ap = read(a);
    const bp = read(b);
    if (ap != null && bp != null) return ap - bp;
    if (ap != null) return -1;
    if (bp != null) return 1;
    return a.updated_at.localeCompare(b.updated_at);
  };
}

/** Works out which rows need a new position for a drop.
 *
 *  `rawSlot` is the gap index as the UI computed it — against the list
 *  *including* the dragged row, which is what the drop markers are indexed
 *  by. Dropping row A of [A,B,C,D] below C gives rawSlot 3; once A is removed
 *  the list is [B,C,D] and the correct insert index is 2, so any slot below
 *  the row's own position shifts down by one. Getting this wrong put every
 *  downward drag one place too low.
 *
 *  Returns one write in the steady state (the midpoint of the new
 *  neighbours), or a full renumber when a midpoint can't be expressed: the
 *  neighbours aren't positioned yet (both columns ship un-backfilled, so
 *  every list starts all-null), or the gap has been halved until no float
 *  sits strictly between. Empty array = no-op. */
export function planPositions<T extends Orderable>(
  rows: T[],
  dragged: T,
  rawSlot: number | undefined,
  read: (row: T) => number | null
): PlannedPosition[] {
  // `rows` may or may not already contain the dragged row: it does for a
  // reorder inside one list, and doesn't when a card is arriving from another
  // board lane. Taking the row itself rather than an id keeps both cases on
  // the same path — and means the caller never has to pre-splice it in, which
  // used to make the no-op check below misfire on every cross-lane drop.
  const draggedId = dragged.id;
  const from = rows.findIndex((r) => r.id === draggedId);
  const without = rows.filter((r) => r.id !== draggedId);

  let index = rawSlot ?? without.length;
  if (from >= 0 && from < index) index -= 1;
  index = Math.max(0, Math.min(index, without.length));

  // Dropped exactly where it already was.
  if (from >= 0 && index === from) return [];

  const prevRow = index > 0 ? without[index - 1] : undefined;
  const nextRow = index < without.length ? without[index] : undefined;
  const prev = prevRow ? read(prevRow) : null;
  const next = nextRow ? read(nextRow) : null;
  const prevKnown = index === 0 || prev != null;
  const nextKnown = index === without.length || next != null;

  if (prevKnown && nextKnown) {
    let value: number | null = null;
    if (prev == null && next == null) value = STEP; // list is empty
    else if (prev == null) value = (next as number) - STEP;
    else if (next == null) value = prev + STEP;
    else {
      const mid = (prev + next) / 2;
      // Strictly between, or the gap is exhausted and we must renumber.
      if (mid > prev && mid < next) value = mid;
    }
    if (value != null) return [{ id: draggedId, position: value }];
  }

  // Fall back: give the whole list explicit, evenly spaced positions in its
  // new order. Only the rows whose value actually changes are returned.
  const finalOrder = [...without];
  finalOrder.splice(index, 0, dragged);
  return finalOrder
    .map((row, i) => ({ id: row.id, position: (i + 1) * STEP, previous: read(row) }))
    .filter((w) => w.previous !== w.position)
    .map(({ id, position }) => ({ id, position }));
}
