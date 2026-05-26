// Operations agent — a portfolio-scoped Claude that talks to the whole
// customer book at once, runs natural-language commands like "Owen left,
// reassign his actives to Binny", and reports back.
//
// Distinct from the per-customer agent in lib/agent/runner.ts: that one
// reasons about a single customer's profile/events/tasks; this one
// reasons across all customers and uses bulk-update tools.

import Anthropic from "@anthropic-ai/sdk";

import {
  bulkUpdateCustomerField,
  findCustomers,
  getCustomerByKey,
  type CustomerFilter,
} from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import { BRAND_VOICE_BLOCK } from "@/lib/voice/brand-voice";
import { CUSTOMER_CATEGORIES } from "@/lib/supabase/types";
import { requireAdmin } from "@/lib/supabase/server";
import { loadCustomerEnrichment } from "@/lib/cache/integrations";
import { loadUpcomingPipeline } from "@/lib/dashboard/pipeline";
import {
  loadActiveProjects,
  loadOpenOpportunities,
  loadNpsResponses,
} from "@/lib/dashboard/stats-drilldown";
import { loadDeliveryBundle } from "@/lib/delivery/loader";
import {
  formatPersonName,
  formatPeopleList,
  isDelivered as txIsDelivered,
} from "@/lib/delivery/taxonomy";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 12;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Missing ANTHROPIC_API_KEY.");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_customers",
    description:
      "Find customers across the whole portfolio. Filters AND together. Returns up to 200 rows. Use this before bulk-updating so you can confirm the scope.",
    input_schema: {
      type: "object",
      properties: {
        ae_owner: { type: "string", description: "Exact match on AE name. Case-sensitive." },
        custom_category: {
          type: "string",
          description: `One of: ${CUSTOMER_CATEGORIES.join(", ")}, or any custom value the team has minted.`,
        },
        custom_category_in: { type: "array", items: { type: "string" } },
        partner: { type: "string" },
        lifecycle_group: { type: "string" },
        exclude_categories: { type: "array", items: { type: "string" } },
        has_salesforce: { type: "boolean" },
        search: { type: "string", description: "Substring match across name + key + ae_owner." },
      },
    },
  },
  {
    name: "update_customer_owner",
    description:
      "Reassign one or many customers to a new AE. Locks ae_owner so the next sync won't overwrite it. Always describe the change in your final reply.",
    input_schema: {
      type: "object",
      properties: {
        customer_keys: { type: "array", items: { type: "string" } },
        new_owner: { type: "string", description: "AE name. Use existing names exactly when matching." },
        reason: { type: "string", description: "Short note recorded against each customer's event log." },
      },
      required: ["customer_keys", "new_owner"],
    },
  },
  {
    name: "update_customer_category",
    description:
      "Move one or many customers to a different DeliveryOps category. Use this when the team's lifecycle bucket no longer matches reality. Locks custom_category against sync.",
    input_schema: {
      type: "object",
      properties: {
        customer_keys: { type: "array", items: { type: "string" } },
        new_category: {
          type: "string",
          description: `Target category. Standard buckets: ${CUSTOMER_CATEGORIES.join(", ")}. You can mint a new bucket — it'll appear in the dashboard automatically.`,
        },
        reason: { type: "string" },
      },
      required: ["customer_keys", "new_category"],
    },
  },
  {
    name: "update_customer_partner",
    description: "Set or change the partner agency for one or many customers (My Paradigm, Wipro BPS, QBotica, Indium, etc.).",
    input_schema: {
      type: "object",
      properties: {
        customer_keys: { type: "array", items: { type: "string" } },
        new_partner: { type: "string", description: "Empty string clears the partner." },
        reason: { type: "string" },
      },
      required: ["customer_keys", "new_partner"],
    },
  },
  {
    name: "summarize_portfolio",
    description: "Aggregate stats across the whole book — counts by AE, category, partner, plus FDE workload and project counts.  Use this for portfolio-wide \"how many X do we have\" questions.",
    input_schema: { type: "object", properties: {}, required: [] },
  },

  // ─── Read-only tools across the rest of the data surface ───────────────
  // The dashboard, /delivery, /analytics, /reports all read the same caches;
  // these tools surface them to the operations agent so it can answer
  // questions about FDE workload, projects, opportunities, NPS, and events
  // — not just AE/category/partner.

  {
    name: "find_projects",
    description:
      "Find projects across every Monday board with FDE roster, status, phase, customer.  Filters AND together. Returns up to 50 rows.  Use this any time the question is about FDEs, project assignments, what's in flight, or who is working on what.  An FDE name is matched case-insensitively against the union of Monday's delivery + engineering columns — so 'Rishabh' matches every project Rishabh is on regardless of role.",
    input_schema: {
      type: "object",
      properties: {
        fde: { type: "string", description: "Match if this person is on the project (case-insensitive)." },
        customer: { type: "string", description: "Customer key or display name." },
        status: { type: "string", description: "Monday project status: 'In Progress', 'Delivered', 'Live', 'On Hold', etc." },
        phase: { type: "string", description: "Milestone phase substring, e.g. 'Discovery', 'UAT'." },
        fiscal_year: { type: "string", description: "Board provenance: 'active' (in-flight) or 'FY-2026' / 'FY-2025' / etc." },
        health: { type: "string", description: "Health label: 'On Track', 'At Risk', 'Blocked'." },
        active_only: { type: "boolean", description: "Default true. When true, exclude Delivered / Live / Cancelled projects." },
      },
    },
  },
  {
    name: "count_projects_by_fde",
    description:
      "Aggregate active project counts per FDE — same data as the analytics workload chart.  Use this when the user asks 'who has the most projects?', 'how busy is X?', or 'in how many accounts is X assigned?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_customer_360",
    description:
      "Deep dive on one customer: profile, ARR, renewal date, FDE roster, active + delivered projects, recent NPS, open opportunities + cases, recent events.  Use when the user asks 'what's going on with Acme?' or 'tell me about JBI'.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer key or display name (case-insensitive)." },
      },
      required: ["customer"],
    },
  },
  {
    name: "list_open_opportunities",
    description:
      "Open Salesforce opportunities with amount, stage, AE owner.  Use for pipeline / forecasting / 'what's closing this quarter?' questions.  Optional filter by AE or customer.",
    input_schema: {
      type: "object",
      properties: {
        ae: { type: "string" },
        customer: { type: "string", description: "Customer key or display name." },
        kind: { type: "string", description: "Renewal, Expansion, New, or Other." },
        closing_within_days: { type: "number", description: "If set, only opps closing within N days." },
      },
    },
  },
  {
    name: "list_recent_nps",
    description: "Recent NPS responses with score, category (Promoter/Passive/Detractor), and feedback.  Filter by customer or quarter.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer key or display name." },
        quarter: { type: "string", description: "e.g. '1Q26' or '4Q25'." },
        limit: { type: "number", description: "Default 10." },
      },
    },
  },
  {
    name: "list_recent_events",
    description:
      "Recent customer events across the portfolio — Slack threads, emails, profile edits, project changes.  Useful for 'what changed this week?' or 'any recent activity for Acme?'.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Limit to one customer (optional)." },
        days: { type: "number", description: "Default 7." },
        limit: { type: "number", description: "Default 20." },
      },
    },
    // Prompt-caching marker on the last tool caches the whole tools block.
    cache_control: { type: "ephemeral" },
  },
];

