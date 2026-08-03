/**
 * import-monday-backup.ts — one-time (but idempotent) import of the verified
 * Monday archive into the native tables created by migration 0021.
 *
 * Step 1.3 of the Monday decommission. See docs/MONDAY-DECOMMISSION-LOG.md.
 *
 * Three phases, all reading monday-backup-2026-08-03/:
 *   processes  146 rows from the 6 report boards -> processes
 *   nps         87 rows from NPS Tracking        -> nps_responses
 *   customers   41 rows from the Customers board -> customers/profiles/internal_profiles
 *
 * Safety properties, in order of how much they matter:
 *   1. DRY RUN BY DEFAULT. Writes nothing unless you pass --apply.
 *   2. Idempotent. processes and nps_responses upsert on source_item_id, so
 *      re-running converges instead of duplicating.
 *   3. It flags rather than guesses. 15 process rows and every ambiguous customer
 *      field land with needs_attention set and a reason; nothing is silently
 *      reclassified. That is the "surface both values" rule applied to import.
 *   4. It never writes a field the app treats as human-owned if a human already
 *      set it — see PROTECTED_IF_SET.
 *
 * Run from the repo root:
 *   npx tsx scripts/import-monday-backup.ts --help
 *   npx tsx scripts/import-monday-backup.ts                    # dry run, all phases
 *   npx tsx scripts/import-monday-backup.ts --only processes
 *   npx tsx scripts/import-monday-backup.ts --apply
 *
 * Point it at local Supabase first (.env.local -> 127.0.0.1:54321), confirm the
 * summary matches the expected counts, then run against production.
 *
 * The backup folder is gitignored. This is real customer data.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// Required on Node 18/20: supabase-js >= 2.105 needs a global WebSocket and only
// Node 22+ has one natively. Side-effect import, no env read, so it is safe above
// the dotenv prologue. Omitting this fails at roster load with a message about
// RealtimeClient transport that looks nothing like the actual cause.
import "../lib/supabase/ws-polyfill";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// dotenv prologue matches scripts/monday-full-backup.ts: .env then .env.local.
//
// `--secrets-file <path>` is loaded LAST so it wins. It exists because these files use
// override: true, which means an inline `FOO=bar npx tsx ...` gets clobbered by
// .env.local — surprising, and the reason this flag is here rather than relying on
// inline env vars. It also keeps the service-role key out of shell history.
const require_ = createRequire(import.meta.url);
{
  const files = [".env", ".env.local"];
  const i = process.argv.indexOf("--secrets-file");
  if (i !== -1 && process.argv[i + 1]) files.push(process.argv[i + 1]);
  for (const file of files) {
    const p = path.resolve(process.cwd(), file);
    if (fs.existsSync(p)) require_("dotenv").config({ path: p, override: true });
    else if (files.indexOf(file) > 1) {
      throw new Error(`--secrets-file not found: ${p}`);
    }
  }
}

import {
  derivePlatform,
  migrationStageFromPlatform,
  deriveComplexity,
  deriveState,
  viewForLifecycle,
} from "../lib/import/monday-taxonomy";

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_BACKUP = "monday-backup-2026-08-03";

/** The 6 report boards, with the row count each should yield. */
const REPORT_BOARDS: { id: string; label: string; expect: number }[] = [
  { id: "18395281570", label: "Projects", expect: 30 },
  { id: "18398797224", label: "FY-2025 Deliverables", expect: 47 },
  { id: "18398797267", label: "FY-2026 Deliverables", expect: 19 },
  { id: "18398797301", label: "Inactive / Cancelled projects", expect: 25 },
  { id: "18398797248", label: "FY-2024 Deliverables", expect: 20 },
  { id: "18398797257", label: "FY-2023 Deliverables", expect: 5 },
];

const NPS_BOARD = "18398995134"; // 87 items
const CUSTOMERS_BOARD = "18395281568"; // 41 items

/**
 * The only customer-name disagreement in the whole 146-row set. Everything else
 * matches the roster exactly.
 */
const NAME_FIXUPS: Record<string, string> = {
  "iheart radio": "iHeartRadio",
};

/**
 * Not in the customers roster at all (3 process rows). Imported with a null
 * customer and flagged, rather than having a customer invented for them.
 */
