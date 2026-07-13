// Assemble a weekly V2 migration All-Hands snapshot from three inputs and write
// it as a ready-to-commit V2Week file.
//
//   1. The migration tracker Excel  → estate, stage board, journey (parse-tracker.mjs)
//   2. The app's linear_tickets table → open backlog, velocity, ticket groups
//      (already synced + Claude-classified; we only aggregate here)
//   3. v2-week-narrative.json        → the editable bits no feed owns:
//      the delivery snapshot, net-new table, push lanes, platform issues,
//      decisions, and the lede.
//
// USAGE:
//   npm run build:v2-week -- --xlsx "v2-migration-data/V2 Migration List.xlsx" --week 2026-07-13
//
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// (same vars the app uses). Reads them directly — no Next runtime needed.
//
// Output: lib/reports/weeks/<week>.generated.ts . Add it to the WEEKS registry
// (the script prints the one-line import + array edit to make).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseTracker } from "./parse-tracker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

// ── tiny arg + env helpers ──────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function loadEnvLocal() {
  const p = path.join(REPO, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const CLASS_LABEL = { hard_blocker: "Hard blocker", workaround_exists: "Workaround exists", just_a_bug: "Bug" };
const DOMAIN_THEME = {
  browser_automation: "Browser automation",
  idp_document_processing: "IDP & Excel at scale",
  integrations_connectors: "Connections & environments",
  live_automations_runtime: "Live automations & runtime",
  drafts_quill_ux: "Quill2 build & drafts UX",
  platform_infra: "Platform & infrastructure",
  other: "Other",
};
const OPEN_INPROGRESS = /review|progress|validation/i;

const iso = (d) => d.toISOString().slice(0, 10);
function daysAgo(today, n) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - n); return d; }

