// "This week's blockers" for the All-Hands report. team_asks marked open +
// priority "now"/"soon" are the human-curated showcase layer — if Rishabh
// (or anyone) files one, via the /tickets page or an agent tool, it shows up
// here verbatim. When none exist, falls back to the top open hard-blocker
// Linear tickets so the section is never empty just because nobody filed an
// ask that week (Rishabh, 2026-08-07: "if not then it follows the template
// using live data").

import type { TeamAsk, TicketRow } from "@/lib/tickets/types";

export interface BlockerItem {
  title: string;
  priorityLabel: "NOW" | "SOON";
  linkedTicketIds: string[];
  source: "team_ask" | "ticket_fallback";
}

const TIER_ORDER = { now: 0, soon: 1, later: 2 } as const;

export function resolveBlockers(teamAsks: TeamAsk[], openTickets: TicketRow[], max = 5): BlockerItem[] {
  const openAsks = teamAsks
    .filter((a) => a.status === "open" && a.priority_tier !== "later")
    .sort((a, b) => TIER_ORDER[a.priority_tier] - TIER_ORDER[b.priority_tier]);

  if (openAsks.length > 0) {
    return openAsks.slice(0, max).map((a) => ({
      title: a.ask_text,
      priorityLabel: a.priority_tier === "now" ? "NOW" : "SOON",
      linkedTicketIds: a.tickets.map((t) => t.id),
      source: "team_ask" as const,
    }));
  }

  return openTickets
    .filter((t) => t.classification === "hard_blocker" && t.closed_at == null && t.in_scope)
    .slice(0, max)
    .map((t) => ({ title: t.title, priorityLabel: "NOW" as const, linkedTicketIds: [t.id], source: "ticket_fallback" as const }));
}