const KNOWN_UNMATCHED = new Set(["srinar"]);

/**
 * Fields the app treats as human-owned once set. The import will not overwrite a
 * non-empty existing value in these, because `deliveryops_protected_fields`
 * already encodes the principle that a manual edit beats a sync.
 */
const PROTECTED_IF_SET = ["ae_owner", "partner", "custom_category", "account_type", "deal_type"] as const;

// ─── CLI ─────────────────────────────────────────────────────────────────────

type Phase = "processes" | "nps" | "customers";

interface Opts {
  apply: boolean;
  backup: string;
  only: Phase[];
  verbose: boolean;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    apply: argv.includes("--apply"),
    backup: DEFAULT_BACKUP,
    only: ["processes", "nps", "customers"],
    verbose: argv.includes("--verbose") || argv.includes("-v"),
  };
  const bi = argv.indexOf("--backup");
  if (bi !== -1 && argv[bi + 1]) opts.backup = argv[bi + 1];
  const oi = argv.indexOf("--only");
  if (oi !== -1 && argv[oi + 1]) {
    opts.only = argv[oi + 1].split(",").map((s) => s.trim()) as Phase[];
  }
  return opts;
}

function help(): void {
  console.log(`
import-monday-backup.ts — import the verified Monday archive into the 0021 tables.

  --apply             Actually write. WITHOUT THIS IT IS A DRY RUN.
  --backup <dir>      Backup folder (default ${DEFAULT_BACKUP})
  --only <phases>     Comma-separated: processes,nps,customers (default all)
  --secrets-file <path>   Extra env file, loaded last so it wins over .env.local
  --verbose, -v       Print every flagged row
  --help, -h          This

Expected on a clean run: 146 processes (active 30 / delivered 71 / archive 45),
15 flagged for review, 87 NPS responses, 41 customers touched.

Customer matching CANNOT be validated against local Supabase: supabase/seed.sql
creates 1 customer, so a freshly reset local DB has no roster and all 146 rows
read as unmatched. The dry run writes nothing, so point it at production to check
matching:

  npx vercel env pull .env.production.local --environment=production
  npx tsx scripts/import-monday-backup.ts --secrets-file .env.production.local
`);
}

// ─── Backup reading ──────────────────────────────────────────────────────────

interface MondayItem {
  id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
  group?: { title?: string | null } | null;
  column_values: {
    id: string;
    text: string | null;
    value?: string | null;
    linked_items?: { id: string; name: string }[] | null;
  }[];
}

interface Board {
  id: string;
  name: string;
  items: MondayItem[];
  /** column id -> title */
  titles: Map<string, string>;
}

function loadBoard(dir: string, id: string): Board {
  const file = path.join(dir, "boards", `board-${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`board file missing: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    id,
    name: raw.board?.name ?? id,
    items: (raw.items ?? []) as MondayItem[],
    titles: new Map(
      (raw.board?.columns ?? []).map((c: { id: string; title: string }) => [c.id, c.title])
    ),
  };
}

/** Column values of one item, keyed by human column title. */
type Cells = Record<
  string,
  { text: string | null; linked: { id: string; name: string }[] } | undefined
>;

function cells(board: Board, item: MondayItem): Cells {
  const out: Cells = {};
  for (const cv of item.column_values) {
    out[board.titles.get(cv.id) ?? cv.id] = {
      text: cv.text && cv.text.trim() ? cv.text.trim() : null,
      linked: cv.linked_items ?? [],
    };
  }
  return out;
}

const txt = (c: Cells, title: string): string | null => c[title]?.text ?? null;

/**
 * Linked customer name. Note that board_relation cells carry an EMPTY `text`
 * field and a populated `linked_items` array — reading `text` here is what made
 * an earlier pass conclude the relations were empty.
 */
const linkedName = (c: Cells, title: string): string | null =>
  c[title]?.linked?.[0]?.name?.trim() || null;

function toDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toNum(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ─── Supabase ────────────────────────────────────────────────────────────────

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local) before --apply."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

interface RosterEntry {
  id: string;
  key: string;
  display_name: string;
  protectedFields: string[];
  existing: Record<string, unknown>;
}

