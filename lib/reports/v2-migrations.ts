// V2 migrations — which customer processes are actively being migrated
// from Kognitos v1 to v2, who's running the migration on the delivery
// side, and who's running it on the engineering side.
//
// CURRENT STATE (2026-05-25): the data lives in this file as a hand-
// curated constant.  Rishabh is adding a "v2 Migration Status" column
// to the Monday Customers board (and likely a related text column for
// the freeform update).  Once that column is live:
//
//   1. Capture the column ID at lib/import/monday-customers.ts (next
//      to MONDAY_PROJECT_COLS / MONDAY_NPS_COLS).
//   2. Replace MIGRATIONS below with a Monday GraphQL read in
//      `loadV2Migrations()`.
//   3. Keep the V2Migration interface — the report renderer is
//      decoupled from the source.
//
// Storing these here intentionally for now because (a) the data is
// very small and changes weekly, not daily, and (b) hardcoding lets
// the report ship today without waiting on the Monday column.

import { listCustomers } from "@/lib/customers";

export interface V2Migration {
  /** Customer's deliveryops key — used for /customers/[key] deep links. */
  customer_key: string;
  /** Display name (filled in at load time from the customers table). */
  customer_display_name?: string;

  /** Optional name of the specific process being migrated.
   *  When unset, the migration covers all of the customer's processes. */
  process?: string;

  /** People from the Kognitos delivery (TAM / FDE / SE) team running
   *  the migration with the customer. */
  delivery_team: string[];

  /** People from Kognitos engineering supporting the migration. */
  engineering_team: string[];

  /** Freeform status update — what's happening this week. */
  status: string;

  /** Optional explicit blocker so the renderer can highlight it. */
  blocker?: string;
}

const MIGRATIONS: V2Migration[] = [
  {
    customer_key: "plunkett",
    delivery_team: ["Arushi"],
    engineering_team: ["Sasha"],
    status:
      "Migrating every Plunkett process to v2 — Arushi and Sasha are paired up. Significant heavy lifting on the NetSuite Book side; that's the rate-limiter for the migration.",
  },
  {
    customer_key: "ttx",
    process: "Lease Invoicing",
    delivery_team: ["Ayush"],
    engineering_team: [],
    status:
      "Ayush is working with the customer to migrate the Lease Invoicing process to v2 first. Once business sees the side-by-side comparison and is happy with the result, the rest of TTX's processes will follow.",
  },
  {
    customer_key: "kort-payments",
    delivery_team: ["Karthik"],
    engineering_team: ["Sasha"],
    status:
      "All Kort processes are being migrated to v2. Current focus: testing browser automation in v2 against the existing v1 Playwright scripts to confirm parity before cutover.",
  },
  {
    customer_key: "conectiv",
    delivery_team: ["Ayush"],
    engineering_team: ["Sasha"],
    status:
      "Migrating the Conectiv process to v2; gated on UAT sign-off of the v1 process before we cut over. The v2 side may require some engineering work — Sasha is engaged.",
    blocker: "Waiting on UAT sign-off on v1 process",
  },
  {
    customer_key: "scan-health",
    delivery_team: ["Ayush"],
    engineering_team: ["Sasha", "Vihang"],
    status:
      "Migrating the current Scan Health process to v2 — Ayush, Sasha, and Vihang are running it. The partner team is implementing Phase 3 on v1 in parallel.",
  },
];

/**
 * Resolve the V2Migration entries against the live customers table so the
 * renderer can show the correct display_name + skip entries whose customer
 * has been deleted.
 *
 * When the Monday column is wired up, swap the body of this function for
 * a Monday read; the public shape stays the same.
 */
export async function loadV2Migrations(): Promise<V2Migration[]> {
  const customers = await listCustomers();
  const byKey = new Map(customers.map((c) => [c.key, c]));
  const out: V2Migration[] = [];
  for (const m of MIGRATIONS) {
    const c = byKey.get(m.customer_key);
    if (!c) continue; // customer was deleted/renamed — skip rather than 404 the report
    out.push({ ...m, customer_display_name: c.display_name });
  }
  return out;
}
