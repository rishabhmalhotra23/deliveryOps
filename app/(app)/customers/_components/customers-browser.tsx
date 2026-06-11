"use client";

// Interactive Customers browser. Server builds a flat, serializable row list
// (one CustomerRow per account, with category + zone precomputed) and hands it
// here. This component owns the client-side experience: live search, sort,
// zone filtering, and collapsible zones. No data fetching here.

import Link from "next/link";
import { useMemo, useState } from "react";

import { CustomerAvatar } from "@/app/_components/customer-avatar";
import { formatMoney } from "@/app/_components/brand";
import { ZONE_ORDER, ZONE_DESC, type Zone } from "@/app/_components/brand";
import { formatPeopleList, formatPersonName } from "@/lib/delivery/taxonomy";

export interface CustomerRow {
  key: string;
  displayName: string;
  logoUrl: string | null;
  domain: string | null;
  category: string;
  zone: Zone;
  aeOwner: string | null;
  fdes: string[];
  partner: string | null;
  arr: number | null;
  renewalDate: string | null;
  editedCount: number;
}

type SortKey = "name" | "arr" | "renew";

// Row chip colours — kept verbatim from the previous server page so rows look
// identical, plus the new Evaluation tone.
const CATEGORY_VARIANT: Record<string, string> = {
  "At Risk": "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  "To Drop": "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  "Upcoming Renewals": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  "Strategic Growth": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  Active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "Partner Managed": "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  POV: "bg-[var(--brand-yellow-soft)] text-[color:var(--brand-night)] border-[var(--brand-yellow-line)]",
  Evaluation: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/20",
  Past: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  Churned: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  Dropped: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

function renewalUrgency(iso: string | null): "soon" | "due" | "ok" | "past" | "none" {
  if (!iso) return "none";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "none";
  const days = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return "past";
  if (days <= 30) return "due";
  if (days <= 90) return "soon";
  return "ok";
}

const RENEWAL_TONE: Record<string, string> = {
  due: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  soon: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  ok: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
  past: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  none: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

function CustomerStrip({ row }: { row: CustomerRow }) {
  const isClosed = row.zone === "Closed";
  const catStyle =
    CATEGORY_VARIANT[row.category] ??
    "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
  const urgency = renewalUrgency(row.renewalDate);

  return (
    <Link
      href={`/customers/${row.key}`}
      className="group glass-card glass-card-hover flex items-center gap-4 px-4 py-3 transition-all"
    >
      <CustomerAvatar
        name={row.displayName}
        logoUrl={row.logoUrl}
        domain={row.domain}
        category={row.category}
        size="sm"
        dimmed={isClosed}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]"
            title={row.displayName}
          >
            {row.displayName}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${catStyle}`}>
            {row.category}
          </span>
          {row.partner && row.category !== "Partner Managed" ? (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
              title={`Partner-managed via ${row.partner}`}
            >
              Partner Managed
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 flex-wrap">
          {row.aeOwner ? (
            <span className="data-label text-[color:var(--muted-foreground)]" title={`AE: ${row.aeOwner}`}>
              <span className="opacity-70">AE</span> {formatPersonName(row.aeOwner)}
            </span>
          ) : null}
          {row.fdes.length > 0 ? (
            <span className="data-label text-[color:var(--muted-foreground)]" title={`FDE: ${row.fdes.join(", ")}`}>
              <span className="opacity-70">FDE</span> {formatPeopleList(row.fdes)}
            </span>
          ) : null}
          {row.partner ? (
            <span className="data-label text-[color:var(--muted-foreground)]" title={`Partner: ${row.partner}`}>
              via {row.partner}
            </span>
          ) : null}
        </div>
      </div>

      {!isClosed ? (
        <div className="hidden md:flex items-center gap-2 shrink-0 mr-3 text-right">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]">ARR</div>
            <div className="data-label tabular-nums text-[color:var(--foreground)] font-semibold">
              {row.arr != null ? formatMoney(row.arr) : "—"}
            </div>
          </div>
          <div className="w-px h-7 bg-[var(--glass-border)]" />
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]">Renews</div>
            {row.renewalDate ? (
              <span
                title={
                  urgency === "due"
                    ? "Renewal within 30 days"
                    : urgency === "soon"
                      ? "Renewal within 90 days"
                      : urgency === "past"
                        ? "Renewal date is in the past — sync may be stale"
                        : "Renewal date"
                }
                className={`data-label tabular-nums px-1.5 py-0.5 rounded border whitespace-nowrap ${RENEWAL_TONE[urgency]}`}
              >
                {row.renewalDate}
              </span>
            ) : (
              <span className="data-label text-[color:var(--muted-foreground)]">—</span>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 shrink-0">
        {row.editedCount > 0 ? (
          <span
            title={`${row.editedCount} field(s) manually edited`}
            className="data-label px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border border-[var(--glass-border)]"
          >
            {row.editedCount} edited
          </span>
        ) : null}
        <svg
          className="w-3.5 h-3.5 text-[color:var(--muted-foreground)] ml-1 transition-transform group-hover:translate-x-0.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
    </Link>
  );
}

export function CustomersBrowser({ rows }: { rows: CustomerRow[] }) {
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState<Zone | "all">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [collapsed, setCollapsed] = useState<Partial<Record<Zone, boolean>>>({});

  // Unfiltered per-zone counts for the filter chips.
  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.zone] = (counts[r.zone] ?? 0) + 1;
    return counts;
  }, [rows]);

  const matches = (r: CustomerRow, q: string) => {
    if (!q) return true;
    const hay = [r.displayName, r.aeOwner ?? "", r.partner ?? "", r.fdes.join(" ")]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };

  const sortRows = (a: CustomerRow, b: CustomerRow) => {
    if (sort === "arr") return (b.arr ?? -1) - (a.arr ?? -1);
    if (sort === "renew") {
      const av = a.renewalDate ? new Date(a.renewalDate).getTime() : Infinity;
      const bv = b.renewalDate ? new Date(b.renewalDate).getTime() : Infinity;
      return av - bv;
    }
    return a.displayName.localeCompare(b.displayName);
  };

  const q = query.trim().toLowerCase();

  const visibleZones = useMemo(() => {
    return ZONE_ORDER.filter((z) => zoneFilter === "all" || zoneFilter === z)
      .map((zone) => {
        const zoneRows = rows.filter((r) => r.zone === zone && matches(r, q)).sort(sortRows);
        return { zone, zoneRows };
      })
      .filter(({ zoneRows }) => zoneRows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, zoneFilter, q, sort]);

  const anyResults = visibleZones.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--muted-foreground)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts, AE, FDE, partner…"
            aria-label="Search customers"
            className="w-full h-9 pl-8 pr-3 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort customers"
          className="h-9 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-sm text-[color:var(--foreground)] px-2"
        >
          <option value="name">Sort: Name A–Z</option>
          <option value="arr">Sort: ARR high → low</option>
          <option value="renew">Sort: Renewal soonest</option>
        </select>
      </div>

      {/* Zone filter chips */}
      <div className="flex gap-2 flex-wrap">
        <ZoneChip
          label="All"
          count={rows.length}
          active={zoneFilter === "all"}
          onClick={() => setZoneFilter("all")}
        />
        {ZONE_ORDER.map((z) => (
          <ZoneChip
            key={z}
            label={z}
            count={zoneCounts[z] ?? 0}
            active={zoneFilter === z}
            onClick={() => setZoneFilter(z)}
          />
        ))}
      </div>

      {/* Zones */}
      {anyResults ? (
        visibleZones.map(({ zone, zoneRows }) => {
          const isCollapsed = !!collapsed[zone];
          return (
            <section key={zone} className={`space-y-2 ${zone === "Closed" ? "opacity-70" : ""}`}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [zone]: !c[zone] }))}
                aria-expanded={!isCollapsed}
                className="flex items-center gap-2 w-full text-left py-1"
              >
                <svg
                  className={`w-3.5 h-3.5 text-[color:var(--muted-foreground)] transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">{zone}</span>
                <span className="data-label text-[color:var(--muted-foreground)] tabular-nums">{zoneRows.length}</span>
                <span className="text-[10px] text-[color:var(--muted-foreground)] italic">{ZONE_DESC[zone]}</span>
              </button>
              {!isCollapsed ? (
                <div className="space-y-2">
                  {zoneRows.map((r) => (
                    <CustomerStrip key={r.key} row={r} />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      ) : (
        <div className="glass-card px-5 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
          No accounts match {query ? `“${query}”` : "this filter"}.
        </div>
      )}
    </div>
  );
}

function ZoneChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
        active
          ? "bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] border-[color:var(--brand-night)] dark:bg-[color:var(--brand-yellow)] dark:text-[color:var(--brand-night)] dark:border-[color:var(--brand-yellow)]"
          : "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)] hover:text-[color:var(--foreground)]"
      }`}
    >
      {label} <span className="tabular-nums opacity-70">({count})</span>
    </button>
  );
}