/**
 * display-name and key lookup, both normalised, for resolving Monday labels.
 *
 * One entry can produce one or two map keys depending on whether its key and
 * display_name normalise to the same string, so never infer the customer count
 * from `map.size` — `rosterCount` below counts distinct customers.
 */
async function loadRoster(sb: SupabaseClient): Promise<Map<string, RosterEntry>> {
  const { data, error } = await sb
    .from("customers")
    .select("id, key, display_name, deliveryops_protected_fields, ae_owner, partner, custom_category, account_type, deal_type")
    .is("deleted_at", null);
  if (error) throw new Error(`roster load failed: ${error.message}`);

  const map = new Map<string, RosterEntry>();
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const entry: RosterEntry = {
      id: String(r.id),
      key: String(r.key),
      display_name: String(r.display_name),
      protectedFields: (r.deliveryops_protected_fields as string[] | null) ?? [],
      existing: r,
    };
    map.set(norm(entry.display_name), entry);
    map.set(norm(entry.key), entry);
  }
  return map;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Distinct customers in the roster map (entries are indexed under 1-2 keys). */
const rosterCount = (roster: Map<string, RosterEntry>): number =>
  new Set([...roster.values()].map((e) => e.id)).size;

/**
 * The portfolio has ~40 customers. A roster far below that means the script is
 * pointed at a database that does not hold the real roster — most often a freshly
 * reset local Supabase, whose seed.sql has almost no customers. Every row then
 * reads as unmatched and the dry run looks alarming while telling you nothing.
 */
const MIN_PLAUSIBLE_ROSTER = 10;

function lookup(label: string | null, roster: Map<string, RosterEntry>): RosterEntry | null {
  if (!label) return null;
  const fixed = NAME_FIXUPS[norm(label)] ?? label;
  return roster.get(norm(fixed)) ?? null;
}

/**
 * Resolve a process row's customer, in strict order of trustworthiness.
 *
 * Coverage measured on the 146 report rows, which CORRECTS the figure in
 * PROCESSES-SCHEMA-PROPOSAL.md (it claimed 140 via relation):
 *   relation      94
 *   dropdown      45   (relation cell empty)
 *   neither        7
 *
 * The order matters and is not arbitrary. For the 7 "Wipro BPS - iHeartRadio - X"
 * rows the dropdown says iHeart Radio (correct — iHeartRadio is the customer,
 * Wipro BPS is the partner) while the item-name prefix says "Wipro BPS" (wrong).
 * So the name prefix is only ever a last resort, and it is reported when used.
 */
function resolveCustomer(
  opts: { relation: string | null; dropdown: string | null; itemName: string },
  roster: Map<string, RosterEntry>
): { entry: RosterEntry | null; reason: string | null } {
  for (const [label, via] of [
    [opts.relation, "relation"],
    [opts.dropdown, "dropdown"],
  ] as const) {
    const hit = lookup(label, roster);
    if (hit) return { entry: hit, reason: null };
    if (label && KNOWN_UNMATCHED.has(norm(label))) {
      return { entry: null, reason: `"${label}" is not in the customers roster (via ${via})` };
    }
  }

  // Last resort: the "<Customer> - <Process>" naming convention. Recovers 4 of
  // the 7 rows that have neither a relation nor a dropdown (Norco, Wipro FSS and
  // two Plunkett rows). The remaining 3 are Srinar, genuinely not a customer.
  const prefix = opts.itemName.split(" - ")[0]?.trim() || null;
  const byName = lookup(prefix, roster);
  if (byName) {
    return { entry: byName, reason: `customer inferred from the item name ("${prefix}") — verify` };
  }
  if (prefix && KNOWN_UNMATCHED.has(norm(prefix))) {
    return { entry: null, reason: `"${prefix}" is not in the customers roster` };
  }

  const tried = [opts.relation, opts.dropdown, prefix].filter(Boolean).join(" / ");
  return {
    entry: null,
    reason: tried ? `no roster match for ${tried}` : "no customer on the Monday row",
  };
}

