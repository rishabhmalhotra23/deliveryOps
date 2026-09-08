// Executes the real read path against a real database, and checks the data
// invariants this app depends on. Read-only throughout.
//
// This exists because of 2026-09-08. `loadOverrideMap` shipped a PostgREST
// embedded relation that could never resolve, took /delivery,
// /customers/[key] and /reports/v2-migration down, and passed type-check, 405
// unit tests and a clean production build on the way — because none of those
// execute a query. Every store test stubs above the Supabase client, so a
// query that is valid TypeScript and invalid SQL is invisible to them.
//
// Two phases, both of which have caught a real bug:
//
//   QUERIES    calls every loader the pages call. Catches a malformed query,
//              a renamed column, a missing table, a bad embed. This is what
//              would have caught the outage.
//   INVARIANTS asserts relationships the schema cannot enforce. Catches the
//              mergeRosterEntries bug found the same day: it repointed owner
//              FKs and left the denormalized owner TEXT behind, so the roster
//              and the Delivery table disagreed about who owned what.
//
// Run before pushing anything that touches a query or a migration:
//
//   npx tsx scripts/verify-db.ts
//
// Reads .env.local, which points at the local Supabase. To check against
// production (every statement here is a SELECT):
//
//   AUDIT_SUPABASE_URL=https://<ref>.supabase.co \
//   AUDIT_SUPABASE_SERVICE_ROLE_KEY=<key> \
//   npx tsx scripts/verify-db.ts
//
// --dump-fks regenerates docs/schema/foreign-keys.json for the static
// embedded-relation test.

import "dotenv/config";
import "@/lib/supabase/ws-polyfill";

import * as fs from "node:fs";
import * as path from "node:path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

// AUDIT_* wins so one run can target another database without leaving
// .env.local edited.
if (process.env.AUDIT_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.AUDIT_SUPABASE_URL;
}
if (process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY;
}

import { createClient } from "@supabase/supabase-js";

// A pre-push hook that can hang is worse than no hook: the Supabase client
// retries a refused connection, so an unreachable database would otherwise
// stall a push indefinitely rather than skipping.
const TIMEOUT_MS = Number(process.env.VERIFY_DB_TIMEOUT_MS ?? 60_000);