export type AgentSource = "operations";

interface OperationsContext {
  source: AgentSource;
}

async function executeTool(name: string, input: Record<string, unknown>, _ctx: OperationsContext): Promise<string> {
  switch (name) {
    case "find_customers":
      return findCustomersTool(input);
    case "update_customer_owner":
      return updateOwnerTool(input);
    case "update_customer_category":
      return updateCategoryTool(input);
    case "update_customer_partner":
      return updatePartnerTool(input);
    case "summarize_portfolio":
      return summarizePortfolioTool();
    case "find_projects":
      return findProjectsTool(input);
    case "count_projects_by_fde":
      return countProjectsByFdeTool();
    case "get_customer_360":
      return getCustomer360Tool(input);
    case "list_open_opportunities":
      return listOpenOpportunitiesTool(input);
    case "list_recent_nps":
      return listRecentNpsTool(input);
    case "list_recent_events":
      return listRecentEventsTool(input);
    default:
      return `Unknown tool: ${name}`;
  }
}

async function findCustomersTool(input: Record<string, unknown>): Promise<string> {
  const filter: CustomerFilter = {
    ae_owner: stringOrUndefined(input.ae_owner),
    partner: stringOrUndefined(input.partner),
    custom_category: stringOrUndefined(input.custom_category),
    custom_category_in: stringArrayOrUndefined(input.custom_category_in),
    lifecycle_group: stringOrUndefined(input.lifecycle_group),
    exclude_categories: stringArrayOrUndefined(input.exclude_categories),
    has_salesforce: typeof input.has_salesforce === "boolean" ? input.has_salesforce : undefined,
    search: stringOrUndefined(input.search),
  };
  const rows = await findCustomers(filter);
  if (rows.length === 0) return "No customers matched.";
  const summary = `${rows.length} customer${rows.length === 1 ? "" : "s"}.`;
  const lines = rows
    .slice(0, 100)
    .map(
      (r) =>
        `- ${r.display_name} (${r.key}) · category=${r.custom_category ?? "—"} · ae=${r.ae_owner ?? "—"} · partner=${r.partner ?? "—"} · lifecycle=${r.lifecycle_group ?? "—"}`
    );
  if (rows.length > 100) lines.push(`… ${rows.length - 100} more not shown.`);
  return `${summary}\n${lines.join("\n")}`;
}