/** NPS and the Customers board resolve by a single label. */
function resolveByLabel(
  label: string | null,
  roster: Map<string, RosterEntry>
): { entry: RosterEntry | null; reason: string | null } {
  const hit = lookup(label, roster);
  if (hit) return { entry: hit, reason: null };
  if (!label) return { entry: null, reason: "no customer on the Monday row" };
  return { entry: null, reason: `customer "${label}" did not match the roster` };
}

// ─── Phase: processes ────────────────────────────────────────────────────────

interface Flagged {
  name: string;
  reason: string;
}

async function importProcesses(
  sb: SupabaseClient | null,
  dir: string,
  roster: Map<string, RosterEntry>,
  opts: Opts
): Promise<void> {
  console.log("\n── processes ───────────────────────────────────────────────");

  const rows: Record<string, unknown>[] = [];
  const flagged: Flagged[] = [];
  const views = { active: 0, delivered: 0, archive: 0 };
  // Corrects PROCESSES-SCHEMA-PROPOSAL.md, which claimed 140 via relation.
  const resolvedVia: Record<string, number> = { relation: 0, dropdown: 0, "name or none": 0 };
  let boardTotal = 0;

  for (const b of REPORT_BOARDS) {
    const board = loadBoard(dir, b.id);
    if (board.items.length !== b.expect) {
      console.warn(
        `  ! ${b.label}: ${board.items.length} items, expected ${b.expect} — archive may have changed`
      );
    }
    boardTotal += board.items.length;

    for (const item of board.items) {
      const c = cells(board, item);

      const relation = linkedName(c, "Customer");
      const dropdown = txt(c, "Customer");
      const { entry, reason: custReason } = resolveCustomer(
        { relation, dropdown, itemName: item.name },
        roster
      );
      const label = relation ?? dropdown;
      resolvedVia[relation ? "relation" : dropdown ? "dropdown" : "name or none"] += 1;

      const rawPlatform = txt(c, "Development Platform");
      const platform = derivePlatform(rawPlatform);

      const state = deriveState({
        project_status: txt(c, "Project Status"),
        current_phase: txt(c, "Current Phase"),
        health: txt(c, "Health"),
      });

      const reasons: string[] = [];
      if (state.needs_attention_reason) reasons.push(state.needs_attention_reason);
      if (custReason) reasons.push(custReason);
      if (rawPlatform && !platform) reasons.push(`unmapped platform "${rawPlatform}"`);

      // migration_stage: 0019 defaults it to 'in_development', which would make
      // all 146 rows look mid-V2-migration. Set it explicitly.
      const migrationStage =
        migrationStageFromPlatform(rawPlatform) ??
        state.migration_stage ??
        (platform === "v2" ? "v2_native" : "not_required");

      views[viewForLifecycle(state.lifecycle)] += 1;
      if (reasons.length) flagged.push({ name: item.name, reason: reasons.join("; ") });

      rows.push({
        // identity
        account: label ?? item.name,
        customer_key: entry?.key ?? null,
        customer_id: entry?.id ?? null,
        process_name: item.name,

        // state
        process_status: txt(c, "Project Status"), // legacy raw, kept for reconciliation
        platform: platform ?? "v1",
        lifecycle: state.lifecycle,
        phase: state.phase,
        health: state.health,
        blocked_on: state.blocked_on,
        work_mode: state.work_mode,
        complexity: deriveComplexity(txt(c, "Complexity")),
        migration_stage: migrationStage,

        // dates
        kickoff_date: toDate(txt(c, "Kickoff Date")),
        go_live_date: toDate(txt(c, "Go Live Date")),
        // ttv_days is GENERATED — never send it.

        // ownership
        fde_owner: txt(c, "Dev"),
        tam_owner: txt(c, "TAM"),
        partner: txt(c, "Partner"),

        // effort. Monday's `Delivered Value` was empty on all 116 rows that had
        // it, so there is nothing to import into the value fields.
        total_effort_hours: toNum(txt(c, "Total Effort")),

        // review state: an imported row has never been confirmed by a human.
        reviewed_at: null,
        reviewed_by: null,

        // provenance
        source_system: "monday",
        source_board: `${board.name} (${board.id})`,
        source_item_id: item.id,
        source_raw: Object.fromEntries(
          Object.entries(c).map(([k, v]) => [k, v?.text ?? null])
        ),
        field_provenance: {},

        needs_attention: reasons.length > 0,
        needs_attention_reason: reasons.length ? reasons.join("; ") : null,

        updated_by: "monday-import",
      });
    }
  }

  console.log(`  read ${boardTotal} rows across ${REPORT_BOARDS.length} boards`);
  console.log(
    `  views: active ${views.active} · delivered ${views.delivered} · archive ${views.archive}`
  );
  console.log(
    `  customer source: relation ${resolvedVia.relation} · dropdown ${resolvedVia.dropdown} · ` +
      `name-or-none ${resolvedVia["name or none"]}   (expect 94 / 45 / 7)`
  );
  console.log(`  unresolved customer: ${rows.filter((r) => !r.customer_id).length}`);
  console.log(`  flagged for review: ${flagged.length}`);
  if (opts.verbose) for (const f of flagged) console.log(`    · ${f.name} — ${f.reason}`);

  // Expected values from the archive analysis. A mismatch means the archive or
  // the mapping changed and the numbers in the docs are now wrong.
  const expected = { total: 146, active: 30, delivered: 71, archive: 45, flagged: 15 };
  const drift: string[] = [];
  if (boardTotal !== expected.total) drift.push(`total ${boardTotal} != ${expected.total}`);
  if (views.active !== expected.active) drift.push(`active ${views.active} != ${expected.active}`);
  if (views.delivered !== expected.delivered)
    drift.push(`delivered ${views.delivered} != ${expected.delivered}`);
  if (views.archive !== expected.archive) drift.push(`archive ${views.archive} != ${expected.archive}`);
  // Only meaningful with a roster. Without one every row reads as unmatched and
  // the flagged count is noise, so say that instead of raising a false alarm.
  if (rosterCount(roster) < MIN_PLAUSIBLE_ROSTER) {
    console.warn(
      "  ! roster too thin — the customer-source split above is real, but " +
        "'unresolved customer' and the flagged count are artefacts of the empty roster"
    );
  } else if (flagged.length !== expected.flagged) {
    drift.push(`flagged ${flagged.length} != ${expected.flagged}`);
  }
  if (drift.length) {
    console.warn(`  ! DRIFT from the approved numbers: ${drift.join(", ")}`);
    console.warn("    Investigate before applying — the docs and the IA cite these.");
  } else {
    console.log("  ✓ matches the approved counts exactly");
  }

  if (!opts.apply || !sb) {
    console.log("  dry run — nothing written");
    return;
  }

  // Idempotent on source_item_id (unique partial index from 0021).
  const { error, count } = await sb
    .from("processes")
    .upsert(rows, { onConflict: "source_item_id", count: "exact" });
  if (error) throw new Error(`processes upsert failed: ${error.message}`);
  console.log(`  ✓ wrote ${count ?? rows.length} rows`);
}

