// Open Tickets report — data loader (mirrors lib/reports/weekly-loader.ts).
//
// Reads linear_tickets + team_asks/team_ask_tickets, which are kept fresh by
// lib/sync/linear-tickets.ts (raw fields) and a periodic Claude-assisted
// classification pass (judgment fields). This loader does no classification
// itself — it only aggregates what's already in the table.

import { requireAdmin } from "@/lib/supabase/server";
import type {
  TicketRow,
  TeamAsk,
  TicketClassification,
  TicketDomain,
  AskPriorityTier,
} from "./types";

const CLASSIFICATIONS: TicketClassification[] = [
  "hard_blocker",
  "workaround_exists",
  "transient_retry",
  "just_a_bug",
];

const DOMAINS: TicketDomain[] = [
  "idp_document_processing",
  "browser_automation",
  "integrations_connectors",
  "drafts_quill_ux",
  "live_automations_runtime",
  "platform_infra",
  "other",
];

export interface ClassificationCount {
  classification: TicketClassification | "unclassified";
  count: number;
}

export interface DomainGroup {
  domain: TicketDomain | "unclassified";
  total: number;
  hard_blocker: number;
  tickets: TicketRow[];
}

export interface TicketsDelta {
  /** Rolling window used for the delta — mirrors the weekly report's
   *  default "last 7 days" window (lib/reports/weekly-loader.ts). */
  since: string;
  new_count: number;
  new_hard_blocker: number;
  new_just_a_bug: number;
  new_other: number;
  newly_closed: number;
}

export interface TicketsBundle {
  generated_at: string;
  last_synced_at: string | null;
  /** Whether out-of-scope tickets (in_scope = false) were included. */
  in_scope_only: boolean;
  /** Set when the underlying tables couldn't be read (e.g. migrations
   *  0017/0018 not yet applied) — the report renders with empty data
   *  instead of failing, so the UI surfaces this instead of silently
   *  showing "no tickets". */
  data_error: string | null;

  open_tickets: TicketRow[];
  closed_tickets: TicketRow[];
  classification_breakdown: ClassificationCount[];
  domain_groups: DomainGroup[];
  delta: TicketsDelta;
  team_asks: {
    now: TeamAsk[];
    soon: TeamAsk[];
    later: TeamAsk[];
  };
  totals: {
    open: number;
    closed: number;
    unclassified_open: number;
    out_of_scope: number;
  };
}