async function updateOwnerTool(input: Record<string, unknown>): Promise<string> {
  const keys = stringArrayOrThrow(input.customer_keys, "customer_keys");
  const newOwner = stringOrThrow(input.new_owner, "new_owner");
  const reason = stringOrUndefined(input.reason);

  if (keys.length === 0) return "No customer_keys provided — nothing to update.";

  const before = await findCustomers({ search: undefined }).then((all) =>
    new Map(all.map((c) => [c.key, c.ae_owner ?? null]))
  );

  const updated = await bulkUpdateCustomerField(keys, "ae_owner", newOwner);

  const lines: string[] = [];
  for (const c of updated) {
    const prev = before.get(c.key) ?? "(none)";
    lines.push(`- ${c.display_name}: ${prev} → ${newOwner}`);
    try {
      await appendEvent(
        c.key,
        "OWNER_CHANGED",
        { from: prev, to: newOwner, reason: reason ?? null, source: "operations-chat" },
        { summary: `AE changed: ${prev} → ${newOwner}`, tags: ["ownership", "operations"] }
      );
    } catch {
      /* event logging is best-effort */
    }
  }

  return `Reassigned ${updated.length} customer${updated.length === 1 ? "" : "s"} to ${newOwner}${reason ? ` (${reason})` : ""}.\n${lines.join("\n")}`;
}

async function updateCategoryTool(input: Record<string, unknown>): Promise<string> {
  const keys = stringArrayOrThrow(input.customer_keys, "customer_keys");
  const newCategory = stringOrThrow(input.new_category, "new_category");
  const reason = stringOrUndefined(input.reason);

  if (keys.length === 0) return "No customer_keys provided — nothing to update.";

  const before = await findCustomers({}).then((all) =>
    new Map(all.map((c) => [c.key, c.custom_category ?? null]))
  );

  const updated = await bulkUpdateCustomerField(keys, "custom_category", newCategory);

  const lines: string[] = [];
  for (const c of updated) {
    const prev = before.get(c.key) ?? "(none)";
    lines.push(`- ${c.display_name}: ${prev} → ${newCategory}`);
    try {
      await appendEvent(
        c.key,
        "CATEGORY_CHANGED",
        { from: prev, to: newCategory, reason: reason ?? null, source: "operations-chat" },
        { summary: `Category changed: ${prev} → ${newCategory}`, tags: ["category", "operations"] }
      );
    } catch {
      /* */
    }
  }

  return `Recategorised ${updated.length} customer${updated.length === 1 ? "" : "s"} as "${newCategory}"${reason ? ` (${reason})` : ""}.\n${lines.join("\n")}`;
}

async function updatePartnerTool(input: Record<string, unknown>): Promise<string> {
  const keys = stringArrayOrThrow(input.customer_keys, "customer_keys");
  const newPartner = stringOrThrow(input.new_partner, "new_partner");

  const value = newPartner.trim() || null;
  const before = await findCustomers({}).then((all) =>
    new Map(all.map((c) => [c.key, c.partner ?? null]))
  );

  const updated = await bulkUpdateCustomerField(keys, "partner", value);
  const lines = updated.map(
    (c) => `- ${c.display_name}: ${before.get(c.key) ?? "(none)"} → ${value ?? "(none)"}`
  );
  return `Updated partner on ${updated.length} customer${updated.length === 1 ? "" : "s"}.\n${lines.join("\n")}`;
}

