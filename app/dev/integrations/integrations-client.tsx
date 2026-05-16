"use client";

import { useState } from "react";

interface Props {
  salesforceLive: boolean;
  mondayLive: boolean;
  kognitosLive: boolean;
}

export function IntegrationsClient({ salesforceLive, mondayLive, kognitosLive }: Props) {
  return (
    <div className="space-y-8">
      <MondaySection live={mondayLive} />
      <SalesforceSection live={salesforceLive} />
      <KognitosV2Section live={kognitosLive} />
      <KognitosV1Placeholder />
      <SlackHistoryPlaceholder />
    </div>
  );
}

// ─── Monday ────────────────────────────────────────────────────────────────

interface MondayBoardsResponse {
  boards: Array<{
    id: string;
    name: string;
    description: string | null;
    state: string;
    items_count: number | null;
    workspace?: { id: string; name: string } | null;
    owners?: Array<{ id: string; name: string }>;
    updated_at: string;
  }>;
  workspaces: Array<{ id: string; name: string; kind?: string; description?: string | null }>;
  summary: {
    boards_count: number;
    workspaces_count: number;
    biggest_board: { name: string; items_count: number | null } | null;
  };
}

interface MondayBoardDetail {
  board: MondayBoardsResponse["boards"][number];
  items: Array<{
    id: string;
    name: string;
    state: string;
    group: { id: string; title: string };
    creator: { id: string; name: string } | null;
    updated_at: string;
    column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>;
  }>;
  count: number;
}

