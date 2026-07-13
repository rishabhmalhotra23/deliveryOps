// Parse the V2 migration tracker Excel into the report's tracker-derived
// sections: estate split, migration intro, the date-driven stage board, and
// the journey endpoint (at/near finish + blocked).
//
// This is the deterministic half of the weekly report — everything here comes
// straight from the "Working Sheet" tab, so uploading a fresh Excel is all it
// takes to refresh it. The ticket sections come from Linear (loadTicketsBundle)
// and the curated/Monday bits from the narrative JSON; see build-week.mjs.
//
// IMPORTANT: stage is derived from DATES, not just the status column, because
// the status field lags (a process marked "engg pending" can already have a
// customer-handover date this week). Blocked is driven by the "Blockers"
// column — so a process is only shown blocked if its blocker is written there.
// Keep the Blockers cells current in the Excel.

import xlsx from "xlsx";

const COL = {
  account: "Account / Customer",
  process: "Process Name",
  processStatus: "Process Status",
  platform: "Platform",
  migrationStatus: "Migration Status",
  parity: "Date - parity test complete",
  handover: "Date - Customer handover",
  validation: "Date - Customer validation complete",
  blockers: "Blockers",
};

const STAGE_COLOR = {
  Complete: "#1D9E75",
  "In customer UAT": "#5BC4A0",
  "Starting customer UAT this week": "#0E8C6A",
  "Parity testing": "#378ADD",
  Blocked: "#E24B4A",
};

function asDate(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === "number") {
    // Excel serial date → JS date (SheetJS cellDates should handle, but guard)
    const d = xlsx.SSF ? new Date(Math.round((v - 25569) * 86400 * 1000)) : null;
    return d && !isNaN(d) ? d : null;
  }
  return null; // strings like "TBD" / "Not required" are not real dates
}

function hasText(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s !== "" && s !== "none" && s !== "nan" && s !== "tbd";
}

function shortProcess(account, process) {
  // Strip a leading "Account -" / "Account —" and common vendor prefixes.
  let p = String(process).trim();
  p = p.replace(/^wipro dop\s*-\s*/i, "");
  const acc = String(account).trim();
  const re = new RegExp("^" + acc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-–]\\s*", "i");
  p = p.replace(re, "");
  return p.trim();
}

/**
 * @param {string} xlsxPath
 * @param {Date} [today]
 * @returns tracker-derived report sections + a per-process audit trail
 */
export function parseTracker(xlsxPath, today = new Date()) {
  const wb = xlsx.readFile(xlsxPath, { cellDates: true });
  const ws = wb.Sheets["Working Sheet"];
  if (!ws) throw new Error('Sheet "Working Sheet" not found in ' + xlsxPath);
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null });

  const missingCols = Object.values(COL).filter((c) => !(c in (rows[0] ?? {})));
  if (missingCols.length) {
    throw new Error(
      "Tracker columns missing (has the sheet layout changed?): " + missingCols.join(", ")
    );
  }

  const data = rows.filter((r) => hasText(r[COL.account]));
  const T = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const WEND = new Date(T);
  WEND.setUTCDate(WEND.getUTCDate() + 6); // "this week" = today .. +6 days

  // ── Estate split ──────────────────────────────────────────────────────────
  const estate = { migrate: 0, retire: 0, onV2: 0, custom: 0 };
  for (const r of data) {
    const plat = String(r[COL.platform] ?? "").trim();
    const mig = String(r[COL.migrationStatus] ?? "").trim();
    if (plat === "Custom Solution") estate.custom++;
    else if (mig === "V2 implementation") estate.onV2++;
    else if (mig === "Not required") estate.retire++;
    else estate.migrate++;
  }
  const total = data.length;

  const isMigrating = (r) => {
    const plat = String(r[COL.platform] ?? "").trim();
    const mig = String(r[COL.migrationStatus] ?? "").trim();
    return !(plat === "Custom Solution" || mig === "Not required" || mig === "V2 implementation");
  };

  // ── Stage per migrating process (date-driven) ───────────────────────────────
  const stageOf = (r) => {
    const st = String(r[COL.migrationStatus] ?? "").trim();
    const P = asDate(r[COL.parity]);
    const H = asDate(r[COL.handover]);
    const V = asDate(r[COL.validation]);
    const blocked = hasText(r[COL.blockers]);
    if (st === "Completed") return "Complete";
    if (blocked && !H) return "Blocked";
    if (H && H >= T && H <= WEND) return "Starting customer UAT this week";
    if ((H && H < T) || V || st === "Customer pending") return "In customer UAT";
    if ((P && P <= T) || st === "v1 Parity Testing") return "Parity testing";
    // "in build" (parity not yet done) folds into Parity testing so the board
    // stays five stages; it still counts toward near-finish.
    return "Parity testing";
  };

  const migRows = data.filter(isMigrating);
  const STAGES = ["Complete", "In customer UAT", "Starting customer UAT this week", "Parity testing", "Blocked"];
  const byStage = Object.fromEntries(STAGES.map((s) => [s, []]));
  const audit = [];
  for (const r of migRows) {
    const s = stageOf(r);
    byStage[s].push(r);
    audit.push({
      account: String(r[COL.account]).trim(),
      process: String(r[COL.process]).trim(),
      status: String(r[COL.migrationStatus] ?? "").trim(),
      handover: asDate(r[COL.handover])?.toISOString().slice(0, 10) ?? null,
      blocker: hasText(r[COL.blockers]) ? String(r[COL.blockers]).trim() : null,
      stage: s,
    });
  }

  // ── Chips: collapse per account within a stage ──────────────────────────────
  const chipsFor = (stageRows) => {
    const byAcc = new Map();
    for (const r of stageRows) {
      const acc = String(r[COL.account]).trim();
      if (!byAcc.has(acc)) byAcc.set(acc, []);
      byAcc.get(acc).push(r);
    }
    const chips = [];
    for (const [acc, rs] of byAcc) {
      if (rs.length > 1) chips.push({ name: `${acc} ×${rs.length}` });
      else chips.push({ name: `${acc} · ${shortProcess(acc, rs[0][COL.process])}` });
    }
    return chips;
  };

  const board = STAGES
    .map((s) => ({ stage: s, count: byStage[s].length, color: STAGE_COLOR[s], chips: chipsFor(byStage[s]) }))
    .filter((row) => row.count > 0);

  const blocked = byStage["Blocked"].length;
  const nearFinish = migRows.length - blocked; // Complete + UAT + Starting + Parity

  return {
    generatedAt: T.toISOString().slice(0, 10),
    total,
    estate,
    migrationIntro:
      `Of ${total} tracked V1 processes: ${estate.migrate} migrate to V2, ${estate.retire} retire with V1, ` +
      `${estate.onV2} are already on V2, and ${estate.custom} are custom / off-platform. ` +
      `Everything below is the migration program.`,
    board,
    journey: { procMax: estate.migrate, nearFinish, toGo: estate.migrate - nearFinish, blocked },
    startingThisWeek: byStage["Starting customer UAT this week"].map((r) => String(r[COL.process]).trim()),
    audit,
  };
}
