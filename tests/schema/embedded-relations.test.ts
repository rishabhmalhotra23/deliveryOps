// Guardrail for the bug that took every page down on 2026-09-08.
//
// `loadOverrideMap` did `.select("value, customers!inner(key)")`. PostgREST
// resolves an embedded relation through a FOREIGN KEY, and
// `field_overrides.entity_id` deliberately has none — it is polymorphic,
// pointing at customers, processes or profiles depending on `entity_type`. So
// the query could never work. It passed type-check, 405 unit tests and a
// clean production build, because not one of those executes a query, and it
// broke /delivery, /customers/[key] and /reports/v2-migration on deploy.
//
// This test reads every `.from(...).select(...)` pair out of the source,
// finds the embedded relations, and asserts a real foreign key exists in
// either direction. It needs no database — that is the point: it runs in the
// pre-commit hook, on the same commit that introduces the query.
//
// It cannot catch a wrong column name or a bad filter. Those are what
// `scripts/verify-db.ts` is for, which executes the real loaders.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import fks from "@/docs/schema/foreign-keys.json";

const ROOTS = ["lib", "app", "scripts"];

/** PostgREST embed syntax inside a select string: `related_table(cols)`,
 *  optionally with a `!inner` / `!left` / `!fk_name` hint. Deliberately
 *  ignores `count(...)`, `sum(...)` and the like via KNOWN_FUNCTIONS. */
const EMBED = /([a-z_][a-z0-9_]*)(![a-z_]+)?\s*\(/gi;
const KNOWN_FUNCTIONS = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "json_agg",
  "array_agg",
]);

interface Select {
  file: string;
  table: string;
  select: string;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Pairs a `.from("x")` with the `.select("...")` that follows it in the same
 *  chain. Chains here are short and written on adjacent lines, so a bounded
 *  forward window is enough and avoids needing a TypeScript AST pass. */
function extractSelects(): Select[] {
  const found: Select[] = [];
  for (const file of ROOTS.flatMap((r) => walk(r))) {
    const src = fs.readFileSync(file, "utf8");
    const fromRe = /\.from\(\s*(?:TABLES\.(\w+)|["'`]([\w.]+)["'`])\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(src)) !== null) {
      // TABLES.processes -> "processes"; TABLES.rosterEntries ->
      // "roster_entries". Falls back to the key itself, which only matters
      // for the FK lookup and errs toward reporting rather than skipping.
      const table = m[2] ?? camelToSnake(m[1]!);
      const window = src.slice(m.index, m.index + 600);
      const sel = /\.select\(\s*(["'`])([\s\S]*?)\1/.exec(window);
      if (sel) found.push({ file, table, select: sel[2]! });
    }
  }
  return found;
}

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function hasForeignKey(a: string, b: string): boolean {
  return fks.foreignKeys.some(
    (fk) => (fk.from === a && fk.to === b) || (fk.from === b && fk.to === a)
  );
}

describe("PostgREST embedded relations need a real foreign key", () => {
  const selects = extractSelects();

  it("finds select() calls to check — a zero here would mean the scan broke", () => {
    // Without this, a regex that stops matching turns the whole guardrail
    // into a silent pass.
    expect(selects.length).toBeGreaterThan(20);
  });

  it("every embedded relation resolves through a declared foreign key", () => {
    const offenders: string[] = [];

    for (const { file, table, select } of selects) {
      EMBED.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = EMBED.exec(select)) !== null) {
        const related = m[1]!.toLowerCase();
        if (KNOWN_FUNCTIONS.has(related)) continue;
        if (related === table) continue;
        if (!hasForeignKey(table, related)) {
          offenders.push(
            `${file}: .from("${table}").select("… ${m[1]}${m[2] ?? ""}(…)") — ` +
              `no foreign key between "${table}" and "${related}". PostgREST ` +
              `cannot embed without one; join in memory instead.`
          );
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("would have failed on the exact query that caused the outage", () => {
    // The regression itself, asserted directly rather than trusting the scan
    // above to have covered it.
    const table = "field_overrides";
    EMBED.lastIndex = 0;
    const m = EMBED.exec("value, customers!inner(key)");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("customers");
    expect(hasForeignKey(table, "customers")).toBe(false);
  });

  it("accepts an embed that does have a foreign key", () => {
    // process_linear_tickets -> linear_tickets is real, so the check must not
    // be a blanket ban on embedding.
    expect(hasForeignKey("process_linear_tickets", "linear_tickets")).toBe(true);
  });
});
