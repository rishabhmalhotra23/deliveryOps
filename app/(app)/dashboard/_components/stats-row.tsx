"use client";

import Link from "next/link";
import { useState } from "react";

import { DrillDownPanel } from "@/app/_components/drilldown-panel";
import { StatBlock, formatMoney } from "@/app/_components/brand";
import type {
  ArrBreakdownRow,
  OpenCaseRow,
  OpenOpportunityRow,
} from "@/lib/dashboard/stats-drilldown";

type Drill = "arr" | "attention" | "opps" | "cases" | null;

export function DashboardStatsRow({
  totalArr,
  needAttention,
  openOpportunities,
  openCases,
  customersWithSf,
  arrRows,
  attentionRows,
  oppsRows,
  casesRows,
}: {
  totalArr: number;
  needAttention: number;
  openOpportunities: number;
  openCases: number;
  customersWithSf: number;
  arrRows: ArrBreakdownRow[];
  attentionRows: ArrBreakdownRow[];
  oppsRows: OpenOpportunityRow[];
  casesRows: OpenCaseRow[];
}) {
  const [drill, setDrill] = useState<Drill>(null);

  return (
    <>
      <section className="grid gap-3 md:grid-cols-4">
        <StatBlock
          label="Total ARR"
          value={formatMoney(totalArr)}
          hint={`${customersWithSf} customers mapped to Salesforce`}
          emphasis
          onClick={() => setDrill("arr")}
        />
        <StatBlock
          label="Need attention"
          value={String(needAttention)}
          hint="At Risk + Upcoming Renewals"
          onClick={() => setDrill("attention")}
        />
        <StatBlock
          label="Open opportunities"
          value={String(openOpportunities)}
          hint="Across all customers (cached)"
          onClick={() => setDrill("opps")}
        />
        <StatBlock
          label="Open cases"
          value={String(openCases)}
          hint="Across all customers (cached)"
          onClick={() => setDrill("cases")}
        />
      </section>

      {drill === "arr" ? (
        <DrillDownPanel
          title="Total ARR"
          subtitle={
            <>
              <span className="text-[color:var(--foreground)] font-semibold">{formatMoney(totalArr)}</span>{" "}
              across {arrRows.length} active customers · sorted by ARR desc
            </>
          }
          onClose={() => setDrill(null)}
          footer="Past-state customers (Churned / Dropped / Past) are excluded from the active-book total."
        >
          <CustomerArrList rows={arrRows} />
        </DrillDownPanel>
      ) : null}

      {drill === "attention" ? (
        <DrillDownPanel
          title="Need attention"
          subtitle={`${attentionRows.length} customers in At Risk or Upcoming Renewals`}
          onClose={() => setDrill(null)}
        >
          <CustomerArrList rows={attentionRows} />
        </DrillDownPanel>
      ) : null}

      {drill === "opps" ? (
        <DrillDownPanel
          title="Open opportunities"
          subtitle={
            <>
              {oppsRows.length} open ·{" "}
              <span className="text-[color:var(--foreground)] font-semibold">
                {formatMoney(oppsRows.reduce((s, o) => s + (o.amount ?? 0), 0))}
              </span>{" "}
              total pipeline
            </>
          }
          onClose={() => setDrill(null)}
        >
          <OpportunityList rows={oppsRows} />
        </DrillDownPanel>
      ) : null}

      {drill === "cases" ? (
        <DrillDownPanel
          title="Open cases"
          subtitle={`${casesRows.length} cases currently open across the portfolio`}
          onClose={() => setDrill(null)}
        >
          <CaseList rows={casesRows} />
        </DrillDownPanel>
      ) : null}
    </>
  );
}

// ─── List renderers ────────────────────────────────────────────────────

