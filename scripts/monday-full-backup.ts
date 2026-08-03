/**
 * monday-full-backup.ts — full-fidelity, resumable Monday.com export.
 *
 * Why this exists: the ad-hoc monday-backup/ folder from 2026-07-22 covers 6 of
 * 492 boards and drops column definitions, updates, relation links, created_at,
 * state and creator. Without column definitions you cannot even decode a status
 * label. This script is the real archive we cut over from.
 *
 * Scope decisions (2026-07-30, confirmed with Rishabh):
 *   - files/attachments: METADATA ONLY (no binaries). Note that Monday
 *     public_url values are short-lived signed URLs and WILL expire.
 *   - board activity_logs: SKIPPED (high volume, retention-limited, unused).
 *   - sequencing: phase "core" first (Delivery Planning + Projects Portfolio),
 *     then phase "rest" for the long tail.
 *
 * Run from the repo root, locally (the Claude sandbox has no egress to
 * api.monday.com):
 *
 *   npx tsx scripts/monday-full-backup.ts --help
 *   npx tsx scripts/monday-full-backup.ts --phase core
 *   npx tsx scripts/monday-full-backup.ts --phase rest --resume
 *
 * Everything is written under monday-backup-<YYYY-MM-DD>/ which is gitignored.
 * This is real customer data. Do not commit it.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// dotenv prologue matches the repo convention: .env then .env.local (override).
const require_ = createRequire(import.meta.url);
for (const file of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), file);
  if (fs.existsSync(p)) require_("dotenv").config({ path: p, override: true });
}

// ─── Config ──────────────────────────────────────────────────────────────────

const ENDPOINT = "https://api.monday.com/v2";
const API_VERSION = process.env.MONDAY_API_VERSION?.trim() || "2024-04";

/** Boards DeliveryOps actually reads today. Phase "core" covers these. */
const CORE_BOARD_IDS = [
  "18395281568", // Customers
  "18395281570", // Projects
  "18398797267", // FY-2026 Deliverables
  "18398797224", // FY-2025 Deliverables
  "18398797248", // FY-2024 Deliverables
  "18398797257", // FY-2023 Deliverables
  "18398797301", // Inactive / Cancelled projects
  "18397573465", // Activity Log
  "18398995134", // NPS Tracking
  "6073051226", // Projects Portfolio -> Projects Overview
];

/** Whole workspaces pulled in full during phase "core". */
const CORE_WORKSPACE_IDS = [
  "13889621", // Delivery Planning — the report's system of record
  "8917830", // Projects Portfolio
];

// ─── CLI ─────────────────────────────────────────────────────────────────────

type Phase = "core" | "rest" | "all";

interface Options {
  phase: Phase;
  outDir: string;
  resume: boolean;
  onlyBoards: string[] | null;
  includeUpdates: boolean;
  includeAssets: boolean;
  includeSubitemBoards: boolean;
  itemPageSize: number;
  maxBoards: number | null;
  csv: boolean;
  dryRun: boolean;
}

function today(): string {
  // ISO slice, not toLocaleDateString — locale-independent by design.
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | null => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
    return null;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const phaseRaw = (get("phase") ?? "core").toLowerCase();
  if (!["core", "rest", "all"].includes(phaseRaw)) {
    throw new Error(`--phase must be core | rest | all (got "${phaseRaw}")`);
  }

  return {
    phase: phaseRaw as Phase,
    outDir: path.resolve(process.cwd(), get("out") ?? `monday-backup-${today()}`),
    resume: has("resume"),
    onlyBoards: get("boards")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    includeUpdates: !has("no-updates"),
    includeAssets: !has("no-assets"),
    includeSubitemBoards: !has("no-subitem-boards"),
    itemPageSize: Number(get("page-size") ?? 50),
    maxBoards: get("max-boards") ? Number(get("max-boards")) : null,
    csv: !has("no-csv"),
    dryRun: has("dry-run"),
  };
}