// ─── Phase: nps ──────────────────────────────────────────────────────────────

async function importNps(
  sb: SupabaseClient | null,
  dir: string,
  roster: Map<string, RosterEntry>,
  opts: Opts
): Promise<void> {
  console.log("\n── nps_responses ───────────────────────────────────────────");

  const board = loadBoard(dir, NPS_BOARD);
  const rows: Record<string, unknown>[] = [];
  const skipped: Flagged[] = [];

  for (const item of board.items) {
    const c = cells(board, item);
    const { entry, reason } = resolveByLabel(linkedName(c, "Customer"), roster);

    const score = toNum(txt(c, "NPS Score"));
    const date = toDate(txt(c, "Response Date"));
    // customer_id is NOT NULL on nps_responses, so an unresolved customer cannot
    // be imported. Report it rather than dropping it silently.
    if (!entry || score === null || !date) {
      skipped.push({
        name: item.name,
        reason: reason ?? (score === null ? "no score" : "no response date"),
      });
      continue;
    }

    rows.push({
      customer_id: entry.id,
      respondent_name: item.name,
      respondent_type: txt(c, "Respondent Type"),
      quarter: txt(c, "Quarter") ?? item.group?.title ?? "unknown",
      response_date: date,
      score,
      product_satisfaction: txt(c, "Product Satisfaction"),
      feedback: txt(c, "Feedback"),
      source_item_id: item.id,
    });
  }

  console.log(`  read ${board.items.length} responses, importable ${rows.length}`);
  if (skipped.length) {
    console.warn(`  ! skipped ${skipped.length} (customer_id is required)`);
    for (const s of skipped) console.warn(`    · ${s.name} — ${s.reason}`);
  }
  if (rows.length) {
    const scores = rows.map((r) => r.score as number);
    const promoters = scores.filter((s) => s >= 9).length;
    const detractors = scores.filter((s) => s <= 6).length;
    const nps = Math.round(((promoters - detractors) / scores.length) * 100);
    console.log(
      `  derived NPS ${nps} (promoters ${promoters}, detractors ${detractors}, n ${scores.length})`
    );
  }

  if (!opts.apply || !sb) {
    console.log("  dry run — nothing written");
    return;
  }
  const { error, count } = await sb
    .from("nps_responses")
    .upsert(rows, { onConflict: "source_item_id", count: "exact" });
  if (error) throw new Error(`nps upsert failed: ${error.message}`);
  console.log(`  ✓ wrote ${count ?? rows.length} rows`);
}