function CustomerArrList({ rows }: { rows: ArrBreakdownRow[] }) {
  if (rows.length === 0) return <Empty>No customers in this bucket.</Empty>;
  const total = rows.reduce((s, r) => s + r.arr, 0);
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {rows.map((r) => (
        <li key={r.customer_key} className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/customers/${r.customer_key}`}
              className="text-sm font-medium text-[color:var(--foreground)] truncate hover:underline"
            >
              {r.customer_display_name}
            </Link>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-[color:var(--muted-foreground)]">
              <span>
                <CategoryPill category={r.category} />
              </span>
              {r.ae_owner ? <span>AE · {r.ae_owner}</span> : null}
              {r.partner ? <span>via {r.partner}</span> : null}
              {r.renewal_date ? <span>renews {r.renewal_date}</span> : null}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-semibold tabular-nums text-[color:var(--foreground)]">
              {formatMoney(r.arr)}
            </div>
            <div className="text-[10px] text-[color:var(--muted-foreground)] tabular-nums">
              {total > 0 ? `${((r.arr / total) * 100).toFixed(1)}% of total` : ""}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OpportunityList({ rows }: { rows: OpenOpportunityRow[] }) {
  if (rows.length === 0) return <Empty>No open opportunities.</Empty>;
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {rows.map((o) => {
        const probColor =
          o.probability == null
            ? "neutral"
            : o.probability >= 75
              ? "emerald"
              : o.probability >= 50
                ? "amber"
                : "neutral";
        return (
          <li key={o.sf_id} className="py-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[color:var(--foreground)] truncate">
                {o.customer_key ? (
                  <Link href={`/customers/${o.customer_key}`} className="hover:underline">
                    {o.customer_display_name ?? o.name}
                  </Link>
                ) : (
                  o.name
                )}
              </div>
              <div className="text-xs text-[color:var(--muted-foreground)] truncate mt-0.5">
                {o.name}
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-[color:var(--muted-foreground)]">
                {o.stage_name ? <span>{o.stage_name}</span> : null}
                {o.close_date ? <span>closes {o.close_date}</span> : null}
                {o.owner_name ? <span>{o.owner_name}</span> : null}
                {o.probability != null ? <Pill tone={probColor}>{o.probability}%</Pill> : null}
              </div>
            </div>
            <div className="text-sm font-semibold tabular-nums text-[color:var(--foreground)] shrink-0">
              {formatMoney(o.amount)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CaseList({ rows }: { rows: OpenCaseRow[] }) {
  if (rows.length === 0) return <Empty>No open cases.</Empty>;
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {rows.map((c) => (
        <li key={c.sf_id} className="py-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[color:var(--foreground)] truncate">
              {c.customer_key ? (
                <Link href={`/customers/${c.customer_key}`} className="hover:underline">
                  {c.customer_display_name ?? "—"}
                </Link>
              ) : (
                c.customer_display_name ?? "—"
              )}
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)] truncate mt-0.5">
              {c.subject ?? "(no subject)"}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-[color:var(--muted-foreground)]">
              {c.case_number ? <span>#{c.case_number}</span> : null}
              {c.status ? <span>{c.status}</span> : null}
              {c.origin ? <span>{c.origin}</span> : null}
            </div>
          </div>
          <div className="shrink-0">
            {c.priority ? (
              <Pill
                tone={
                  /high|urgent|critical/i.test(c.priority)
                    ? "red"
                    : /medium/i.test(c.priority)
                      ? "amber"
                      : "neutral"
                }
              >
                {c.priority}
              </Pill>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Bits ──────────────────────────────────────────────────────────────

type PillTone = "red" | "amber" | "emerald" | "indigo" | "neutral";
const TONE_CLASS: Record<PillTone, string> = {
  red:     "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  amber:   "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  indigo:  "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  neutral: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};
function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

function CategoryPill({ category }: { category: string }) {
  const tone: PillTone = /risk/i.test(category)
    ? "red"
    : /renewal/i.test(category)
      ? "amber"
      : /strategic|growth/i.test(category)
        ? "emerald"
        : /partner/i.test(category)
          ? "indigo"
          : "neutral";
  return <Pill tone={tone}>{category}</Pill>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-[color:var(--muted-foreground)] py-6">{children}</div>;
}