const HELP = `
monday-full-backup.ts — full-fidelity, resumable Monday.com export

USAGE
  npx tsx scripts/monday-full-backup.ts [options]

OPTIONS
  --phase core|rest|all   core = Delivery Planning + Projects Portfolio (default)
                          rest = every other board
                          all  = everything in one pass
  --boards 123,456        Export only these board ids (overrides --phase)
  --out <dir>             Output dir (default: monday-backup-<today>)
  --resume                Skip boards already marked done in the manifest
  --no-updates            Skip the item updates pass (much faster, loses history)
  --no-assets             Skip file/attachment metadata
  --no-subitem-boards     Skip auto-generated "Subitems of ..." boards
  --no-csv                Skip the decoded per-board CSV sidecar
  --page-size <n>         Items per page (default 50; lower if complexity errors)
  --max-boards <n>        Stop after n boards (for a smoke test)
  --dry-run               Print the plan and exit without exporting
  --help                  This text

NOT INCLUDED BY DESIGN
  File binaries (metadata only) and board activity_logs.

NOTES
  Reads MONDAY_API_TOKEN from .env / .env.local.
  Output contains real customer data and is gitignored. Do not commit it.
  Safe to re-run: every board is written as it completes and --resume skips them.
`;

// ─── Rate-limit aware GraphQL client ────────────────────────────────────────

interface Complexity {
  before: number;
  after: number;
  query: number;
  reset_in_x_seconds: number;
}

const COMPLEXITY_FIELD = `complexity { before after query reset_in_x_seconds }`;
/** Pause when the remaining per-minute budget drops below this. */
const COMPLEXITY_FLOOR = 200_000;

