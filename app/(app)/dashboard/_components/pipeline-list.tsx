"use client";

import { useState } from "react";
import Link from "next/link";

import type { PipelineKind, PipelineOpportunity } from "@/lib/dashboard/pipeline";
import { formatMoney } from "@/app/_components/brand";

const KIND_STYLE: Record<PipelineKind, { chip: string; label: string }> = {
  Renewal: {
    chip:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20",
    label: "Renewal",
  },
  Expansion: {
    chip:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
    label: "Expansion",
  },
  New: {
    chip:
      "bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20",
    label: "New",
  },
  Other: {
    chip:
      "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border border-[var(--glass-border)]",
    label: "Other",
  },
};

const COLLAPSED_COUNT = 5;

export function PipelineList({ opportunities }: { opportunities: PipelineOpportunity[] }) {
  const [expanded, setExpanded] = useState(false);
  const showAll = expanded || opportunities.length <= COLLAPSED_COUNT;
  const visible = showAll ? opportunities : opportunities.slice(0, COLLAPSED_COUNT);
  const hidden = opportunities.length - visible.length;

  return (
    <div className="rounded-lg border border-line bg-white dark:bg-white/6 dark:border-white/12">
      <ul className="divide-y divide-[color:var(--brand-metal-line)]">
        {visible.map((opp) => (
          <PipelineRow key={opp.sf_id} opp={opp} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full px-5 py-2.5 text-xs text-[color:var(--brand-gray)] hover:text-[color:var(--foreground)] border-t border-[color:var(--brand-metal-line)] transition-colors"
        >
          Show {hidden} more {hidden === 1 ? "opportunity" : "opportunities"} ↓
        </button>
      ) : opportunities.length > COLLAPSED_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full px-5 py-2.5 text-xs text-[color:var(--brand-gray)] hover:text-[color:var(--foreground)] border-t border-[color:var(--brand-metal-line)] transition-colors"
        >
          Collapse ↑
        </button>
      ) : null}
    </div>
  );
}

function PipelineRow({ opp }: { opp: PipelineOpportunity }) {
  const [open, setOpen] = useState(false);
  const kind = KIND_STYLE[opp.kind];
  const probColor =
    opp.probability == null
      ? "bg-slate-500/10 text-slate-600 dark:text-slate-400"
      : opp.probability >= 75
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        : opp.probability >= 50
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-slate-500/10 text-slate-600 dark:text-slate-400";

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3 flex items-center justify-between gap-4 text-left hover:bg-[color:var(--brand-seasalt)] dark:hover:bg-white/4 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${kind.chip}`}
              title={opp.type_raw ?? "No SF Type set"}
            >
              {kind.label}
            </span>
            <span className="text-sm font-medium text-[color:var(--foreground)] truncate">
              {opp.customer_display_name ?? opp.name}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {opp.stage_name ? (
              <span className="text-xs text-[color:var(--brand-gray)]">{opp.stage_name}</span>
            ) : null}
            {opp.close_date ? (
              <span className="text-xs text-[color:var(--brand-gray)]">closes {opp.close_date}</span>
            ) : null}
            {opp.owner_name ? (
              <span className="text-xs text-[color:var(--brand-gray)]">{opp.owner_name}</span>
            ) : null}
            {opp.probability != null ? (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${probColor}`}>
                {opp.probability}% likely
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold tabular-nums text-[color:var(--foreground)]">
            {formatMoney(opp.amount)}
          </span>
          <svg
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            className={`text-[color:var(--brand-gray)] transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>
      {open ? (
        <div className="px-5 pb-3 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <DetailField label="Opportunity" value={opp.name} />
          <DetailField
            label="Customer"
            value={
              opp.customer_key ? (
                <Link
                  href={`/customers/${opp.customer_key}`}
                  className="underline hover:opacity-80"
                >
                  {opp.customer_display_name ?? opp.customer_key}
                </Link>
              ) : (
                opp.customer_display_name ?? "—"
              )
            }
          />
          <DetailField label="SF Type" value={opp.type_raw ?? "(not set)"} />
          <DetailField label="Owner" value={opp.owner_name ?? "—"} />
          <DetailField label="Stage" value={opp.stage_name ?? "—"} />
          <DetailField label="Close date" value={opp.close_date ?? "—"} />
          <DetailField
            label="Probability"
            value={opp.probability != null ? `${opp.probability}%` : "—"}
          />
          <DetailField label="Amount" value={formatMoney(opp.amount)} />
        </div>
      ) : null}
    </li>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)] mb-0.5">
        {label}
      </div>
      <div className="text-[color:var(--foreground)]">{value}</div>
    </div>
  );
}
