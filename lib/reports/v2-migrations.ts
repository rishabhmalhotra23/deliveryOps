// V2 migrations — which customer processes are actively being migrated
// from Kognitos v1 to v2.
//
// CURRENT STATE (2026-05-25): the data lives in this file as a hand-
// curated constant. Rishabh is adding a "v2 Migration Status" column
// to the Monday Customers board (and a related text column for the
// process names being migrated). Once that column is live:
//
//   1. Capture the column IDs at lib/import/monday-customers.ts.
//   2. Replace MIGRATIONS below with a Monday GraphQL read in
//      `loadV2Migrations()`.
//   3. Keep the V2Migration interface — the report renderer is
//      decoupled from the source.
//
// Design choice: we deliberately do NOT carry a freeform status
// sentence per migration. The report just lists customers + processes
// in flight; weekly status updates live elsewhere (Slack threads,
// Monday item updates) so this section doesn't decay between syncs.

import { listCustomers } from "@/lib/customers";

export interface V2Migration {
  /** Customer's deliveryops key — used for /customers/[key] deep links. */
  customer_key: string;
  /** Display name (filled in at load time from the customers table). */
  customer_display_name?: string;

  /** Process names being migrated. Empty array means "all processes for
   *  this customer". Multiple entries render as separate pills. */
  processes: string[];

  /** Owner chips — kept lightweight so they don't drift weekly.
   *  Both arrays are optional; renderer hides the row when empty. */
  delivery_team?: string[];
  engineering_team?: string[];
}

const MIGRATIONS: V2Migration[] = [
  {
    customer_key: "plunkett",
    processes: [],
    delivery_team: ["Arushi"],
    engineering_team: ["Sasha"],
  },
  {
    customer_key: "ttx",
    processes: ["Lease Invoicing"],
    delivery_team: ["Ayush", "Paige"],
  },
  {
    customer_key: "kort-payments",
    processes: [],
    delivery_team: ["Karthik", "Paige"],
    engineering_team: ["Sasha"],
  },
  {
    customer_key: "conectiv",
    processes: [],
    delivery_team: ["Ayush"],
    engineering_team: ["Sasha"],
  },
  {
    customer_key: "scan-health",
    processes: [],
    delivery_team: ["Ayush"],
    engineering_team: ["Sasha", "Vihang"],
  },
  {
    customer_key: "wipro-fss",
    processes: [],
    delivery_team: ["Sid"],
    engineering_team: ["Karthik"],
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