// ── Linear aggregation (mirrors lib/tickets/loader.ts scope: in_scope only) ──
async function linearSections(today) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local).");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from("linear_tickets").select("*");
  if (error) throw new Error("linear_tickets read failed: " + error.message);
  const tickets = (data ?? []).filter((t) => t.in_scope);

  const isOpen = (t) => !t.closed_at;
  const cls = (t) => CLASS_LABEL[t.classification] ?? "other";
  const open = tickets.filter(isOpen);

  const openNow = {
    hardBlocker: open.filter((t) => t.classification === "hard_blocker").length,
    workaround: open.filter((t) => t.classification === "workaround_exists").length,
    bug: open.filter((t) => t.classification === "just_a_bug").length,
    total: open.length,
    asOf: "Still open, from the migration-tracked Linear set. This is the current backlog, not the recent inflow below.",
  };

  const windows = [
    { window: "Last 7 days", days: 7 },
    { window: "Last 15 days", days: 15 },
    { window: "Last 30 days · since tracking began", days: 30 },
    { window: "Last 90 days", days: 90, notTracked: true },
  ];
  const rows = windows.map(({ window, days, notTracked }) => {
    const since = iso(daysAgo(today, days));
    const made = tickets.filter((t) => (t.linear_created_at ?? "").slice(0, 10) >= since);
    const resolved = made.filter((t) => t.closed_at).length;
    return {
      window,
      created: made.length,
      // Severity labeling began mid-June — don't assert a class split over 90d.
      hardBlocker: notTracked ? null : made.filter((t) => t.classification === "hard_blocker").length,
      workaround: notTracked ? null : made.filter((t) => t.classification === "workaround_exists").length,
      bug: notTracked ? null : made.filter((t) => t.classification === "just_a_bug").length,
      resolved,
      open: made.length - resolved,
    };
  });

  // Open ticket groups by domain (theme), in-progress first.
  const groups = [];
  for (const [domain, theme] of Object.entries(DOMAIN_THEME)) {
    const rowsInDomain = open
      .filter((t) => t.domain === domain)
      .sort((a, b) => (OPEN_INPROGRESS.test(b.state ?? "") ? 1 : 0) - (OPEN_INPROGRESS.test(a.state ?? "") ? 1 : 0))
      .map((t) => ({
        id: t.identifier ?? t.id,
        title: t.title,
        state: t.state ?? "Open",
        tone: OPEN_INPROGRESS.test(t.state ?? "") ? "prog" : "open",
      }));
    if (rowsInDomain.length) groups.push({ theme, rows: rowsInDomain });
  }

  const since7 = iso(daysAgo(today, 7));
  const created7 = tickets.filter((t) => (t.linear_created_at ?? "").slice(0, 10) >= since7).length;
  const closed7 = tickets.filter((t) => t.closed_at && t.closed_at.slice(0, 10) >= since7).length;

  return { openNow, rows, groups, delta: { created7, closed7 } };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  loadEnvLocal();
  const week = arg("week", iso(new Date()));
  const today = new Date(week + "T00:00:00Z");
  const xlsxPath = path.resolve(REPO, arg("xlsx", "v2-migration-data/V2 Migration List.xlsx"));
  if (!fs.existsSync(xlsxPath)) throw new Error("Excel not found: " + xlsxPath + " (pass --xlsx <path>)");

  const tracker = parseTracker(xlsxPath, today);
  const narrativePath = path.join(REPO, "v2-migration-data", "v2-week-narrative.json");
  const narrative = JSON.parse(fs.readFileSync(narrativePath, "utf8"));

  let linear;
  try {
    linear = await linearSections(today);
  } catch (e) {
    console.warn("\n[warn] Linear section skipped — " + e.message + "\n        Falling back to narrative.ticketFallback.\n");
    linear = narrative.ticketFallback;
  }

  const week_obj = {
    key: week,
    dateLabel: narrative.dateLabel,
    lede: narrative.lede ?? "",
    snapshot: narrative.snapshot,
    snapshotNote: narrative.snapshotNote,
    netNewDelta: narrative.netNewDelta,
    netNew: narrative.netNew,
    renewalsDelta: "",
    renewalBanner: null,
    renewals: narrative.renewals ?? [],
    renewalsFootnote: narrative.renewalsFootnote ?? "",
    migrationIntro: tracker.migrationIntro,
    journey: {
      goalLabel: `Goal: all ${tracker.estate.migrate} migrations at V1 parity`,
      procMax: tracker.journey.procMax,
      ticketMax: narrative.journey.ticketMax,
      dates: narrative.journey.dates,
      milestones: narrative.journey.milestones,
      finish: [...narrative.journey.finishHistory, tracker.journey.nearFinish],
      blocked: [...narrative.journey.blockedHistory, tracker.journey.blocked],
      ticketsCreated: narrative.journey.ticketsCreated,
      ticketsOpen: narrative.journey.ticketsOpen,
      finalLabels: {
        finish: String(tracker.journey.nearFinish),
        toGo: `${tracker.journey.toGo} to go`,
        blocked: String(tracker.journey.blocked),
        created: narrative.journey.finalLabels.created,
        open: narrative.journey.finalLabels.open,
        resolvedGap: narrative.journey.finalLabels.resolvedGap,
      },
    },
    boardDelta: narrative.boardDelta,
    board: tracker.board,
    boardFootnote: narrative.boardFootnote,
    pushTitle: narrative.pushTitle,
    push: narrative.push,
    platformIssuesTitle: narrative.platformIssuesTitle,
    platformIssues: narrative.platformIssues,
    ticketsDelta: `Live Linear, ${week}. Last 7 days: ${linear.delta?.created7 ?? "?"} filed, ${linear.delta?.closed7 ?? "?"} closed.`,
    ticketTrend: { intro: narrative.ticketTrend.intro, openNow: linear.openNow, rows: linear.rows, note: narrative.ticketTrend.note },
    ticketGroups: linear.groups,
    ticketsFootnote: narrative.ticketsFootnote,
    decisions: narrative.decisions,
    sources: narrative.sources,
  };

  const outDir = path.join(REPO, "lib", "reports", "weeks");
  fs.mkdirSync(outDir, { recursive: true });
  const varName = "WEEK_" + week.replace(/-/g, "_");
  const outFile = path.join(outDir, week + ".generated.ts");
  const banner = `// AUTO-GENERATED by scripts/v2-week/build-week.mjs on ${new Date().toISOString()}.\n// Regenerate: npm run build:v2-week -- --xlsx <path> --week ${week}\n// Hand-edited narrative comes from v2-migration-data/v2-week-narrative.json.\n`;
  const body = `${banner}import type { V2Week } from "../v2-allhands-weeks";\n\nexport const ${varName}: V2Week = ${JSON.stringify(week_obj, null, 2)};\n`;
  fs.writeFileSync(outFile, body);

  // Audit trail so the stage calls are inspectable.
  fs.writeFileSync(path.join(outDir, week + ".audit.json"), JSON.stringify(tracker.audit, null, 2));

  console.log(`\n✅ Wrote ${path.relative(REPO, outFile)}`);
  console.log(`   estate ${tracker.estate.migrate}/${tracker.estate.retire}/${tracker.estate.onV2}/${tracker.estate.custom}, ` +
    `near-finish ${tracker.journey.nearFinish}, blocked ${tracker.journey.blocked}, starting UAT this week ${tracker.startingThisWeek.length}`);
  console.log(`   audit → ${path.relative(REPO, path.join(outDir, week + ".audit.json"))}`);
  console.log(`\nAdd to lib/reports/v2-allhands-weeks.ts:`);
  console.log(`   import { ${varName} } from "./weeks/${week}.generated";`);
  console.log(`   export const WEEKS: V2Week[] = [${varName}, /* ...previous weeks */];\n`);
}

main().catch((e) => { console.error("\n❌ " + e.message + "\n"); process.exit(1); });