async function summarizePortfolioTool(): Promise<string> {
  const [all, bundle] = await Promise.all([
    findCustomers({}),
    loadDeliveryBundle().catch(() => null),
  ]);
  const byAe = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byPartner = new Map<string, number>();
  for (const c of all) {
    const ae = formatPersonName(c.ae_owner ?? "") || "(unassigned)";
    const cat = c.custom_category ?? "(none)";
    const partner = c.partner ?? "(direct)";
    byAe.set(ae, (byAe.get(ae) ?? 0) + 1);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    byPartner.set(partner, (byPartner.get(partner) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");

  // FDE workload — count each person on every active in-flight project,
  // deduped per project (matches the analytics workload chart).
  const byFde = new Map<string, number>();
  let inFlightCount = 0;
  let deliveredCount = 0;
  if (bundle) {
    for (const p of bundle.projects) {
      const active = p.fiscal_year === "active" && !txIsDelivered(p.status, p.group_title);
      if (active) inFlightCount++;
      if (txIsDelivered(p.status, p.group_title)) deliveredCount++;
      if (!active || !p.fde) continue;
      const names = new Set<string>();
      for (const piece of p.fde.split(",")) {
        const name = formatPersonName(piece);
        if (name) names.add(name);
      }
      for (const name of names) byFde.set(name, (byFde.get(name) ?? 0) + 1);
    }
  }

  return [
    `Portfolio: ${all.length} customers · ${inFlightCount} active projects · ${deliveredCount} delivered all-time.`,
    "",
    `By AE:\n${fmt(byAe)}`,
    "",
    `By FDE (active projects):\n${byFde.size > 0 ? fmt(byFde) : "  (no data)"}`,
    "",
    `By category:\n${fmt(byCategory)}`,
    "",
    `By partner:\n${fmt(byPartner)}`,
  ].join("\n");
}

// ─── New read-only tools ──────────────────────────────────────────────────

async function findProjectsTool(input: Record<string, unknown>): Promise<string> {
  const fde = stringOrUndefined(input.fde)?.toLowerCase();
  const customer = stringOrUndefined(input.customer)?.toLowerCase();
  const status = stringOrUndefined(input.status);
  const phase = stringOrUndefined(input.phase)?.toLowerCase();
  const fiscalYear = stringOrUndefined(input.fiscal_year);
  const health = stringOrUndefined(input.health);
  const activeOnly = input.active_only !== false; // default true

  const bundle = await loadDeliveryBundle().catch(() => null);
  if (!bundle) return "Could not load delivery data.";

  const rows = bundle.projects.filter((p) => {
    if (activeOnly && txIsDelivered(p.status, p.group_title)) return false;
    if (status && p.status !== status) return false;
    if (fiscalYear && p.fiscal_year !== fiscalYear) return false;
    if (health && (p.health ?? "") !== health) return false;
    if (phase && !(p.phase ?? "").toLowerCase().includes(phase)) return false;
    if (customer) {
      const a = p.customer_display_name.toLowerCase();
      const b = p.customer_key.toLowerCase();
      if (!a.includes(customer) && !b.includes(customer)) return false;
    }
    if (fde) {
      if (!p.fde) return false;
      // Match against the raw + canonical form so "rishabh" hits "Rishabh M."
      // and "Rishabh Malhotra" both.
      const hay = p.fde
        .split(",")
        .flatMap((n) => [n.trim().toLowerCase(), formatPersonName(n).toLowerCase()])
        .join("|");
      if (!hay.includes(fde)) return false;
    }
    return true;
  });

  if (rows.length === 0) return "No projects matched.";

  const lines = rows.slice(0, 50).map((p) => {
    const fdeList = formatPeopleList(p.fde) || "(no FDE)";
    return `- ${p.customer_display_name} · ${p.name} · status=${p.status ?? "—"} · phase=${p.phase ?? "—"} · FDE: ${fdeList}${p.go_live_date ? ` · go-live ${p.go_live_date}` : ""}`;
  });
  const more = rows.length > 50 ? `\n… ${rows.length - 50} more not shown.` : "";
  return `${rows.length} project${rows.length === 1 ? "" : "s"} matched.\n${lines.join("\n")}${more}`;
}

async function countProjectsByFdeTool(): Promise<string> {
  const activeProjects = await loadActiveProjects().catch(() => []);
  // Each project counts each FDE on it once.  Same shape as the analytics
  // workload chart (analytics.by_fde).
  const byFde = new Map<string, { count: number; customers: Set<string> }>();
  for (const p of activeProjects) {
    if (!p.fde) continue;
    const names = new Set<string>();
    for (const piece of p.fde.split(",")) {
      const name = formatPersonName(piece);
      if (name) names.add(name);
    }
    for (const name of names) {
      const bucket = byFde.get(name) ?? { count: 0, customers: new Set<string>() };
      bucket.count++;
      if (p.customer_display_name) bucket.customers.add(p.customer_display_name);
      byFde.set(name, bucket);
    }
  }
  if (byFde.size === 0) return "No active project assignments found.";
  const rows = [...byFde.entries()].sort((a, b) => b[1].count - a[1].count);
  const lines = rows.map(
    ([name, b]) =>
      `  - ${name}: ${b.count} active project${b.count === 1 ? "" : "s"} across ${b.customers.size} customer${b.customers.size === 1 ? "" : "s"}`
  );
  return `FDE workload — active in-flight projects:\n${lines.join("\n")}`;
}

async function resolveCustomer(query: string): Promise<{ id: string; key: string; display_name: string } | null> {
  const q = query.trim().toLowerCase();
  // Try exact key first
  const byKey = await getCustomerByKey(q).catch(() => null);
  if (byKey) return { id: byKey.id, key: byKey.key, display_name: byKey.display_name };
  // Fall back to substring on key + display_name
  const all = await findCustomers({});
  const hit =
    all.find((c) => c.key.toLowerCase() === q || c.display_name.toLowerCase() === q) ??
    all.find((c) => c.display_name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q));
  return hit ? { id: hit.id, key: hit.key, display_name: hit.display_name } : null;
}

async function getCustomer360Tool(input: Record<string, unknown>): Promise<string> {
  const query = stringOrThrow(input.customer, "customer");
  const c = await resolveCustomer(query);
  if (!c) return `No customer matched "${query}".`;

  // Pull everything in parallel.
  const [enrichment, custFull, pipeline] = await Promise.all([
    loadCustomerEnrichment(c.id).catch(() => null),
    getCustomerByKey(c.key).catch(() => null),
    loadUpcomingPipeline().catch(() => null),
  ]);

  if (!custFull) return `Resolved ${c.display_name} but could not load full customer row.`;

  // Aggregate FDE roster across active projects.
  const fdeNames = new Set<string>();
  let activeProjects = 0;
  let deliveredProjects = 0;
  for (const p of enrichment?.projects ?? []) {
    const delivered = txIsDelivered(p.project_status, p.group_title);
    if (delivered) deliveredProjects++;
    else activeProjects++;
    if (!delivered && p.fde) {
      for (const piece of p.fde.split(",")) {
        const n = formatPersonName(piece);
        if (n) fdeNames.add(n);
      }
    }
  }

  // Active project lines (top 8 newest by go-live date).
  const activeLines = (enrichment?.projects ?? [])
    .filter((p) => !txIsDelivered(p.project_status, p.group_title))
    .slice(0, 8)
    .map(
      (p) =>
        `  - ${p.name} · status=${p.project_status ?? "—"} · phase=${p.current_phase ?? "—"} · FDE: ${formatPeopleList(p.fde) || "(none)"}${p.go_live_date ? ` · go-live ${p.go_live_date}` : ""}`
    );

  // Recent NPS (top 3 most recent).
  const npsLines = (enrichment?.nps ?? [])
    .slice(0, 3)
    .map(
      (n) =>
        `  - ${n.respondent}: ${n.score ?? "—"} (${n.category ?? "—"})${n.quarter ? ` · ${n.quarter}` : ""}${n.feedback ? ` — ${truncate(n.feedback, 120)}` : ""}`
    );

  // Open opportunities for this customer.
  const opps = (pipeline?.opportunities ?? []).filter((o) => o.customer_key === c.key);
  const oppLines = opps.slice(0, 5).map(
    (o) =>
      `  - ${o.kind} · ${o.name} · ${o.stage_name ?? "—"} · ${o.amount != null ? `$${o.amount.toLocaleString()}` : "—"}${o.close_date ? ` · closes ${o.close_date}` : ""}`
  );

  // Recent events (last 5).  Supabase's PostgrestFilterBuilder is a
  // thenable, not a Promise, so we wrap with `Promise.resolve(...)` before
  // attaching `.catch()`.
  const sb = requireAdmin();
  const eventsRes = await Promise.resolve(
    sb
      .from("events")
      .select("event_type, summary, ts")
      .eq("customer_id", c.id)
      .order("ts", { ascending: false })
      .limit(5)
  ).catch(() => ({ data: null as null | unknown }));
  const eventLines = ((eventsRes.data as Array<{ event_type: string; summary: string; ts: string }> | null) ?? []).map(
    (e) => `  - ${e.ts.slice(0, 10)} · ${e.event_type} · ${truncate(e.summary, 100)}`
  );

  return [
    `# ${c.display_name} (${c.key})`,
    `Category: ${custFull.custom_category ?? "—"} · Lifecycle: ${custFull.lifecycle_group ?? "—"} · AE: ${formatPersonName(custFull.ae_owner ?? "") || "(unassigned)"} · Partner: ${custFull.partner ?? "(direct)"}`,
    `Projects: ${activeProjects} active · ${deliveredProjects} delivered`,
    `FDEs on active work: ${fdeNames.size > 0 ? [...fdeNames].sort().join(", ") : "(none)"}`,
    "",
    activeLines.length > 0 ? `Active projects:\n${activeLines.join("\n")}` : "Active projects: (none)",
    "",
    npsLines.length > 0 ? `Recent NPS:\n${npsLines.join("\n")}` : "Recent NPS: (none)",
    "",
    oppLines.length > 0 ? `Open opportunities:\n${oppLines.join("\n")}` : "Open opportunities: (none)",
    "",
    eventLines.length > 0 ? `Recent events:\n${eventLines.join("\n")}` : "Recent events: (none)",
  ].join("\n");
}

async function listOpenOpportunitiesTool(input: Record<string, unknown>): Promise<string> {
  const ae = stringOrUndefined(input.ae)?.toLowerCase();
  const customer = stringOrUndefined(input.customer)?.toLowerCase();
  const kind = stringOrUndefined(input.kind);
  const closingWithin = typeof input.closing_within_days === "number" ? input.closing_within_days : null;

  const opps = await loadOpenOpportunities().catch(() => []);
  // Closing-within filter (we don't store an "is renewal" classification on
  // OpenOpportunityRow, so we use the pipeline tool when kind matters).
  const cutoff = closingWithin != null ? new Date(Date.now() + closingWithin * 86_400_000) : null;
  const filtered = opps.filter((o) => {
    if (ae && (o.owner_name ?? "").toLowerCase() !== ae) return false;
    if (customer) {
      const a = (o.customer_display_name ?? "").toLowerCase();
      const b = (o.customer_key ?? "").toLowerCase();
      if (!a.includes(customer) && !b.includes(customer)) return false;
    }
    if (cutoff && o.close_date) {
      const d = new Date(o.close_date);
      if (Number.isFinite(d.getTime()) && d > cutoff) return false;
    }
    return true;
  });

  // If user asked for a specific kind, fall back to the pipeline loader
  // (it has the kind classification).
  let kindNote = "";
  if (kind) {
    const pipeline = await loadUpcomingPipeline().catch(() => null);
    if (pipeline) {
      const matching = pipeline.opportunities.filter(
        (o) => o.kind.toLowerCase() === kind.toLowerCase()
      );
      const top = matching.slice(0, 25).map(
        (o) =>
          `  - ${o.customer_display_name ?? o.name} · ${o.kind} · ${o.stage_name ?? "—"} · ${o.amount != null ? `$${o.amount.toLocaleString()}` : "—"}${o.close_date ? ` · closes ${o.close_date}` : ""}${o.fdes?.length ? ` · FDE ${formatPeopleList(o.fdes)}` : ""}`
      );
      kindNote = `\n\n${matching.length} ${kind} opportunit${matching.length === 1 ? "y" : "ies"} closing within 90 days:\n${top.join("\n")}`;
    }
  }

  if (filtered.length === 0 && !kindNote) return "No open opportunities matched.";
  const lines = filtered.slice(0, 30).map(
    (o) =>
      `  - ${o.customer_display_name ?? "—"} · ${o.name} · ${o.stage_name ?? "—"} · ${o.amount != null ? `$${o.amount.toLocaleString()}` : "—"}${o.close_date ? ` · closes ${o.close_date}` : ""}${o.owner_name ? ` · ${formatPersonName(o.owner_name)}` : ""}`
  );
  const header = `${filtered.length} open opportunit${filtered.length === 1 ? "y" : "ies"}.`;
  return filtered.length > 0 ? `${header}\n${lines.join("\n")}${kindNote}` : kindNote.trim();
}

async function listRecentNpsTool(input: Record<string, unknown>): Promise<string> {
  const customer = stringOrUndefined(input.customer)?.toLowerCase();
  const quarter = stringOrUndefined(input.quarter);
  const limit = typeof input.limit === "number" ? input.limit : 10;

  const responses = await loadNpsResponses().catch(() => []);
  const filtered = responses.filter((n) => {
    if (customer) {
      const a = (n.customer_display_name ?? "").toLowerCase();
      const b = (n.customer_key ?? "").toLowerCase();
      if (!a.includes(customer) && !b.includes(customer)) return false;
    }
    if (quarter && n.quarter !== quarter) return false;
    return true;
  });
  if (filtered.length === 0) return "No NPS responses matched.";
  const lines = filtered.slice(0, limit).map(
    (n) =>
      `  - ${n.customer_display_name ?? "—"} · ${n.respondent ?? "?"} · ${n.score ?? "—"} (${n.category ?? "—"})${n.quarter ? ` · ${n.quarter}` : ""}${n.feedback ? ` — ${truncate(n.feedback, 120)}` : ""}`
  );
  return `${filtered.length} response${filtered.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

async function listRecentEventsTool(input: Record<string, unknown>): Promise<string> {
  const customerQ = stringOrUndefined(input.customer);
  const days = typeof input.days === "number" ? input.days : 7;
  const limit = typeof input.limit === "number" ? input.limit : 20;

  const sb = requireAdmin();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  let q = sb
    .from("events")
    .select("customer_id, event_type, summary, ts")
    .gte("ts", cutoff)
    .order("ts", { ascending: false })
    .limit(limit);

  let customerId: string | null = null;
  if (customerQ) {
    const resolved = await resolveCustomer(customerQ);
    if (!resolved) return `No customer matched "${customerQ}".`;
    customerId = resolved.id;
    q = q.eq("customer_id", customerId);
  }

  const { data } = await q;
  const rows = (data as Array<{ customer_id: string; event_type: string; summary: string; ts: string }> | null) ?? [];
  if (rows.length === 0) return `No events in the last ${days} days.`;

  // Resolve customer names if we're not already scoped to one.
  const custMap = customerId
    ? new Map<string, string>()
    : new Map((await findCustomers({})).map((c) => [c.id, c.display_name]));

  const lines = rows.map((e) => {
    const who = customerId ? "" : `${custMap.get(e.customer_id) ?? "—"} · `;
    return `  - ${e.ts.slice(0, 16).replace("T", " ")} · ${who}${e.event_type} · ${truncate(e.summary, 120)}`;
  });
  return `${rows.length} event${rows.length === 1 ? "" : "s"} in the last ${days} day${days === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ─── arg coercion ────────────────────────────────────────────────────────

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function stringOrThrow(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required.`);
  return v.trim();
}
function stringArrayOrUndefined(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const cleaned = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
  return cleaned.length ? cleaned : undefined;
}
function stringArrayOrThrow(v: unknown, name: string): string[] {
  const out = stringArrayOrUndefined(v);
  if (!out) throw new Error(`${name} must be a non-empty string array.`);
  return out;
}

// ─── system prompt ───────────────────────────────────────────────────────
//
// Returned as cacheable text blocks for Anthropic prompt caching:
//   1. Skeleton (rules + flow)  → cached
//   2. Brand voice              → cached
// See `lib/agent/prompts.ts` for the per-customer equivalent.

const OPS_SKELETON = `You are the **DeliveryOps Operations Agent** — the portfolio-wide brain for the Kognitos Forward Deployed Engineering team. You operate across the whole book and have read access to every dataset DeliveryOps tracks.

## What you can answer
You have tools to inspect every source of customer truth DeliveryOps holds:
- **Customers** (\`find_customers\`, \`summarize_portfolio\`) — AE / category / partner / lifecycle filters.
- **Projects** (\`find_projects\`, \`count_projects_by_fde\`) — every Monday project across every FY board, with FDE roster, status, phase, fiscal year, health.  Monday splits delivery + engineering into two people-columns but DeliveryOps treats them as one FDE roster.
- **Customer 360** (\`get_customer_360\`) — one-shot deep dive: profile, ARR, renewal, FDEs, projects, NPS, opportunities, recent events.
- **Pipeline** (\`list_open_opportunities\`) — open Salesforce opportunities, filterable by AE / customer / kind / close date.
- **NPS** (\`list_recent_nps\`) — recent customer-feedback scores + comments.
- **Events** (\`list_recent_events\`) — what changed recently per customer.

You also have **write** tools for portfolio-wide reassignments:
- \`update_customer_owner\` (AE) · \`update_customer_category\` · \`update_customer_partner\`.
These lock the field against sync overwrites; the team needs to know.  FDE assignments are NOT writable yet — they live in Monday's people-columns and sync one-way.

## How you work
1. **Pick the right tool.**  FDE / project / "who's working on what" questions go to \`find_projects\` or \`count_projects_by_fde\`, not \`find_customers\`.  "Tell me about Acme" goes to \`get_customer_360\`.  Aggregate counts go to \`summarize_portfolio\`.
2. **Find before you change.**  For any bulk write, always call \`find_customers\` (or \`find_projects\`) first to confirm scope and report the count + names back.
3. **Describe what you did** in your final text reply.  The team needs to be able to undo confidently.
4. **Source-of-truth rule.**  When you change a field via your tools, that field locks from sync overwrites.  Be deliberate.
5. **Don't fabricate categories.**  Use existing categories unless the user explicitly says to mint a new one.  Standard set: At Risk, Upcoming Renewals, Strategic Growth, Active, Partner Managed, POV, Churned.
6. **Don't touch churned customers** unless explicitly asked.  They're frozen for retro/win-loss analysis.
7. **Names are case-insensitive on lookup.**  "rishabh", "Rishabh", and "Rishabh Malhotra" all match.  When you display a name, use the canonical form the tool returns ("Rishabh M.", "Shyam P. (PM)", etc.).
8. **One clarifying question at a time.**  If a request is ambiguous (e.g. "rename Owen's accounts to Binny" — actives only? all?), ask once, then proceed.`;

function buildSystemPrompt(): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: OPS_SKELETON,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: BRAND_VOICE_BLOCK,
      cache_control: { type: "ephemeral" },
    },
  ];
}

// ─── streaming runner ────────────────────────────────────────────────────

export type OpsStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool_name: string; tool_input: unknown }
  | { type: "tool_result"; tool_name: string; content: string }
  | { type: "done"; full_text: string }
  | { type: "error"; content: string };

export async function* streamOperationsAgent(opts: {
  userMessage: string;
  history?: Anthropic.MessageParam[];
}): AsyncGenerator<OpsStreamEvent, void, void> {
  const messages: Anthropic.MessageParam[] = [
    ...(opts.history ?? []),
    { role: "user", content: opts.userMessage },
  ];
  const system = buildSystemPrompt();
  let fullText = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOLS,
      messages,
    });

    const textChunks: string[] = [];
    let textBuffer = "";
    stream.on("text", (text) => {
      textBuffer += text;
      textChunks.push(text);
    });

    let finalMessage: Anthropic.Message;
    try {
      finalMessage = await stream.finalMessage();
    } catch (err) {
      yield { type: "error", content: err instanceof Error ? err.message : String(err) };
      return;
    }

    for (const chunk of textChunks) {
      fullText += chunk;
      yield { type: "text", content: chunk };
    }

    const toolBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolBlocks.length === 0) {
      yield { type: "done", full_text: fullText };
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolBlocks) {
      yield { type: "tool_use", tool_name: block.name, tool_input: block.input };
      let result: string;
      try {
        result = await executeTool(block.name, (block.input as Record<string, unknown>) ?? {}, {
          source: "operations",
        });
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      yield {
        type: "tool_result",
        tool_name: block.name,
        content: result.length > 320 ? result.slice(0, 320) + "…" : result,
      };
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "assistant", content: finalMessage.content });
    messages.push({ role: "user", content: toolResults });

    if (textBuffer.length > 0) {
      yield { type: "text", content: "\n\n" };
      fullText += "\n\n";
    }
  }

  yield { type: "done", full_text: fullText };
}
