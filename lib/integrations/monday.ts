// Monday.com client — single GraphQL endpoint at api.monday.com/v2.
// Used by the /dev/integrations probe routes today; Phase 2 sync function
// (sync-monday) builds on top of these helpers.

const ENDPOINT = "https://api.monday.com/v2";
const API_VERSION = "2024-04";

export function mondayConfigured(): boolean {
  return Boolean(process.env.MONDAY_API_TOKEN?.trim());
}

function token(): string {
  const t = process.env.MONDAY_API_TOKEN?.trim();
  if (!t) throw new Error("Missing MONDAY_API_TOKEN.");
  return t;
}

interface MondayError {
  message: string;
  extensions?: { code?: string; status_code?: number };
}

interface MondayResponse<T> {
  data?: T;
  errors?: MondayError[];
  error_message?: string;
  error_code?: string;
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: token(),
      "Content-Type": "application/json",
      "API-Version": API_VERSION,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const body = (await res.json()) as MondayResponse<T>;
  if (body.errors?.length) {
    throw new Error(`Monday GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (body.error_message) {
    throw new Error(`Monday error: ${body.error_message} (${body.error_code ?? "?"})`);
  }
  if (!body.data) {
    throw new Error("Monday returned no data.");
  }
  return body.data;
}

// ─── Domain types ────────────────────────────────────────────────────────────

export interface MondayMe {
  id: string;
  name: string;
  email: string;
  account: { id: string; name: string };
}

export interface MondayBoard {
  id: string;
  name: string;
  description: string | null;
  state: string;
  items_count: number | null;
  workspace?: { id: string; name: string } | null;
  owners?: Array<{ id: string; name: string }>;
  updated_at: string;
}

export interface MondayItem {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
  group: { id: string; title: string };
  creator: { id: string; name: string } | null;
  column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>;
}

// ─── Convenience wrappers ───────────────────────────────────────────────────

export async function getMe(): Promise<MondayMe> {
  const data = await gql<{ me: MondayMe }>(`
    query { me { id name email account { id name } } }
  `);
  return data.me;
}

export async function listBoards(opts: { limit?: number } = {}): Promise<MondayBoard[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const data = await gql<{ boards: MondayBoard[] }>(`
    query ($limit: Int!) {
      boards (limit: $limit, order_by: used_at) {
        id
        name
        description
        state
        items_count
        updated_at
        workspace { id name }
        owners { id name }
      }
    }
  `, { limit });
  return data.boards ?? [];
}

export async function getBoard(id: string): Promise<MondayBoard | null> {
  const data = await gql<{ boards: MondayBoard[] }>(`
    query ($ids: [ID!]) {
      boards (ids: $ids) {
        id
        name
        description
        state
        items_count
        updated_at
        workspace { id name }
        owners { id name }
      }
    }
  `, { ids: [id] });
  return data.boards?.[0] ?? null;
}

export async function listBoardItems(boardId: string, opts: { limit?: number } = {}): Promise<MondayItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 500);
  const data = await gql<{ boards: Array<{ items_page: { items: MondayItem[] } }> }>(`
    query ($ids: [ID!], $limit: Int!) {
      boards (ids: $ids) {
        items_page (limit: $limit) {
          items {
            id
            name
            state
            created_at
            updated_at
            group { id title }
            creator { id name }
            column_values { id type text value }
          }
        }
      }
    }
  `, { ids: [boardId], limit });
  return data.boards?.[0]?.items_page?.items ?? [];
}
