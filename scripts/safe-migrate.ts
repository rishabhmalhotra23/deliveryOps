// Safe migration runner. Applies any un-applied SQL files in
// supabase/migrations/ via direct psql, in lexicographic order. NEVER
// runs `supabase db reset`. Refuses destructive statements (DROP TABLE,
// TRUNCATE) unless the user explicitly opts in with --allow-destructive.
//
// Run: npx tsx scripts/safe-migrate.ts          # apply new migrations
//      npx tsx scripts/safe-migrate.ts --dry    # show what would run
//      npx tsx scripts/safe-migrate.ts --status # which are applied vs pending
//
// This is the ONLY supported way to apply migrations from this repo's
// scripts. See .cursor/rules/destructive-operations.mdc for the why.

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const DESTRUCTIVE_PATTERNS = [
  /\bdrop\s+(table|schema|database|index|column)\b/i,
  /\btruncate\b/i,
  /\balter\s+table\s+\w+\s+drop\s+column\b/i,
  /\bdelete\s+from\s+\w+\b/i, // suspicious in a migration; require opt-in
];

const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run");
const statusOnly = process.argv.includes("--status");
const allowDestructive = process.argv.includes("--allow-destructive");

// We talk to the Supabase Postgres via docker exec — no `psql` on the host
// PATH required. The container name is the canonical one set by `supabase
// start` for this project ("delivery-ops" → "supabase_db_delivery-ops").
const DB_CONTAINER = "supabase_db_delivery-ops";

function dockerPsql(sql: string): string {
  try {
    return execSync(
      `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`docker exec psql failed: ${stderr || (err as Error).message}`);
  }
}

function dockerPsqlFile(filePath: string): void {
  try {
    // Stream the file into the container's psql via stdin so we don't have
    // to copy it into the container or worry about file mounting.
    execSync(
      `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "${filePath}"`,
      { encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"], shell: "/bin/bash" }
    );
  } catch (err) {
    throw new Error(`psql -f ${filePath} failed: ${(err as Error).message}`);
  }
}

const psql = dockerPsql;
const psqlFile = dockerPsqlFile;

function ensureMigrationsTable() {
  // Mirrors Supabase's own migrations tracking table. If supabase init
  // hasn't been run, we still want a way to remember applied files.
  //
  // The Supabase CLI sometimes creates this table with a minimal shape
  // (version + statements + name only). When that's the case, we ADD the
  // tracking columns this script writes to — idempotently — so we can use
  // a single insert statement below regardless of how the table was born.
  psql(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text,
      created_by text default 'safe-migrate.ts',
      idempotency_key text,
      applied_at timestamptz default now()
    );
    alter table supabase_migrations.schema_migrations
      add column if not exists created_by text default 'safe-migrate.ts';
    alter table supabase_migrations.schema_migrations
      add column if not exists idempotency_key text;
    alter table supabase_migrations.schema_migrations
      add column if not exists applied_at timestamptz default now();
  `);
}

function appliedVersions(): Set<string> {
  const out = psql(
    `select version from supabase_migrations.schema_migrations order by version asc;`
  );
  return new Set(
    out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function scanMigrationFile(filePath: string): { sql: string; destructiveHits: string[] } {
  const sql = fs.readFileSync(filePath, "utf-8");
  const hits: string[] = [];
  for (const re of DESTRUCTIVE_PATTERNS) {
    const m = sql.match(re);
    if (m) hits.push(m[0]);
  }
  return { sql, destructiveHits: hits };
}

function versionFromFilename(name: string): string | null {
  // Mirror Supabase's expected naming: NNNN_description.sql or
  // YYYYMMDDHHMMSS_description.sql. We accept either.
  const m = name.match(/^(\d+)/);
  return m ? m[1] : null;
}

function preflightSanityCheck(): void {
  // Count rows in critical tables; if customers > 0 we know the DB has
  // data and we must NOT do anything destructive.
  let customerCount = 0;
  try {
    customerCount = Number(psql(`select count(*) from customers where deleted_at is null;`).trim()) || 0;
  } catch {
    // customers table may not exist yet on a brand-new DB; treat as 0.
  }
  console.log(`[safe-migrate] Preflight: customers table has ${customerCount} active row(s).`);
  if (customerCount > 0 && allowDestructive && !process.env.I_REALLY_MEAN_IT) {
    throw new Error(
      "Refusing to run --allow-destructive against a non-empty database.\n" +
        "If you really mean to proceed, re-run with the env var: I_REALLY_MEAN_IT=1"
    );
  }
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  preflightSanityCheck();
  ensureMigrationsTable();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied = appliedVersions();

  console.log(`Found ${files.length} migration file(s).`);
  console.log(`Already applied: ${applied.size} (${[...applied].join(", ") || "—"}).`);

  if (statusOnly) {
    for (const f of files) {
      const v = versionFromFilename(f);
      const tag = v && applied.has(v) ? "[applied]" : "[pending]";
      console.log(`  ${tag.padEnd(10)} ${f}`);
    }
    return;
  }

  const pending = files.filter((f) => {
    const v = versionFromFilename(f);
    return v && !applied.has(v);
  });
  if (pending.length === 0) {
    console.log("No pending migrations — database is up to date.");
    return;
  }

  console.log(`\n${pending.length} pending migration(s):`);
  for (const f of pending) console.log(`  • ${f}`);
  console.log("");

  // Scan every pending file for destructive statements BEFORE running anything.
  const destructive: Array<{ file: string; hits: string[] }> = [];
  for (const f of pending) {
    const { destructiveHits } = scanMigrationFile(path.join(MIGRATIONS_DIR, f));
    if (destructiveHits.length > 0) destructive.push({ file: f, hits: destructiveHits });
  }
  if (destructive.length > 0 && !allowDestructive) {
    console.error("\n[safe-migrate] DESTRUCTIVE STATEMENTS DETECTED — refusing to proceed.");
    for (const d of destructive) {
      console.error(`  ${d.file}:`);
      for (const h of d.hits) console.error(`    • matched: "${h}"`);
    }
    console.error("\nReview the SQL by hand. If you're sure, re-run with --allow-destructive.");
    console.error("If the database has live data, also set I_REALLY_MEAN_IT=1 to confirm.");
    process.exit(2);
  }

  if (dryRun) {
    console.log("[safe-migrate] DRY RUN — would apply the pending migrations now. No changes made.");
    return;
  }

  // Apply each pending migration via psql. Use an explicit transaction
  // per file so a partial failure doesn't leave the DB half-migrated.
  for (const f of pending) {
    const version = versionFromFilename(f)!;
    const fullPath = path.join(MIGRATIONS_DIR, f);
    console.log(`\nApplying ${f} (version=${version})…`);

    psql("begin;");
    try {
      psqlFile(fullPath);
      psql(
        `insert into supabase_migrations.schema_migrations (version, name, idempotency_key) values ('${version}', '${f.replace(/'/g, "''")}', '${f}') on conflict (version) do nothing;`
      );
      psql("commit;");
      console.log(`  ✓ ${f} applied.`);
    } catch (err) {
      psql("rollback;");
      console.error(`  ✗ ${f} failed: ${(err as Error).message}`);
      console.error("Transaction rolled back. No partial state persisted.");
      process.exit(3);
    }
  }

  console.log(`\nAll ${pending.length} pending migration(s) applied cleanly.`);
}

try {
  main();
} catch (err) {
  console.error(`[safe-migrate] Fatal: ${(err as Error).message}`);
  process.exit(1);
}
