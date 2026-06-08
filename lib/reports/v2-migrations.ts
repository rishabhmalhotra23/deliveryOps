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

  /** Migration stage pill shown in the weekly report. */
  stage: "Discovery" | "Development" | "Testing";

  /** Owner chips — kept lightweight so they don't drift weekly.
   *  Both arrays are optional; renderer hides the row when empty. */
  delivery_team?: string[];
  engineering_team?: string[];
}

const MIGRATIONS: V2Migration[] = [
  {
    customer_key: "plunkett",
    processes: [],
    stage: "Development",
    delivery_team: ["Arushi"],
    engineering_team: ["Sasha"],
  },
  {
    customer_key: "ttx",
    processes: ["Lease Invoicing"],
    stage: "Development",
    delivery_team: ["Ayush", "Paige"],
  },
  {
    customer_key: "kort-payments",
    processes: [],
    stage: "Development",
    delivery_team: ["Karthik", "Paige"],
    engineering_team: ["Sasha"],
  },
  {
    customer_key: "conectiv",
    processes: [],
    stage: "Development",
    delivery_team: ["Ayush"],
    engineering_team: ["Sasha"],
  },
  {
    customer_key: "scan-health",
    processes: [],
    stage: "Development",
    delivery_team: ["Ayush"],
    engineering_team: ["Sasha", "Vihang"],
  },
  {
    customer_key: "wipro-fss",
    processes: [],
    stage: "Development",
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

// ─── Manual migration rows ──────────────────────────────────────────────────
// Extra curated rows for the weekly report's "Migrating to V2 — in progress"
// tile, for customers that don't have a customer_key entry in MIGRATIONS above
// (e.g. JBI, Ciena). The weekly loader appends these to the curated
// v2_migration_list. The tile is a fixed curated list, not a live Monday pull.
export interface ManualV2Migration {
  /** Display name shown in the tile. */
  customer: string;
  /** Process label; "All processes" means the whole customer. */
  process: string;
  /** Migration stage pill — must match migrationStage() output. */
  stage: "Discovery" | "Development" | "Testing";
  /** Owner chips (FDE roster). */
  fde: string[];
}

export const MANUAL_V2_MIGRATIONS: ManualV2Migration[] = [
  { customer: "JBI", process: "All processes", stage: "Development", fde: ["Rishabh"] },
  { customer: "Ciena", process: "All processes", stage: "Development", fde: ["Rishabh"] },
];

// ─── V2 Migration Program ───────────────────────────────────────────────────
// The bulk-migration build-out running alongside the per-customer migrations:
// a system to migrate all processes to v2. Free-form workstream updates, edited
// by hand. Rendered as its own tile below the customer migration list.
export interface V2ProgramWorkstream {
  title: string;
  owners: string[];
  body: string;
}

export const V2_PROGRAM_WORKSTREAMS: V2ProgramWorkstream[] = [
  {
    title: "Data pipeline → Quill 2 build",
    owners: ["Sid", "Sasha", "Rishabh"],
    body:
      "Pipeline for data collection and migration to v2 Quill 2 via the Kognitos Plugin is finalized. " +
      "Full data dump for every v1 production process is captured (live and test runs, learnings, Klang, " +
      "SOPs) and converted into a phased process-flow doc that drives the Quill2 v2 build. Building first " +
      "with mock data for all third-party integrations, then moving to actual integrations and testing to " +
      "cut UAT time later for each process.",
  },
  {
    title: "Linear ticket consolidation & prioritization",
    owners: ["Shyam"],
    body:
      "Consolidating all v2 Linear tickets, tagging them for Quill 1 vs Quill 2, and flagging high priority " +
      "to identify which features are key blockers for v2 migration and prioritize accordingly.",
  },
];