function MondaySection({ live }: { live: boolean }) {
  const [data, setData] = useState<MondayBoardsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBoard, setOpenBoard] = useState<MondayBoardDetail | null>(null);
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);

  async function fetchBoards() {
    setBusy(true);
    setError(null);
    setOpenBoard(null);
    try {
      const res = await fetch("/api/dev/probe/monday/boards?limit=50");
      const json = (await res.json()) as MondayBoardsResponse | { error: string };
      if (!res.ok) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      setData(json as MondayBoardsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function fetchBoard(id: string) {
    setOpenBoardId(id);
    setOpenBoard(null);
    try {
      const res = await fetch(`/api/dev/probe/monday/board/${id}?limit=50`);
      const json = (await res.json()) as MondayBoardDetail | { error: string };
      if (!res.ok) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      setOpenBoard(json as MondayBoardDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Section
      title="Monday — customer roster source"
      subtitle="The canonical list of customers comes from here. Everything else is enrichment."
      live={live}
    >
      {!live ? (
        <NotLiveHint env="MONDAY_API_TOKEN" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Button onClick={fetchBoards} busy={busy} primary>
              {data ? "Refresh boards" : "List boards + workspaces"}
            </Button>
            {data ? (
              <span className="text-xs text-[color:var(--brand-gray)]">
                {data.summary.boards_count} boards · {data.summary.workspaces_count} workspaces
                {data.summary.biggest_board
                  ? ` · biggest: "${data.summary.biggest_board.name}" (${data.summary.biggest_board.items_count} items)`
                  : ""}
              </span>
            ) : null}
          </div>

          {error ? <ErrorBlock message={error} /> : null}

          {data ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                  Workspaces ({data.workspaces.length})
                </h4>
                {data.workspaces.length === 0 ? (
                  <Empty text="No workspaces visible to this token (free tier may not expose them)." />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.workspaces.map((w) => (
                      <li
                        key={w.id}
                        className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2"
                      >
                        <div className="font-medium">{w.name}</div>
                        <div className="text-xs text-[color:var(--brand-gray)]">
                          id {w.id} · {w.kind ?? "?"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                  Boards ({data.boards.length})
                </h4>
                <p className="text-xs text-[color:var(--brand-gray)] mb-2">
                  Click a board to load its items. Look for one named &ldquo;Customers&rdquo; / &ldquo;Live
                  Accounts&rdquo; / similar — that&rsquo;s the customer roster.
                </p>
                <ul className="space-y-1 text-sm">
                  {data.boards.map((b) => (
                    <li key={b.id}>
                      <button
                        onClick={() => fetchBoard(b.id)}
                        className={`w-full text-left rounded-md border p-2 transition-colors ${
                          openBoardId === b.id
                            ? "border-[color:var(--brand-night)] bg-[color:var(--brand-yellow)]/30"
                            : "border-[color:var(--brand-metal)] bg-white hover:border-[color:var(--brand-night)]"
                        }`}
                      >
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-[color:var(--brand-gray)]">
                          {b.items_count ?? "?"} items
                          {b.workspace ? ` · ${b.workspace.name}` : ""} · id {b.id}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {openBoardId ? (
            <div className="mt-6 rounded-md border border-[color:var(--brand-night)] bg-[color:var(--brand-seasalt)] p-4">
              <h4 className="font-medium mb-2">
                Board {openBoardId}
                {openBoard ? ` — ${openBoard.board.name}` : "…"}
              </h4>
              {!openBoard ? (
                <div className="text-xs text-[color:var(--brand-gray)]">Loading…</div>
              ) : openBoard.items.length === 0 ? (
                <Empty text="Board has no items." />
              ) : (
                <>
                  <p className="text-xs text-[color:var(--brand-gray)] mb-3">
                    First {openBoard.count} items. The first column is usually the row name; the rest
                    are status/owner/dates per the board&rsquo;s schema.
                  </p>
                  <ul className="space-y-1 text-sm">
                    {openBoard.items.slice(0, 25).map((it) => (
                      <li
                        key={it.id}
                        className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2"
                      >
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-[color:var(--brand-gray)]">
                          group {it.group.title}
                          {it.creator ? ` · creator ${it.creator.name}` : ""}
                          {" · "}id {it.id}
                        </div>
                        {it.column_values.some((c) => c.text) ? (
                          <details className="mt-1">
                            <summary className="text-xs cursor-pointer text-[color:var(--brand-gray)]">
                              column values
                            </summary>
                            <ul className="mt-1 text-xs space-y-0.5">
                              {it.column_values
                                .filter((c) => c.text)
                                .map((c) => (
                                  <li key={c.id}>
                                    <span className="text-[color:var(--brand-gray)]">{c.id}</span>
                                    {": "}
                                    {c.text}
                                  </li>
                                ))}
                            </ul>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {openBoard.items.length > 25 ? (
                    <div className="text-xs text-[color:var(--brand-gray)] mt-2">
                      … {openBoard.items.length - 25} more not shown.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

// ─── Salesforce ────────────────────────────────────────────────────────────

interface SfAccount {
  Id: string;
  Name: string;
  Industry: string | null;
  AnnualRevenue: number | null;
  NumberOfEmployees: number | null;
  Type: string | null;
  Website: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Owner: { Name: string } | null;
  LastModifiedDate: string;
}

function SalesforceSection({ live }: { live: boolean }) {
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<SfAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchAccounts(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = new URL("/api/dev/probe/salesforce/accounts", window.location.origin);
      url.searchParams.set("limit", "25");
      if (search) url.searchParams.set("search", search);
      const res = await fetch(url);
      const json = (await res.json()) as { accounts: SfAccount[] } | { error: string };
      if (!res.ok) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      setAccounts((json as { accounts: SfAccount[] }).accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Salesforce — contract enrichment"
      subtitle="78k+ accounts in your org including prospects. Used as a lookup, not a roster source. Search by name prefix."
      live={live}
    >
      {!live ? (
        <NotLiveHint env="SALESFORCE_CLIENT_ID + _CLIENT_SECRET + _INSTANCE_URL" />
      ) : (
        <>
          <form onSubmit={fetchAccounts} className="flex flex-wrap items-center gap-2 mb-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Account name prefix (e.g. 'Acme')"
              className="rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-1.5 text-sm flex-1 min-w-[200px]"
            />
            <Button busy={busy} primary>
              Search accounts
            </Button>
          </form>

          {error ? <ErrorBlock message={error} /> : null}

          {accounts ? (
            <div>
              <div className="text-xs text-[color:var(--brand-gray)] mb-2">
                {accounts.length} result{accounts.length === 1 ? "" : "s"}
                {search ? ` for "${search}"` : " (most recently modified, no filter)"}
              </div>
              {accounts.length === 0 ? (
                <Empty text="No accounts matched. Try a different prefix." />
              ) : (
                <ul className="space-y-1 text-sm">
                  {accounts.map((a) => (
                    <li
                      key={a.Id}
                      className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2"
                    >
                      <div className="font-medium">{a.Name}</div>
                      <div className="text-xs text-[color:var(--brand-gray)]">
                        {[
                          a.Industry,
                          a.Type,
                          a.NumberOfEmployees ? `${a.NumberOfEmployees.toLocaleString()} emp` : null,
                          a.AnnualRevenue
                            ? `$${(a.AnnualRevenue / 1_000_000).toFixed(1)}M ARR`
                            : null,
                          a.BillingCountry,
                          a.Owner?.Name ? `owner ${a.Owner.Name}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="text-xs text-[color:var(--brand-gray)] mt-0.5 font-mono">
                        {a.Id}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

// ─── Kognitos v2 ───────────────────────────────────────────────────────────

interface K2Workspace {
  workspace: { id?: string; display_name?: string; name?: string; raw: Record<string, unknown> };
  processes: Array<{ id: string; display_name: string | null; name: string | null; state: string | null }>;
  processes_count: number;
}

function KognitosV2Section({ live }: { live: boolean }) {
  const [data, setData] = useState<K2Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/probe/kognitos/workspace?limit=20");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Kognitos v2 — newer automations"
      subtitle="Limited dataset today (v2 is recent). Most historical data lives in v1, see the placeholder below."
      live={live}
    >
      {!live ? (
        <NotLiveHint env="KOGNITOS_V2_TOKEN + _BASE_URL + _ORG_ID + _WORKSPACE_ID" />
      ) : (
        <>
          <Button onClick={fetchWorkspace} busy={busy} primary>
            {data ? "Refresh workspace" : "Load workspace + processes"}
          </Button>

          {error ? <ErrorBlock message={error} /> : null}

          {data ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm">
                <div className="font-medium">
                  {data.workspace.display_name ?? data.workspace.name ?? "(unnamed workspace)"}
                </div>
                <div className="text-xs text-[color:var(--brand-gray)]">
                  id {data.workspace.id ?? "?"}
                </div>
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
                  Processes in this workspace ({data.processes_count})
                </h4>
                {data.processes.length === 0 ? (
                  <Empty text="No processes returned (this is expected if v2 is new in your org)." />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.processes.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-md border border-[color:var(--brand-metal)] bg-white p-2"
                      >
                        <div className="font-medium">
                          {p.display_name ?? p.name ?? "(unnamed)"}
                        </div>
                        <div className="text-xs text-[color:var(--brand-gray)]">
                          state {p.state ?? "?"} · id {p.id}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

// ─── Kognitos v1 placeholder ────────────────────────────────────────────────

function KognitosV1Placeholder() {
  return (
    <Section
      title="Kognitos v1 — historical consumption (90%+ of customer data)"
      subtitle="Phase 2.5 — needs a per-customer department/workspace ID before we can pull anything useful."
      live={false}
    >
      <div className="text-sm space-y-2">
        <p>
          Most customer run history, credit usage, and exception data lives in v1. To pull it, every
          DeliveryOps customer needs a <code>kognitos_v1_department_id</code> +{" "}
          <code>kognitos_v1_workspace_id</code> mapped on the <code>customers</code> table.
        </p>
        <p className="text-[color:var(--brand-gray)]">
          The v1 client + per-customer probe will land alongside the customer-import flow once we
          know the structure of your Monday roster (see the Monday section above).
        </p>
      </div>
    </Section>
  );
}

// ─── Slack history placeholder ──────────────────────────────────────────────

function SlackHistoryPlaceholder() {
  return (
    <Section
      title="Slack channel history — bulk import"
      subtitle="Phase 2.5 — pulls every historical message + file out of each customer's Slack channel and indexes it."
      live={false}
    >
      <div className="text-sm space-y-2">
        <p>
          Real-time Slack already works (the agent answers messages in customer channels). The bulk
          historical scrape per channel — to seed the customer&rsquo;s knowledge base with everything
          said before DeliveryOps was watching — lands as a separate background job once
          customer-import is in.
        </p>
        <p className="text-[color:var(--brand-gray)]">
          Each customer&rsquo;s <code>slack_channel</code> is already a column on the customers table, so
          the historical scrape just needs to read that and run <code>conversations.history</code> +{" "}
          <code>files.list</code> against it.
        </p>
      </div>
    </Section>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  live,
  children,
}: {
  title: string;
  subtitle: string;
  live: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[color:var(--brand-metal)] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="font-medium">{title}</h3>
        <span
          className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-wider ${
            live ? "text-[color:var(--brand-night)]" : "text-[color:var(--brand-gray)]"
          }`}
        >
          <span
            className={`size-2 rounded-full ${
              live ? "bg-[color:var(--brand-yellow)]" : "bg-[color:var(--brand-metal)]"
            }`}
          />
          {live ? "live" : "not yet"}
        </span>
      </div>
      <p className="text-xs text-[color:var(--brand-gray)] mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

function Button({
  onClick,
  busy,
  primary,
  children,
}: {
  onClick?: () => void;
  busy?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const baseClasses = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
  const variant = primary
    ? "bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] hover:opacity-90"
    : "border border-[color:var(--brand-metal)] hover:border-[color:var(--brand-night)]";
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={busy}
      className={`${baseClasses} ${variant}`}
    >
      {busy ? "…" : children}
    </button>
  );
}

function NotLiveHint({ env }: { env: string }) {
  return (
    <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-[color:var(--brand-seasalt)] p-3 text-sm text-[color:var(--brand-gray)]">
      Set <code>{env}</code> in <code>.env.local</code> to enable.
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 mt-2">
      <div className="font-medium mb-1">API error</div>
      <pre className="text-xs whitespace-pre-wrap">{message}</pre>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-[color:var(--brand-seasalt)] p-3 text-sm text-[color:var(--brand-gray)]">
      {text}
    </div>
  );
}