// ─── Phase: customers ────────────────────────────────────────────────────────

const HEALTH_SCALE: Record<string, number | null> = {
  "strong (3)": 3,
  "moderate (2)": 2,
  "critical (1)": 1,
  evaluating: null, // "not assessed", not zero
};

async function importCustomers(
  sb: SupabaseClient | null,
  dir: string,
  roster: Map<string, RosterEntry>,
  opts: Opts
): Promise<void> {
  console.log("\n── customers / profiles / internal_profiles ────────────────");

  const board = loadBoard(dir, CUSTOMERS_BOARD);
  let matched = 0;
  const unmatched: string[] = [];
  const skippedProtected: string[] = [];
  let accountTypeSet = 0;
  let dealTypeSet = 0;

  const custUpdates: { id: string; patch: Record<string, unknown> }[] = [];
  const profileUpdates: { id: string; patch: Record<string, unknown> }[] = [];
  const internalUpdates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const item of board.items) {
    const c = cells(board, item);
    const { entry } = resolveByLabel(item.name, roster);
    if (!entry) {
      unmatched.push(item.name);
      continue;
    }
    matched += 1;

    // Monday's single "Account Type" column held values from two different axes,
    // so no row carries both. Every row lands missing one of the two — a known,
    // planned one-time human pass over 41 rows.
    const rawType = norm(txt(c, "Account Type") ?? "");
    const patch: Record<string, unknown> = {};
    if (rawType === "partner") {
      patch.account_type = "partner_managed";
      accountTypeSet += 1;
    } else if (rawType === "long term") {
      patch.deal_type = "long_term";
      dealTypeSet += 1;
    } else if (rawType === "pov") {
      patch.deal_type = "pov";
      dealTypeSet += 1;
    }

    // Never clobber a human-set value in a protected field.
    for (const f of PROTECTED_IF_SET) {
      if (f in patch && (entry.protectedFields.includes(f) || entry.existing[f])) {
        delete patch[f];
        skippedProtected.push(`${entry.key}.${f}`);
      }
    }
    if (Object.keys(patch).length) custUpdates.push({ id: entry.id, patch });

    const profilePatch: Record<string, unknown> = {};
    const rev = txt(c, "Company Revenue");
    const focus = txt(c, "Company Focus");
    const prio = txt(c, "Company Priorities");
    if (rev) profilePatch.company_revenue = rev;
    if (focus) profilePatch.company_focus = focus;
    if (prio) profilePatch.company_priorities = prio;
    if (Object.keys(profilePatch).length)
      profileUpdates.push({ id: entry.id, patch: profilePatch });

    const internalPatch: Record<string, unknown> = {};
    const axes: [string, string][] = [
      ["Renewal Health", "renewal_health"],
      ["Pipeline Health", "pipeline_health"],
      ["Champion Health", "champion_health"],
      ["Exec Sponsor Health", "exec_sponsor_health"],
    ];
    for (const [mondayCol, col] of axes) {
      const raw = norm(txt(c, mondayCol) ?? "");
      if (raw in HEALTH_SCALE) internalPatch[col] = HEALTH_SCALE[raw];
    }
    if (norm(txt(c, "V2 Demo Completed?") ?? "") === "yes") {
      // Monday recorded only Yes/No with no date. Use the item's last update as
      // the best available approximation and flag it as approximate in the log
      // rather than inventing a precise date.
      internalPatch.v2_demo_completed_at = toDate(item.updated_at ?? null);
    }
    if (Object.keys(internalPatch).length)
      internalUpdates.push({ id: entry.id, patch: internalPatch });
  }

  console.log(`  read ${board.items.length} customers, matched ${matched}`);
  if (unmatched.length) console.warn(`  ! unmatched: ${unmatched.join(", ")}`);
  console.log(
    `  account_type set on ${accountTypeSet}, deal_type on ${dealTypeSet} ` +
      `(the other axis is null by construction — Monday conflated them)`
  );
  console.log(
    `  patches: customers ${custUpdates.length} · profiles ${profileUpdates.length} · internal ${internalUpdates.length}`
  );
  if (skippedProtected.length)
    console.log(`  respected human edits, skipped: ${skippedProtected.join(", ")}`);

  if (!opts.apply || !sb) {
    console.log("  dry run — nothing written");
    return;
  }

  for (const u of custUpdates) {
    const { error } = await sb.from("customers").update(u.patch).eq("id", u.id);
    if (error) throw new Error(`customers update ${u.id} failed: ${error.message}`);
  }
  for (const u of profileUpdates) {
    const { error } = await sb.from("profiles").update(u.patch).eq("customer_id", u.id);
    if (error) throw new Error(`profiles update ${u.id} failed: ${error.message}`);
  }
  for (const u of internalUpdates) {
    const { error } = await sb.from("internal_profiles").update(u.patch).eq("customer_id", u.id);
    if (error) throw new Error(`internal_profiles update ${u.id} failed: ${error.message}`);
  }
  console.log(
    `  ✓ wrote ${custUpdates.length + profileUpdates.length + internalUpdates.length} patches`
  );
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    help();
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(process.cwd(), opts.backup);
  if (!fs.existsSync(dir)) throw new Error(`backup folder not found: ${dir}`);

  console.log(`backup   ${opts.backup}`);
  console.log(`phases   ${opts.only.join(", ")}`);
  console.log(`mode     ${opts.apply ? "APPLY — will write" : "dry run"}`);
  if (opts.apply) console.log(`target   ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  // The roster is needed for customer resolution even in a dry run, so the
  // counts it reports are real. Falls back to an empty roster with a clear
  // warning when credentials are absent.
  let sb: SupabaseClient | null = null;
  let roster = new Map<string, RosterEntry>();
  try {
    sb = client();
    roster = await loadRoster(sb);
    const n = rosterCount(roster);
    console.log(`roster   ${n} customers`);

    if (n < MIN_PLAUSIBLE_ROSTER) {
      const msg =
        `roster has only ${n} customers, expected ~40. This database does not hold ` +
        `the real roster — a freshly reset local Supabase seeds almost none. ` +
        `Customer matching cannot be validated here.`;
      // Refuse to write against a roster this thin: every row would import with a
      // null customer and 146 rows would be flagged, which is worse than not
      // running at all because the upsert would then have to be undone.
      if (opts.apply) throw new Error(msg);
      console.warn(`         ! ${msg}`);
      console.warn(
        "         Point at production for a read-only dry run to check matching:"
      );
      console.warn(
        "           NEXT_PUBLIC_SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod> \\"
      );
      console.warn("             npx tsx scripts/import-monday-backup.ts");
    }
  } catch (err) {
    if (opts.apply) throw err;
    console.warn(`roster   UNAVAILABLE — ${(err as Error).message}`);
    console.warn("         Every row will read as unmatched. The taxonomy and view");
    console.warn("         counts below are still valid; the customer numbers are not.");
  }

  if (opts.only.includes("processes")) await importProcesses(sb, dir, roster, opts);
  if (opts.only.includes("nps")) await importNps(sb, dir, roster, opts);
  if (opts.only.includes("customers")) await importCustomers(sb, dir, roster, opts);

  console.log(
    opts.apply
      ? "\ndone — re-run any time, upserts converge on source_item_id"
      : "\ndry run complete — re-run with --apply to write"
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
