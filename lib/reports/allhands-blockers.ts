// "This week's blockers" for the All-Hands report. team_asks marked open +
// priority "now"/"soon" are the human-curated showcase layer — if Rishabh
// (or anyone) files one, via the /tickets page or an agent tool, it shows up
// here verbatim. There's no live-data fallback: a flat top-N slice of open
// hard-blocker tickets hid real blockers whenever there were more than `max`
// of them and gave no sense of where they clustered (Rishabh, 2026-08-10).
// The domain/customer breakdowns in allhands-ticket-buckets.ts and
// lib/tickets/loader.ts's domain_groups cover that ground instead.

import type { TeamAsk } from "@/lib/tickets/types";

export interface BlockerItem {
  title: string;
  priorityLabel: "NOW" | "SOON";
  linkedTicketIds: string[];
  source: "team_ask";
}

const TIER_ORDER = { now: 0, soon: 1, later: 2 } as const;

export function resolveBlockers(teamAsks: TeamAsk[], max = 5): BlockerItem[] {
  const openAsks = teamAsks
    .filter((a) => a.status === "open" && a.priority_tier !== "later")
    .sort((a, b) => TIER_ORDER[a.priority_tier] - TIER_ORDER[b.priority_tier]);

  return openAsks.slice(0, max).map((a) => ({
    title: a.ask_text,
    priorityLabel: a.priority_tier === "now" ? "NOW" : "SOON",
    linkedTicketIds: a.tickets.map((t) => t.id),
    source: "team_ask" as const,
  }));
}