const stats = {
  requests: 0,
  retries: 0,
  complexitySpent: 0,
  throttleWaits: 0,
  throttleSeconds: 0,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function token(): string {
  const t = process.env.MONDAY_API_TOKEN?.trim();
  if (!t) throw new Error("Missing MONDAY_API_TOKEN. Add it to .env.local.");
  return t;
}

class FieldError extends Error {}

/**
 * One GraphQL round trip with retry/backoff and complexity self-throttling.
 * Monday returns the remaining budget only if the query asks for it, so every
 * read query here includes the root `complexity` field.
 */
async function gqlOnce<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const maxAttempts = 6;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    stats.requests += 1;

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: token(),
          "Content-Type": "application/json",
          "API-Version": API_VERSION,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      stats.retries += 1;
      const wait = 2 ** attempt * 1000;
      log(`  network error (${(err as Error).message}); retry ${attempt} in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }

    const raw = await res.text();

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxAttempts) {
        throw new Error(`Monday HTTP ${res.status} after ${attempt} attempts: ${raw.slice(0, 300)}`);
      }
      stats.retries += 1;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      log(`  HTTP ${res.status}; retry ${attempt} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }

    let body: {
      data?: T & { complexity?: Complexity };
      errors?: Array<{ message: string }>;
      error_message?: string;
      error_code?: string;
    };
    try {
      body = JSON.parse(raw);
    } catch {
      if (attempt >= maxAttempts) {
        throw new Error(`Monday returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`);
      }
      stats.retries += 1;
      await sleep(2 ** attempt * 1000);
      continue;
    }

    const messages = [
      ...(body.errors?.map((e) => e.message) ?? []),
      ...(body.error_message ? [body.error_message] : []),
    ];
    const joined = messages.join("; ");

    if (joined) {
      // Field-shape problems: caller falls back to a leaner query.
      if (/cannot query field|doesn't exist on type|unknown argument|did you mean/i.test(joined)) {
        throw new FieldError(joined);
      }
      // Budget exhausted: Monday tells us when it resets.
      if (/complexity budget exhausted|rate limit|max complexity/i.test(joined)) {
        const m = joined.match(/reset in (\d+)/i);
        const wait = (m ? Number(m[1]) + 2 : 60) * 1000;
        if (attempt >= maxAttempts) throw new Error(`Monday budget error after ${attempt} attempts: ${joined}`);
        stats.retries += 1;
        stats.throttleWaits += 1;
        stats.throttleSeconds += wait / 1000;
        log(`  complexity budget exhausted; waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`Monday GraphQL error: ${joined}`);
    }

    if (!body.data) throw new Error("Monday returned no data.");

    const c = body.data.complexity;
    if (c) {
      stats.complexitySpent += c.query ?? 0;
      if (typeof c.after === "number" && c.after < COMPLEXITY_FLOOR) {
        const wait = Math.max((c.reset_in_x_seconds ?? 60) + 2, 5) * 1000;
        stats.throttleWaits += 1;
        stats.throttleSeconds += wait / 1000;
        log(`  budget low (${c.after.toLocaleString("en-US")} left); pausing ${Math.round(wait / 1000)}s`);
        await sleep(wait);
      }
    }

    return body.data as T;
  }
}

/** Try the richest query; on a field-shape error fall back through the list. */
async function gqlFallback<T>(queries: string[], variables: Record<string, unknown>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < queries.length; i += 1) {
    try {
      return await gqlOnce<T>(queries[i], variables);
    } catch (err) {
      lastErr = err;
      if (err instanceof FieldError && i < queries.length - 1) {
        log(`  ${label}: API rejected some fields, falling back (${(err as Error).message.slice(0, 120)})`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Output helpers ─────────────────────────────────────────────────────────

let logStream: fs.WriteStream | null = null;

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(line);
  logStream?.write(`${stamped}\n`);
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── Manifest (resumability) ────────────────────────────────────────────────

interface BoardEntry {
  board_id: string;
  board_name?: string;
  workspace_id?: string | null;
  workspace_name?: string | null;
  status: "pending" | "done" | "error";
  item_count?: number;
  update_count?: number;
  asset_count?: number;
  file?: string;
  finished_at?: string;
  error?: string;
}

interface Manifest {
  script: string;
  api_version: string;
  started_at: string;
  last_run_at: string;
  runs: Array<{ at: string; phase: string; argv: string[] }>;
  scope: { files: string; activity_logs: string };
  totals: { boards_done: number; items: number; updates: number; assets: number };
  boards: Record<string, BoardEntry>;
}

function loadManifest(outDir: string, opts: Options): Manifest {
  const file = path.join(outDir, "_manifest.json");
  if (fs.existsSync(file)) {
    const m = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
    m.last_run_at = new Date().toISOString();
    m.runs.push({ at: m.last_run_at, phase: opts.phase, argv: process.argv.slice(2) });
    return m;
  }
  const now = new Date().toISOString();
  return {
    script: "scripts/monday-full-backup.ts",
    api_version: API_VERSION,
    started_at: now,
    last_run_at: now,
    runs: [{ at: now, phase: opts.phase, argv: process.argv.slice(2) }],
    scope: { files: "metadata only, no binaries", activity_logs: "not captured" },
    totals: { boards_done: 0, items: 0, updates: 0, assets: 0 },
    boards: {},
  };
}

function saveManifest(outDir: string, m: Manifest): void {
  writeJson(path.join(outDir, "_manifest.json"), m);
}

// ─── Queries ────────────────────────────────────────────────────────────────

const Q_ME = `query { ${COMPLEXITY_FIELD} me { id name email is_admin is_guest account { id name slug tier country_code } } }`;

const Q_USERS = [
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    users (limit: $limit, page: $page) {
      id name email enabled is_admin is_guest is_view_only is_pending created_at last_activity
      title location phone teams { id name }
    } }`,
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    users (limit: $limit, page: $page) { id name email enabled is_admin is_guest created_at teams { id name } } }`,
];

const Q_TEAMS = [
  `query { ${COMPLEXITY_FIELD} teams { id name picture_url users { id name email } } }`,
  `query { ${COMPLEXITY_FIELD} teams { id name users { id } } }`,
];

const Q_WORKSPACES = [
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    workspaces (limit: $limit, page: $page) { id name kind description created_at owners_subscribers { id name } } }`,
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    workspaces (limit: $limit, page: $page) { id name kind description } }`,
];

const Q_BOARD_INVENTORY = [
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    boards (limit: $limit, page: $page, order_by: created_at) {
      id name description state board_kind type items_count updated_at
      workspace { id name kind }
      owners { id name }
      creator { id name }
    } }`,
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    boards (limit: $limit, page: $page, order_by: created_at) {
      id name description state board_kind items_count updated_at
      workspace { id name } owners { id name }
    } }`,
  `query ($limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    boards (limit: $limit, page: $page) { id name state items_count updated_at workspace { id name } } }`,
];

const Q_BOARD_META = [
  `query ($ids: [ID!]) { ${COMPLEXITY_FIELD}
    boards (ids: $ids) {
      id name description state board_kind type items_count updated_at permissions item_terminology
      workspace { id name kind description }
      owners { id name email }
      subscribers { id name email }
      creator { id name email }
      groups { id title color position archived }
      columns { id title type description settings_str archived width }
      tags { id name color }
      views { id name type settings_str }
    } }`,
  `query ($ids: [ID!]) { ${COMPLEXITY_FIELD}
    boards (ids: $ids) {
      id name description state board_kind items_count updated_at permissions
      workspace { id name kind }
      owners { id name } subscribers { id name }
      groups { id title color position }
      columns { id title type settings_str archived width }
      tags { id name color }
      views { id name type settings_str }
    } }`,
  `query ($ids: [ID!]) { ${COMPLEXITY_FIELD}
    boards (ids: $ids) {
      id name description state items_count updated_at
      workspace { id name }
      groups { id title color }
      columns { id title type settings_str }
    } }`,
];

/**
 * Column values are a GraphQL union. The plain `value` field returns null for
 * relation, mirror and formula columns, which is exactly how the 2026-07-22
 * backup lost every cross-board link. The inline fragments below are the fix.
 */
function itemsPageQuery(opts: { assets: boolean; rich: boolean }): string {
  const assets = opts.assets
    ? `assets { id name file_extension file_size public_url url created_at uploaded_by { id name } }`
    : "";
  const richFragments = opts.rich
    ? `
            ... on MirrorValue { display_value }
            ... on FormulaValue { display_value }
            ... on DependencyValue { display_value linked_item_ids }
            ... on StatusValue { label index }
            ... on PeopleValue { persons_and_teams { id kind } }
            ... on TimelineValue { from to visualization_type }
            ... on DateValue { date time }`
    : "";
  return `query ($ids: [ID!], $limit: Int!, $cursor: String) { ${COMPLEXITY_FIELD}
    boards (ids: $ids) {
      items_page (limit: $limit, cursor: $cursor) {
        cursor
        items {
          id name state created_at updated_at url email
          group { id title }
          creator { id name email }
          parent_item { id name }
          subitems { id name }
          ${assets}
          column_values {
            id type text value
            ... on BoardRelationValue { linked_item_ids linked_items { id name board { id name } } }${richFragments}
          }
        }
      }
    } }`;
}

const Q_UPDATES = [
  `query ($ids: [ID!], $limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    items (ids: $ids) {
      id
      updates (limit: $limit, page: $page) {
        id body text_body created_at updated_at
        creator { id name email }
        assets { id name file_extension file_size public_url created_at }
        replies { id body text_body created_at updated_at creator { id name email } }
        likes { id reaction_type creator_id created_at }
      }
    } }`,
  `query ($ids: [ID!], $limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    items (ids: $ids) {
      id
      updates (limit: $limit, page: $page) {
        id body text_body created_at updated_at
        creator { id name }
        replies { id body text_body created_at creator { id name } }
      }
    } }`,
  `query ($ids: [ID!], $limit: Int!, $page: Int!) { ${COMPLEXITY_FIELD}
    items (ids: $ids) { id updates (limit: $limit, page: $page) { id body created_at creator { id name } } } }`,
];

// ─── Loose row types (we archive whatever the API returns) ───────────────────

type Row = Record<string, unknown>;

interface BoardMeta extends Row {
  id: string;
  name: string;
  workspace?: { id: string; name: string } | null;
  columns?: Row[];
  groups?: Row[];
}

interface Item extends Row {
  id: string;
  name: string;
  column_values?: Row[];
  assets?: Row[];
}

// ─── Account-level pulls ────────────────────────────────────────────────────

async function backupAccount(outDir: string): Promise<void> {
  log("Account: me / users / teams / workspaces");

  const me = await gqlOnce<{ me: Row }>(Q_ME, {});
  writeJson(path.join(outDir, "account", "me.json"), me.me);
  const acct = me.me.account as Row | undefined;
  log(`  account: ${acct?.name ?? "?"} (tier ${acct?.tier ?? "?"}) as ${me.me.email ?? "?"}`);

  const users: Row[] = [];
  for (let page = 1; ; page += 1) {
    const d = await gqlFallback<{ users: Row[] }>(Q_USERS, { limit: 200, page }, "users");
    const batch = d.users ?? [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  writeJson(path.join(outDir, "account", "users.json"), users);
  log(`  users: ${users.length}`);

  const teams = await gqlFallback<{ teams: Row[] }>(Q_TEAMS, {}, "teams");
  writeJson(path.join(outDir, "account", "teams.json"), teams.teams ?? []);
  log(`  teams: ${(teams.teams ?? []).length}`);

  const workspaces: Row[] = [];
  for (let page = 1; ; page += 1) {
    const d = await gqlFallback<{ workspaces: Row[] }>(Q_WORKSPACES, { limit: 100, page }, "workspaces");
    const batch = d.workspaces ?? [];
    workspaces.push(...batch);
    if (batch.length < 100) break;
  }
  writeJson(path.join(outDir, "account", "workspaces.json"), workspaces);
  log(`  workspaces: ${workspaces.length}`);
}

async function backupInventory(outDir: string): Promise<Row[]> {
  log("Inventory: every board visible to this token");
  const boards: Row[] = [];
  for (let page = 1; ; page += 1) {
    const d = await gqlFallback<{ boards: Row[] }>(Q_BOARD_INVENTORY, { limit: 100, page }, "board inventory");
    const batch = d.boards ?? [];
    boards.push(...batch);
    log(`  page ${page}: +${batch.length} (total ${boards.length})`);
    if (batch.length < 100) break;
    if (page > 60) {
      log("  ! stopping inventory at page 60 as a safety valve");
      break;
    }
  }

  writeJson(path.join(outDir, "inventory", "boards.json"), boards);

  const header = ["board_id", "board_name", "workspace_id", "workspace_name", "items_count", "state", "board_kind", "type"];
  const lines = [header.join(",")];
  for (const b of boards) {
    const ws = (b.workspace ?? null) as Row | null;
    lines.push(
      [b.id, b.name, ws?.id ?? "", ws?.name ?? "", b.items_count ?? "", b.state ?? "", b.board_kind ?? "", b.type ?? ""]
        .map(csvCell)
        .join(","),
    );
  }
  fs.writeFileSync(path.join(outDir, "inventory", "boards.csv"), `${lines.join("\n")}\n`, "utf8");

  const items = boards.reduce((n, b) => n + (Number(b.items_count) || 0), 0);
  log(`  ${boards.length} boards, ${items.toLocaleString("en-US")} items reported by Monday`);
  return boards;
}

// ─── Per-board export ───────────────────────────────────────────────────────

async function fetchBoardMeta(boardId: string): Promise<BoardMeta | null> {
  const d = await gqlFallback<{ boards: BoardMeta[] }>(Q_BOARD_META, { ids: [boardId] }, `board ${boardId} meta`);
  return d.boards?.[0] ?? null;
}

async function fetchAllItems(boardId: string, opts: Options): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  let rich = true;
  let pageSize = Math.max(1, Math.min(opts.itemPageSize, 100));

  for (let page = 1; ; page += 1) {
    let d: { boards: Array<{ items_page: { cursor: string | null; items: Item[] } }> };
    try {
      d = await gqlOnce(itemsPageQuery({ assets: opts.includeAssets, rich }), {
        ids: [boardId],
        limit: pageSize,
        cursor,
      });
    } catch (err) {
      if (err instanceof FieldError && rich) {
        log(`  board ${boardId}: dropping optional column fragments and retrying`);
        rich = false;
        page -= 1;
        continue;
      }
      if (/complexity|too large|timeout/i.test((err as Error).message) && pageSize > 10) {
        pageSize = Math.max(10, Math.floor(pageSize / 2));
        log(`  board ${boardId}: reducing page size to ${pageSize} and retrying`);
        page -= 1;
        continue;
      }
      throw err;
    }

    const ip = d.boards?.[0]?.items_page;
    if (!ip) break;
    items.push(...(ip.items ?? []));
    cursor = ip.cursor ?? null;
    if (page === 1 || page % 5 === 0 || !cursor) {
      log(`  board ${boardId}: ${items.length} items${cursor ? " (more)" : ""}`);
    }
    if (!cursor) break;
    if (page > 500) {
      log(`  ! board ${boardId}: stopping item pagination at page 500`);
      break;
    }
  }
  return items;
}

async function fetchUpdates(itemIds: string[]): Promise<Map<string, Row[]>> {
  const byItem = new Map<string, Row[]>();
  const CHUNK = 25;
  const PAGE = 100;

  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const chunk = itemIds.slice(i, i + CHUNK);
    for (let page = 1; ; page += 1) {
      const d = await gqlFallback<{ items: Array<{ id: string; updates: Row[] }> }>(
        Q_UPDATES,
        { ids: chunk, limit: PAGE, page },
        "updates",
      );
      let full = false;
      for (const it of d.items ?? []) {
        const ups = it.updates ?? [];
        if (ups.length) {
          byItem.set(it.id, [...(byItem.get(it.id) ?? []), ...ups]);
        }
        if (ups.length === PAGE) full = true;
      }
      if (!full) break;
      if (page > 20) break;
    }
  }
  return byItem;
}

function writeBoardCsv(file: string, meta: BoardMeta, items: Item[]): void {
  const cols = (meta.columns ?? []) as Array<{ id: string; title: string }>;
  const header = ["item_id", "item_name", "group", "state", "created_at", "updated_at", ...cols.map((c) => c.title)];
  const lines = [header.map(csvCell).join(",")];

  for (const it of items) {
    const cvById = new Map<string, Row>();
    for (const cv of (it.column_values ?? []) as Row[]) cvById.set(String(cv.id), cv);
    const group = (it.group ?? null) as Row | null;
    const row: unknown[] = [it.id, it.name, group?.title ?? "", it.state ?? "", it.created_at ?? "", it.updated_at ?? ""];
    for (const c of cols) {
      const cv = cvById.get(c.id);
      const linked = cv?.linked_item_ids as string[] | undefined;
      row.push(cv?.text ?? cv?.display_value ?? (linked?.length ? linked.join(" | ") : ""));
    }
    lines.push(row.map(csvCell).join(","));
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

async function backupBoard(
  boardId: string,
  outDir: string,
  manifest: Manifest,
  opts: Options,
): Promise<void> {
  const entry: BoardEntry = manifest.boards[boardId] ?? { board_id: boardId, status: "pending" };
  manifest.boards[boardId] = entry;

  try {
    const meta = await fetchBoardMeta(boardId);
    if (!meta) {
      entry.status = "error";
      entry.error = "board not found or not visible to this token";
      log(`  board ${boardId}: NOT FOUND`);
      return;
    }
    entry.board_name = meta.name;
    entry.workspace_id = (meta.workspace as Row | null)?.id as string | null;
    entry.workspace_name = (meta.workspace as Row | null)?.name as string | null;

    log(`Board ${boardId} — ${meta.name} (${entry.workspace_name ?? "no workspace"})`);

    const items = await fetchAllItems(boardId, opts);

    let updateCount = 0;
    if (opts.includeUpdates && items.length) {
      const updates = await fetchUpdates(items.map((i) => i.id));
      for (const it of items) {
        const ups = updates.get(it.id);
        if (ups?.length) {
          it.updates = ups;
          updateCount += ups.length;
        }
      }
      log(`  board ${boardId}: ${updateCount} updates`);
    }

    const assetCount = items.reduce((n, i) => n + ((i.assets as Row[] | undefined)?.length ?? 0), 0);

    const file = path.join("boards", `board-${boardId}.json`);
    writeJson(path.join(outDir, file), {
      exported_at: new Date().toISOString(),
      api_version: API_VERSION,
      scope: { file_binaries: false, activity_logs: false, updates: opts.includeUpdates },
      board: meta,
      item_count: items.length,
      update_count: updateCount,
      asset_count: assetCount,
      items,
    });

    if (opts.csv) {
      writeBoardCsv(path.join(outDir, "boards", `board-${boardId}.csv`), meta, items);
    }

    entry.status = "done";
    entry.item_count = items.length;
    entry.update_count = updateCount;
    entry.asset_count = assetCount;
    entry.file = file;
    entry.finished_at = new Date().toISOString();
    delete entry.error;

    manifest.totals.boards_done += 1;
    manifest.totals.items += items.length;
    manifest.totals.updates += updateCount;
    manifest.totals.assets += assetCount;
  } catch (err) {
    entry.status = "error";
    entry.error = (err as Error).message.slice(0, 500);
    log(`  board ${boardId}: ERROR ${entry.error}`);
  } finally {
    saveManifest(outDir, manifest);
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────

function writeSummary(outDir: string, manifest: Manifest, inventory: Row[] | null): void {
  const entries = Object.values(manifest.boards);
  const done = entries.filter((e) => e.status === "done");
  const errored = entries.filter((e) => e.status === "error");
  const n = (v: number) => v.toLocaleString("en-US");

  const byWorkspace = new Map<string, { boards: number; items: number; updates: number }>();
  for (const e of done) {
    const key = `${e.workspace_name ?? "(none)"} (${e.workspace_id ?? "-"})`;
    const agg = byWorkspace.get(key) ?? { boards: 0, items: 0, updates: 0 };
    agg.boards += 1;
    agg.items += e.item_count ?? 0;
    agg.updates += e.update_count ?? 0;
    byWorkspace.set(key, agg);
  }

  const lines: string[] = [];
  lines.push(`# Monday backup — ${path.basename(outDir)}`);
  lines.push("");
  lines.push(`Generated by \`scripts/monday-full-backup.ts\` (API ${manifest.api_version}).`);
  lines.push(`First run ${manifest.started_at}, latest run ${manifest.last_run_at}, ${manifest.runs.length} run(s).`);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`- Boards exported: ${n(done.length)}${inventory ? ` of ${n(inventory.length)} visible` : ""}`);
  lines.push(`- Items: ${n(manifest.totals.items)}`);
  lines.push(`- Updates: ${n(manifest.totals.updates)}`);
  lines.push(`- Asset records (metadata only): ${n(manifest.totals.assets)}`);
  lines.push(`- Boards with errors: ${n(errored.length)}`);
  lines.push("");
  lines.push("## Not captured, by design");
  lines.push("");
  lines.push("- File binaries. Asset metadata is recorded, but `public_url` values are short-lived signed URLs and will expire.");
  lines.push("- Board `activity_logs` (the who-changed-what audit trail).");
  lines.push("");
  lines.push("## By workspace");
  lines.push("");
  lines.push("| Workspace | Boards | Items | Updates |");
  lines.push("| --- | --- | --- | --- |");
  for (const [ws, agg] of [...byWorkspace.entries()].sort((a, b) => b[1].items - a[1].items)) {
    lines.push(`| ${ws} | ${n(agg.boards)} | ${n(agg.items)} | ${n(agg.updates)} |`);
  }
  lines.push("");
  if (errored.length) {
    lines.push("## Errors — re-run with `--resume` to retry these");
    lines.push("");
    for (const e of errored) lines.push(`- \`${e.board_id}\` ${e.board_name ?? ""}: ${e.error}`);
    lines.push("");
  }
  lines.push("## API cost");
  lines.push("");
  lines.push(`- Requests: ${n(stats.requests)} (retries ${n(stats.retries)})`);
  lines.push(`- Complexity spent: ${n(stats.complexitySpent)}`);
  lines.push(`- Throttle pauses: ${n(stats.throttleWaits)} totalling ${n(Math.round(stats.throttleSeconds))}s`);
  lines.push("");
  lines.push("Real customer data. Gitignored. Do not commit.");

  fs.writeFileSync(path.join(outDir, "SUMMARY.md"), `${lines.join("\n")}\n`, "utf8");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.outDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(opts.outDir, "_run.log"), { flags: "a" });

  log("=".repeat(72));
  log(`Monday full backup — phase "${opts.phase}" -> ${opts.outDir}`);
  log(
    `updates=${opts.includeUpdates} assets=${opts.includeAssets} subitem-boards=${opts.includeSubitemBoards} ` +
      `page-size=${opts.itemPageSize} csv=${opts.csv} resume=${opts.resume}`,
  );

  if (!process.env.MONDAY_API_TOKEN?.trim()) {
    log("! MONDAY_API_TOKEN is not set. Add it to .env.local and re-run.");
    process.exitCode = 1;
    return;
  }

  const manifest = loadManifest(opts.outDir, opts);

  if (opts.dryRun) {
    log("");
    log("DRY RUN — no API calls will be made.");
    log(`Phase core would export ${CORE_BOARD_IDS.length} named boards plus every board in workspaces ${CORE_WORKSPACE_IDS.join(", ")}.`);
    log(`Phase rest would export every other board found in the inventory.`);
    log(`Explicit --boards: ${opts.onlyBoards?.join(", ") ?? "(none)"}`);
    log(`Already done in this manifest: ${Object.values(manifest.boards).filter((b) => b.status === "done").length}`);
    log("");
    log("Files that would be written:");
    log("  account/{me,users,teams,workspaces}.json");
    log("  inventory/boards.{json,csv}");
    log("  boards/board-<id>.json  (+ .csv sidecar unless --no-csv)");
    log("  _manifest.json, _run.log, SUMMARY.md");
    saveManifest(opts.outDir, manifest);
    return;
  }

  let inventory: Row[] | null = null;
  let targets: string[];

  if (opts.onlyBoards) {
    targets = opts.onlyBoards;
    log(`Explicit board list: ${targets.length} board(s)`);
  } else {
    await backupAccount(opts.outDir);
    inventory = await backupInventory(opts.outDir);

    const inWs = (b: Row) => CORE_WORKSPACE_IDS.includes(String((b.workspace as Row | null)?.id ?? ""));
    const coreIds = new Set<string>(CORE_BOARD_IDS);
    for (const b of inventory) if (inWs(b)) coreIds.add(String(b.id));

    const isSubitemBoard = (b: Row) =>
      String(b.type ?? "") === "sub_items_board" || /^subitems of /i.test(String(b.name ?? ""));

    let pool: Row[];
    if (opts.phase === "core") {
      pool = inventory.filter((b) => coreIds.has(String(b.id)));
      // Named core boards may sit outside the inventory page window; keep them.
      const seen = new Set(pool.map((b) => String(b.id)));
      for (const id of CORE_BOARD_IDS) if (!seen.has(id)) pool.push({ id });
    } else if (opts.phase === "rest") {
      pool = inventory.filter((b) => !coreIds.has(String(b.id)));
    } else {
      pool = inventory;
    }

    if (!opts.includeSubitemBoards) {
      const before = pool.length;
      pool = pool.filter((b) => !isSubitemBoard(b));
      log(`  skipping ${before - pool.length} "Subitems of ..." boards`);
    }

    // Cheap boards first so a truncated run still yields breadth.
    pool.sort((a, b) => (Number(a.items_count) || 0) - (Number(b.items_count) || 0));
    targets = pool.map((b) => String(b.id));
  }

  if (opts.resume) {
    const before = targets.length;
    targets = targets.filter((id) => manifest.boards[id]?.status !== "done");
    log(`Resume: skipping ${before - targets.length} board(s) already done`);
  }
  if (opts.maxBoards) targets = targets.slice(0, opts.maxBoards);

  log(`Exporting ${targets.length} board(s)`);
  log("-".repeat(72));

  for (let i = 0; i < targets.length; i += 1) {
    log(`[${i + 1}/${targets.length}]`);
    await backupBoard(targets[i], opts.outDir, manifest, opts);
  }

  saveManifest(opts.outDir, manifest);
  writeSummary(opts.outDir, manifest, inventory);

  const done = Object.values(manifest.boards).filter((b) => b.status === "done").length;
  const errs = Object.values(manifest.boards).filter((b) => b.status === "error");
  log("-".repeat(72));
  log(
    `Done. ${done} boards, ${manifest.totals.items.toLocaleString("en-US")} items, ` +
      `${manifest.totals.updates.toLocaleString("en-US")} updates, ${errs.length} errors.`,
  );
  log(`Requests ${stats.requests}, retries ${stats.retries}, complexity ${stats.complexitySpent.toLocaleString("en-US")}.`);
  log(`Summary: ${path.join(opts.outDir, "SUMMARY.md")}`);
  if (errs.length) log(`Retry failures with: npx tsx scripts/monday-full-backup.ts --out ${path.basename(opts.outDir)} --resume --phase ${opts.phase}`);
}

main()
  .then(() => logStream?.end())
  .catch((err) => {
    log(`FATAL: ${(err as Error).stack ?? String(err)}`);
    logStream?.end();
    process.exitCode = 1;
  });