export async function loadTicketsBundle(opts: { inScopeOnly?: boolean } = {}): Promise<TicketsBundle> {
  const inScopeOnly = opts.inScopeOnly ?? true;
  const sb = requireAdmin();
  const now = new Date();

  const [ticketsRes, asksRes, linksRes, lastSyncRes] = await Promise.all([
    sb.from("linear_tickets").select("*"),
    sb.from("team_asks").select("*").order("created_at", { ascending: false }),
    sb.from("team_ask_tickets").select("ask_id, ticket_id"),
    sb
      .from("sync_runs")
      .select("finished_at")
      .eq("source", "linear-tickets")
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Surface read failures instead of quietly rendering an empty report —
  // the most common cause is migrations 0017/0018 not yet applied.
  const firstError = ticketsRes.error ?? asksRes.error ?? linksRes.error ?? null;
  const data_error = firstError
    ? `${firstError.message} — have migrations 0017_linear_tickets.sql and 0018_linear_tickets_seed.sql been applied to this Supabase project?`
    : null;

  const allTickets = (ticketsRes.data as TicketRow[] | null) ?? [];
  const ticketsById = new Map(allTickets.map((t) => [t.id, t]));

  const scoped = inScopeOnly ? allTickets.filter((t) => t.in_scope) : allTickets;
  const outOfScopeCount = allTickets.length - allTickets.filter((t) => t.in_scope).length;

  const openTickets = scoped
    .filter((t) => t.closed_at === null)
    .sort((a, b) => (a.linear_created_at < b.linear_created_at ? 1 : -1));
  const closedTickets = scoped
    .filter((t) => t.closed_at !== null)
    .sort((a, b) => ((a.closed_at ?? "") < (b.closed_at ?? "") ? 1 : -1));

  // ── Classification breakdown (open tickets only — closed noise isn't
  // actionable) ─────────────────────────────────────────────────────────────
  const classification_breakdown: ClassificationCount[] = [
    ...CLASSIFICATIONS.map((c) => ({
      classification: c,
      count: openTickets.filter((t) => t.classification === c).length,
    })),
    { classification: "unclassified" as const, count: openTickets.filter((t) => t.classification === null).length },
  ];

  // ── Domain groups (open tickets only) ─────────────────────────────────────
  const domain_groups: DomainGroup[] = [
    ...DOMAINS.map((d) => {
      const tickets = openTickets.filter((t) => t.domain === d);
      return {
        domain: d,
        total: tickets.length,
        hard_blocker: tickets.filter((t) => t.classification === "hard_blocker").length,
        tickets,
      };
    }),
    (() => {
      const tickets = openTickets.filter((t) => t.domain === null);
      return {
        domain: "unclassified" as const,
        total: tickets.length,
        hard_blocker: 0,
        tickets,
      };
    })(),
  ].filter((g) => g.total > 0);

  // ── Delta — rolling 7 days, same window convention as the weekly report ──
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 7);
  const sinceIso = since.toISOString();

  const newTickets = scoped.filter((t) => t.linear_created_at >= sinceIso);
  const newlyClosed = scoped.filter((t) => t.closed_at !== null && t.closed_at >= sinceIso);

  const delta: TicketsDelta = {
    since: sinceIso,
    new_count: newTickets.length,
    new_hard_blocker: newTickets.filter((t) => t.classification === "hard_blocker").length,
    new_just_a_bug: newTickets.filter((t) => t.classification === "just_a_bug").length,
    new_other: newTickets.filter(
      (t) => t.classification !== "hard_blocker" && t.classification !== "just_a_bug"
    ).length,
    newly_closed: newlyClosed.length,
  };

  // ── Team asks, resolved with linked ticket titles ─────────────────────────
  const linksByAsk = new Map<string, string[]>();
  for (const link of (linksRes.data as Array<{ ask_id: string; ticket_id: string }> | null) ?? []) {
    const arr = linksByAsk.get(link.ask_id) ?? [];
    arr.push(link.ticket_id);
    linksByAsk.set(link.ask_id, arr);
  }

  type TeamAskRow = Omit<TeamAsk, "tickets">;
  const asks: TeamAsk[] = ((asksRes.data as TeamAskRow[] | null) ?? []).map((a) => {
    const ticketIds = linksByAsk.get(a.id) ?? [];
    const tickets = ticketIds
      .map((id) => ticketsById.get(id))
      .filter((t): t is TicketRow => Boolean(t))
      .map((t) => ({ id: t.id, title: t.title }));
    return { ...a, tickets };
  });

  const tierOrder: AskPriorityTier[] = ["now", "soon", "later"];
  const byTier = (tier: AskPriorityTier) =>
    asks.filter((a) => a.priority_tier === tier && a.status !== "done");
  void tierOrder;

  return {
    generated_at: now.toISOString(),
    last_synced_at: (lastSyncRes.data as { finished_at: string } | null)?.finished_at ?? null,
    in_scope_only: inScopeOnly,
    data_error,
    open_tickets: openTickets,
    closed_tickets: closedTickets,
    classification_breakdown,
    domain_groups,
    delta,
    team_asks: {
      now: byTier("now"),
      soon: byTier("soon"),
      later: byTier("later"),
    },
    totals: {
      open: openTickets.length,
      closed: closedTickets.length,
      unclassified_open: openTickets.filter((t) => t.classification === null).length,
      out_of_scope: outOfScopeCount,
    },
  };
}
