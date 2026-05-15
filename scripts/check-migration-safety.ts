// Pre-commit-friendly check: scans staged migration files for destructive
// SQL patterns and refuses to let them through without an explicit opt-in
// comment at the top of the file (`-- ALLOW_DESTRUCTIVE: <reason>`).
//
// Catches the next iteration of the 2026-05-11 / 2026-05-15 incidents where
// data loss got committed to a migration file by accident — DROP TABLE,
// TRUNCATE, DELETE FROM with no WHERE, etc.
//
// Run modes:
//   npx tsx scripts/check-migration-safety.ts                  # check ALL migrations
//   npx tsx scripts/check-migration-safety.ts <files…>         # check specific files
//   npx tsx scripts/check-migration-safety.ts --staged          # check git-staged migrations only
//
// Exits non-zero on a finding; zero (with a brief OK note) when clean.

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

// Order matters only for readability — the FIRST match wins.
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdrop\s+(table|schema|database|materialized\s+view)\b/i, label: "DROP TABLE/SCHEMA/DATABASE/MATERIALIZED VIEW" },
  { pattern: /\btruncate(\s+table)?\b/i, label: "TRUNCATE" },
  { pattern: /\bdelete\s+from\s+\w+\s*(?!where)/i, label: "DELETE FROM table without WHERE" },
  { pattern: /\balter\s+table\s+\w+\s+drop\s+column\b/i, label: "ALTER TABLE … DROP COLUMN" },
  { pattern: /\balter\s+table\s+\w+\s+drop\s+constraint\b/i, label: "ALTER TABLE … DROP CONSTRAINT" },
  // DROP POLICY is intentionally NOT in here — it's normal during RLS edits.
  // DROP INDEX is also fine — indexes are derived data.
];

const ALLOW_MARKER = /^--\s*ALLOW_DESTRUCTIVE\s*:\s*(.+)$/im;

function listMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

function listStagedMigrations(): string[] {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" });
    return out
      .split("\n")
      .filter((l) => l.startsWith("supabase/migrations/") && l.endsWith(".sql"))
      .map((l) => path.resolve(process.cwd(), l));
  } catch {
    return [];
  }
}

function checkFile(file: string): string[] {
  const content = fs.readFileSync(file, "utf8");
  const findings: string[] = [];
  for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(content)) findings.push(label);
  }
  if (findings.length > 0 && ALLOW_MARKER.test(content)) {
    const m = content.match(ALLOW_MARKER);
    console.log(`  • ${path.basename(file)}: contains [${findings.join(", ")}] — ALLOWED via marker: ${m?.[1]?.trim()}`);
    return [];
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  let files: string[];
  if (args.includes("--staged")) {
    files = listStagedMigrations();
    if (files.length === 0) {
      console.log("[migration-safety] No staged migration files. OK.");
      return;
    }
  } else if (args.length > 0) {
    files = args.map((a) => path.resolve(process.cwd(), a)).filter((f) => f.endsWith(".sql"));
  } else {
    files = listMigrations();
  }

  let totalFindings = 0;
  const failures: Array<{ file: string; findings: string[] }> = [];

  for (const file of files) {
    const findings = checkFile(file);
    if (findings.length > 0) {
      totalFindings += findings.length;
      failures.push({ file, findings });
    }
  }

  if (failures.length === 0) {
    console.log(`[migration-safety] ${files.length} migration(s) checked. OK.`);
    return;
  }

  console.error(`\n[migration-safety] BLOCKED — ${failures.length} migration(s) contain destructive SQL without an opt-in marker:\n`);
  for (const f of failures) {
    console.error(`  ✗ ${path.relative(process.cwd(), f.file)}`);
    for (const finding of f.findings) console.error(`      → ${finding}`);
  }
  console.error(`\nIf this is intentional (e.g. cleaning up a never-used table), add a marker comment at the top of the file:`);
  console.error(`    -- ALLOW_DESTRUCTIVE: <one-line reason — what's being dropped and why it's safe>`);
  console.error(`\nThen the check passes and the destructive SQL is allowed through with a clear audit trail.\n`);
  process.exit(1);
}

main();
