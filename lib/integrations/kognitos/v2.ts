// Kognitos v2 client — internal API at app.us-1.kognitos.com.
// Replaces the placeholder credit / runs data we have in profiles today
// with live numbers from the Kognitos automation platform.
//
// Auth: Bearer kgn_pat_… personal access token, scoped to a single org +
// workspace (set via env vars).

const API_VERSION = "/api/v1";

export function kognitosV2Configured(): boolean {
  return Boolean(
    process.env.KOGNITOS_V2_TOKEN?.trim() &&
      process.env.KOGNITOS_V2_BASE_URL?.trim() &&
      process.env.KOGNITOS_V2_ORG_ID?.trim() &&
      process.env.KOGNITOS_V2_WORKSPACE_ID?.trim()
  );
}

interface K2Config {
  token: string;
  baseUrl: string;
  orgId: string;
  workspaceId: string;
}

function config(): K2Config {
  const token = process.env.KOGNITOS_V2_TOKEN?.trim();
  const baseUrl = process.env.KOGNITOS_V2_BASE_URL?.trim();
  const orgId = process.env.KOGNITOS_V2_ORG_ID?.trim();
  const workspaceId = process.env.KOGNITOS_V2_WORKSPACE_ID?.trim();
  if (!token || !baseUrl || !orgId || !workspaceId) {
    throw new Error(
      "Missing Kognitos v2 env vars (KOGNITOS_V2_TOKEN, _BASE_URL, _ORG_ID, _WORKSPACE_ID)."
    );
  }
  return { token, baseUrl: baseUrl.replace(/\/+$/, ""), orgId, workspaceId };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token, baseUrl } = config();
  const url = path.startsWith("http") ? path : `${baseUrl}${API_VERSION}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kognitos v2 ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// Path helpers — pin the org + workspace prefix in one place.
function ws(suffix: string = ""): string {
  const { orgId, workspaceId } = config();
  const base = `/organizations/${orgId}/workspaces/${workspaceId}`;
  if (!suffix) return base;
  return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

// ─── Domain types ────────────────────────────────────────────────────────────

export interface K2Workspace {
  id?: string;
  display_name?: string;
  name?: string;
  description?: string | null;
  state?: string | null;
  raw: Record<string, unknown>;
}

export interface K2Process {
  id: string;
  display_name?: string | null;
  name?: string | null;
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw: Record<string, unknown>;
}

export interface K2Run {
  id: string;
  state?: { completed?: unknown; failed?: unknown; awaiting_guidance?: unknown; running?: unknown } | null;
  process_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  raw: Record<string, unknown>;
}

// ─── Convenience wrappers ───────────────────────────────────────────────────

export async function getCurrentWorkspace(): Promise<K2Workspace> {
  const raw = await request<Record<string, unknown>>(ws(""));
  return {
    id: (raw.id as string) ?? undefined,
    display_name: (raw.display_name as string) ?? undefined,
    name: (raw.name as string) ?? undefined,
    description: (raw.description as string) ?? null,
    state: (raw.state as string) ?? null,
    raw,
  };
}

export async function listProcesses(opts: { limit?: number } = {}): Promise<K2Process[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  // The v2 API uses `pageSize` param. If that doesn't match this region's
  // schema, the wrapper still returns whatever the server gives us.
  const raw = await request<{ processes?: Record<string, unknown>[]; items?: Record<string, unknown>[] }>(
    ws(`/processes?pageSize=${limit}`)
  );
  const items = (raw.processes ?? raw.items ?? []) as Record<string, unknown>[];
  return items.map(toProcess);
}

export async function listRuns(opts: { limit?: number; processId?: string } = {}): Promise<K2Run[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const path = opts.processId
    ? ws(`/processes/${encodeURIComponent(opts.processId)}/runs?pageSize=${limit}`)
    : ws(`/runs?pageSize=${limit}`);
  let raw: { runs?: Record<string, unknown>[]; items?: Record<string, unknown>[] };
  try {
    raw = await request(path);
  } catch (err) {
    // Some Kognitos clusters split the runs endpoint by process. If the
    // workspace-level list isn't there, fall back to per-process and merge.
    if (!opts.processId && err instanceof Error && /404/.test(err.message)) {
      const procs = await listProcesses({ limit: 5 });
      const all: K2Run[] = [];
      for (const p of procs) {
        try {
          all.push(...(await listRuns({ limit, processId: p.id })));
        } catch {
          /* skip processes that fail */
        }
        if (all.length >= limit) break;
      }
      return all.slice(0, limit);
    }
    throw err;
  }
  const items = (raw.runs ?? raw.items ?? []) as Record<string, unknown>[];
  return items.map(toRun);
}

// ─── shape coercion ─────────────────────────────────────────────────────────

function toProcess(raw: Record<string, unknown>): K2Process {
  return {
    id: String(raw.id ?? raw.process_id ?? ""),
    display_name: (raw.display_name as string) ?? null,
    name: (raw.name as string) ?? null,
    state: (raw.state as string) ?? null,
    created_at: (raw.created_at as string) ?? null,
    updated_at: (raw.updated_at as string) ?? null,
    raw,
  };
}

function toRun(raw: Record<string, unknown>): K2Run {
  const state = raw.state as K2Run["state"];
  return {
    id: String(raw.id ?? raw.run_id ?? ""),
    state: state ?? null,
    process_id: (raw.process_id as string) ?? (raw.processId as string) ?? null,
    started_at: (raw.started_at as string) ?? (raw.startedAt as string) ?? null,
    ended_at: (raw.ended_at as string) ?? (raw.endedAt as string) ?? null,
    duration_ms: (raw.duration_ms as number) ?? null,
    raw,
  };
}