function withTimeout<T>(label: string, p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${TIMEOUT_MS}ms — is the database reachable?`)),
        TIMEOUT_MS
      )
    ),
  ]);
}

let failures = 0;
let checks = 0;

function pass(name: string, detail = "") {
  checks++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, err: unknown) {
  checks++;
  failures++;
  const msg = err instanceof Error ? err.message : JSON.stringify(err);
  console.log(`  ✗ ${name}\n      ${msg}`);
}

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Phase 1: every loader actually runs ───────────────────────────────────
// Imported lazily and individually: one loader throwing must not stop the
// rest, or the first failure hides every other.
const LOADERS: { name: string; run: () => Promise<unknown> }[] = [
  {
    name: "loadProcessesOverview",
    run: async () => (await import("@/lib/processes/loader")).loadProcessesOverview(),
  },
  {
    name: "loadV2MigrationOverview (All-Hands population)",
    run: async () => (await import("@/lib/processes/loader")).loadV2MigrationOverview(),
  },
  {
    name: "loadOverrideMap('confirmed_arr')",
    run: async () => (await import("@/lib/overrides/store")).loadOverrideMap("confirmed_arr"),
  },
  {
    name: "listOverrides('customer')",
    run: async () => (await import("@/lib/overrides/store")).listOverrides("customer"),
  },
  {
    name: "loadColorMap",
    run: async () => (await import("@/lib/vocabulary/store")).loadColorMap(),
  },
  {
    name: "loadVocabMap",
    run: async () => (await import("@/lib/vocabulary/store")).loadVocabMap(),
  },
  {
    name: "listVocabularyValues",
    run: async () => (await import("@/lib/vocabulary/store")).listVocabularyValues(),
  },
  {
    name: "listCustomers",
    run: async () => (await import("@/lib/customers")).listCustomers(),
  },
  {
    name: "countCustomerProcesses",
    run: async () => (await import("@/lib/customers")).countCustomerProcesses(),
  },
  {
    name: "listRosterEntries",
    run: async () => (await import("@/lib/roster/store")).listRosterEntries(),
  },
  {
    name: "searchRosterEntries (alias path)",
    run: async () => (await import("@/lib/roster/store")).searchRosterEntries({ q: "a" }),
  },
  {
    name: "countRosterAssignments",
    run: async () => (await import("@/lib/roster/store")).countRosterAssignments(),
  },
  {
    // /customers renders zones and category chips from these (0045). Executed
    // here because the whole page groups by the result: a broken query would
    // take the customer list down the way loadOverrideMap took Delivery down.
    name: "loadCustomerVocabulary",
    run: async () => (await import("@/lib/vocabulary/store")).loadCustomerVocabulary(),
  },
  {
    name: "countLiveCustomerProcesses",
    run: async () => (await import("@/lib/customers")).countLiveCustomerProcesses(),
  },
  {
    name: "countCustomerVocabularyUsage (delete guard)",
    run: async () =>
      (await import("@/lib/vocabulary/store")).countCustomerVocabularyUsage(
        "customer_category",
        "Churned"
      ),
  },
  {
    // Configure -> Roster's Aliases section. Executed here rather than only
    // unit-tested because the store tests stub above the Supabase client, and
    // that gap is exactly what let the 2026-09-08 outage ship.
    name: "listRosterAliases",
    run: async () => {
      const store = await import("@/lib/roster/store");
      const [first] = await store.listRosterEntries();
      return first ? store.listRosterAliases(first.id) : [];
    },
  },
  {
    name: "loadAnalytics (dashboard Trends)",
    run: async () => (await import("@/lib/analytics/loader")).loadAnalytics(),
  },
  {
    name: "loadArrBreakdown",
    run: async () => (await import("@/lib/dashboard/stats-drilldown")).loadArrBreakdown(),
  },
  {
    name: "loadPortfolioSummary",
    run: async () => (await import("@/lib/cache/integrations")).loadPortfolioSummary(),
  },
  {
    name: "loadCustomerCommercialsMap",
    run: async () => (await import("@/lib/cache/integrations")).loadCustomerCommercialsMap(),
  },
  {
    name: "loadSettings (value model + NPS cadence)",
    run: async () => (await import("@/lib/settings/store")).loadSettings(),
  },
  {
    name: "loadAllHandsReport",
    run: async () => (await import("@/lib/reports/allhands-loader")).loadAllHandsReport(),
  },
];

async function phaseQueries() {
  console.log("\nQUERIES — every loader the pages call\n" + "-".repeat(58));
  for (const { name, run } of LOADERS) {
    try {
      await run();
      pass(name);
    } catch (err) {
      fail(name, err);
    }
  }
}

// ─── Phase 2: invariants the schema can't express ──────────────────────────
async function phaseInvariants() {
  console.log("\nINVARIANTS — relationships no constraint enforces\n" + "-".repeat(58));
  const s = sb();

  // The one that caught mergeRosterEntries. `processes` keeps both halves of
  // every owner (0032) so pre-roster readers work; a write that moves the FK
  // and not the text makes the roster and the table disagree.
  try {
    const { data, error } = await s
      .from("processes")
      .select("id, process_name, fde_owner, tam_owner, engg_owner, partner, fde_owner_id, tam_owner_id, engg_owner_id, partner_id")
      .is("deleted_at", null);
    if (error) throw error;
    const { data: roster, error: rErr } = await s
      .from("roster_entries")
      .select("id, display_name");
    if (rErr) throw rErr;

    const nameById = new Map(
      ((roster as { id: string; display_name: string }[]) ?? []).map((r) => [r.id, r.display_name])
    );
    const pairs: [string, string][] = [
      ["fde_owner_id", "fde_owner"],
      ["tam_owner_id", "tam_owner"],
      ["engg_owner_id", "engg_owner"],
      ["partner_id", "partner"],
    ];
    const drift: string[] = [];
    for (const row of (data as Record<string, string | null>[]) ?? []) {
      for (const [idCol, textCol] of pairs) {
        const id = row[idCol];
        if (!id) continue;
        const expected = nameById.get(id);
        if (expected && row[textCol] !== expected) {
          drift.push(`${row.process_name}: ${textCol}="${row[textCol]}" but FK says "${expected}"`);
        }
      }
    }
    if (drift.length > 0) {
      fail(
        `owner text mirrors match their FK (${drift.length} drifted)`,
        new Error(drift.slice(0, 5).join("\n      "))
      );
    } else {
      pass("owner text mirrors match their FK");
    }
  } catch (err) {
    fail("owner text mirrors match their FK", err);
  }

  // A section is derived from lifecycle + migration_stage, so every process
  // must resolve to one. A value present in the enum but absent from the
  // routing rules would silently strand rows.
  //
  // Checked against inHistoricalSection rather than sectionFor alone, because
  // sectionFor's return value being a valid string is not the invariant that
  // matters — being VISIBLE somewhere is. Since 2026-09-08 live + v2_native
  // routes to "historical", and Historical renders the union of that and the
  // shipped lens; a process marked live with no go-live date satisfies
  // sectionFor but would fail the lens, so only the union catches it.
  try {
    const { sectionFor, inHistoricalSection } = await import("@/lib/delivery/sections");
    const { data, error } = await s
      .from("processes")
      .select("id, process_name, lifecycle, migration_stage, go_live_date")
      .is("deleted_at", null);
    if (error) throw error;
    type Row = Parameters<typeof inHistoricalSection>[0] & { id: string; process_name: string };
    const rows = (data as Row[]) ?? [];
    const stranded = rows.filter((r) => {
      const routed = sectionFor(r);
      if (routed === "active" || routed === "v2") return false;
      return !inHistoricalSection(r);
    });
    if (stranded.length > 0) {
      fail(
        "every process is visible in a section",
        new Error(
          `${stranded.length} stranded: ${stranded
            .slice(0, 5)
            .map((r) => `${r.process_name} (${r.lifecycle}/${r.migration_stage}, go_live=${r.go_live_date ?? "null"})`)
            .join("; ")}`
        )
      );
    } else {
      const counts = {
        active: rows.filter((r) => sectionFor(r) === "active").length,
        v2: rows.filter((r) => sectionFor(r) === "v2").length,
        historical: rows.filter((r) => inHistoricalSection(r)).length,
      };
      pass(
        "every process is visible in a section",
        `${rows.length} rows — active ${counts.active}, v2 ${counts.v2}, historical ${counts.historical} (lens overlaps, so these do not sum)`
      );
    }
  } catch (err) {
    fail("every process is visible in a section", err);
  }

  // Every category a customer carries must have a vocabulary row, and every
  // category must roll up to a zone that exists — otherwise /customers groups
  // that customer under a header it cannot name. 0045 seeds a row for anything
  // already stored, so a failure here means something was written since.
  try {
    const { loadCustomerVocabulary } = await import("@/lib/vocabulary/store");
    const vocab = await loadCustomerVocabulary();
    const { data, error } = await s
      .from("customers")
      .select("display_name, custom_category")
      .is("deleted_at", null)
      .not("custom_category", "is", null);
    if (error) throw error;

    const known = new Set(vocab.categories.map((c) => c.value));
    const zoneValues = new Set(vocab.zones.map((z) => z.value));
    const rows = (data as { display_name: string; custom_category: string }[]) ?? [];
    const unknown = rows.filter((r) => !known.has(r.custom_category));
    const orphanZone = vocab.categories.filter((c) => !zoneValues.has(c.zone));

    if (unknown.length > 0 || orphanZone.length > 0) {
      fail(
        "every customer category is configured",
        new Error(
          [
            unknown.length > 0
              ? `${unknown.length} customer(s) hold an unconfigured category: ${unknown
                  .slice(0, 4)
                  .map((r) => `${r.display_name} (${r.custom_category})`)
                  .join("; ")}`
              : null,
            orphanZone.length > 0
              ? `${orphanZone.length} category/ies roll up to a missing zone: ${orphanZone
                  .map((c) => `${c.value} -> ${c.zone}`)
                  .join("; ")}`
              : null,
          ]
            .filter(Boolean)
            .join(" | ")
        )
      );
    } else {
      pass(
        "every customer category is configured",
        `${vocab.categories.length} categories across ${vocab.zones.length} zones`
      );
    }
  } catch (err) {
    fail("every customer category is configured", err);
  }

  // Every enum value used by a row must have a presentation row, or it
  // renders as a blank grey chip with no label.
  try {
    const [{ data: vocab, error: vErr }, { data: procs, error: pErr }] = await Promise.all([
      s.from("vocabulary_values").select("vocabulary, value"),
      s.from("processes").select("migration_stage, lifecycle, health").is("deleted_at", null),
    ]);
    if (vErr) throw vErr;
    if (pErr) throw pErr;
    const known = new Set(
      ((vocab as { vocabulary: string; value: string }[]) ?? []).map((v) => `${v.vocabulary}:${v.value}`)
    );
    const missing = new Set<string>();
    for (const p of (procs as Record<string, string | null>[]) ?? []) {
      for (const [col, vocabulary] of [
        ["migration_stage", "migration_stage"],
        ["lifecycle", "process_lifecycle"],
        ["health", "process_health"],
      ] as const) {
        const v = p[col];
        if (v && !known.has(`${vocabulary}:${v}`)) missing.add(`${vocabulary}:${v}`);
      }
    }
    if (missing.size > 0) {
      fail("every value in use has a label and colour", new Error([...missing].join(", ")));
    } else {
      pass("every value in use has a label and colour");
    }
  } catch (err) {
    fail("every value in use has a label and colour", err);
  }

  // A setting whose stored shape doesn't match its compiled default is worse
  // than a missing one: the reader falls back silently, so the value in the
  // table is a lie about what the app is using.
  try {
    const { SETTING_DEFAULTS } = await import("@/lib/settings/store");
    const { data, error } = await s.from("app_settings").select("key, value");
    if (error) throw error;
    const bad: string[] = [];
    for (const row of (data as { key: string; value: unknown }[] | null) ?? []) {
      const expected = (SETTING_DEFAULTS as Record<string, unknown>)[row.key];
      if (expected === undefined) {
        bad.push(`${row.key} (not a known setting)`);
        continue;
      }
      if (typeof expected !== typeof row.value) {
        bad.push(`${row.key} (stored ${typeof row.value}, expected ${typeof expected})`);
        continue;
      }
      if (typeof expected === "object" && expected !== null) {
        for (const k of Object.keys(expected)) {
          if (typeof (row.value as Record<string, unknown>)?.[k] !== "number") {
            bad.push(`${row.key}.${k} (not a number)`);
          }
        }
      }
    }
    if (bad.length > 0) fail("every setting matches its compiled shape", new Error(bad.join(", ")));
    else pass("every setting matches its compiled shape");
  } catch (err) {
    fail("every setting matches its compiled shape", err);
  }

  // An override that points at nothing is dead weight and its value silently
  // never applies.
  try {
    const [{ data: ovr, error: oErr }, { data: custs, error: cErr }] = await Promise.all([
      s.from("field_overrides").select("entity_type, entity_id, field"),
      s.from("customers").select("id"),
    ]);
    if (oErr) throw oErr;
    if (cErr) throw cErr;
    const ids = new Set(((custs as { id: string }[]) ?? []).map((c) => c.id));
    const orphans = ((ovr as { entity_type: string; entity_id: string; field: string }[]) ?? [])
      .filter((o) => o.entity_type === "customer" && !ids.has(o.entity_id));
    if (orphans.length > 0) {
      fail("every customer override points at a real customer", new Error(`${orphans.length} orphaned`));
    } else {
      pass("every customer override points at a real customer");
    }
  } catch (err) {
    fail("every customer override points at a real customer", err);
  }
}

/** The FK snapshot the static embedded-relation test reads. The Supabase JS
 *  client can't query information_schema, so this prints the statement rather
 *  than pretending to run it — the snapshot is regenerated rarely, only when
 *  a migration adds a foreign key. */
function dumpForeignKeys() {
  console.log(
    [
      "",
      "Run this against the database and paste the rows into",
      "docs/schema/foreign-keys.json (the Supabase JS client cannot read",
      "information_schema, so this can't be automated from here):",
      "",
      '  select tc.table_name as "from", kcu.column_name as "column",',
      '         ccu.table_name as "to"',
      "  from information_schema.table_constraints tc",
      "  join information_schema.key_column_usage kcu",
      "    on kcu.constraint_name = tc.constraint_name",
      "   and kcu.table_schema = tc.table_schema",
      "  join information_schema.constraint_column_usage ccu",
      "    on ccu.constraint_name = tc.constraint_name",
      "   and ccu.table_schema = tc.table_schema",
      "  where tc.constraint_type = 'FOREIGN KEY'",
      "    and tc.table_schema = 'public'",
      "  order by 1, 2;",
      "",
      "A stale snapshot can only cause a false FAILURE, never a false pass.",
      "",
    ].join("\n")
  );
}

async function main() {
  if (process.argv.includes("--dump-fks")) {
    dumpForeignKeys();
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)";
  console.log(`\nVerifying against ${url.replace(/\/\/([^.]{6})[^/]*/, "//$1…")}`);

  await withTimeout("queries", phaseQueries());
  await withTimeout("invariants", phaseInvariants());

  console.log("\n" + "=".repeat(58));
  if (failures === 0) {
    console.log(`${checks} checks, all passed.\n`);
    return;
  }
  console.log(`${checks} checks, ${failures} FAILED.\n`);
  console.log(
    "A failure here is the class of bug unit tests cannot see: valid\nTypeScript, invalid against the database. Fix before pushing.\n"
  );
  process.exit(1);
}

main().catch((err) => {
  // "could not run" is the string the pre-push hook greps for to decide
  // between skipping and blocking — an unreachable database is a skip, a
  // broken query is a block.
  console.error("\nverify-db could not run:\n", err instanceof Error ? err.message : err);
  console.error(
    "\nIf this is a missing table or column, the database is behind on\nmigrations: npm run db:start && npx tsx scripts/safe-migrate.ts\n"
  );
  process.exit(2);
});

// Nothing here holds the event loop open on purpose, but the Supabase client
// keeps sockets warm; without this a successful run waits on them.
process.on("beforeExit", () => process.exit(failures === 0 ? 0 : 1));
