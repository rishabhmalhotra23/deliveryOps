"use client";

// Interactive Customers browser. Server builds a flat, serializable row list
// (one CustomerRow per account, with category + zone precomputed) and hands it
// here. This component owns the client-side experience: live search, sort,
// zone filtering, and collapsible zones. No data fetching here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CustomerAvatar } from "@/app/_components/customer-avatar";
import { formatMoney } from "@/app/_components/brand";
import { FALLBACK_ZONES, type Zone } from "@/app/_components/brand";
import type { CustomerVocabulary } from "@/lib/vocabulary/store";
import { CustomerConfigDialog } from "./customer-config-dialog";
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
  staleCount: number;
  /** 0039. False = no longer a customer. Hidden from this list by default —
   *  it was not carried here at all before 2026-09-08, which is why 24 of 41
   *  production customers were retired and the page showed all 41 alike. */
  active: boolean;
  /** Live processes still attached. A retired customer with live work is a
   *  contradiction worth surfacing rather than hiding. */
  liveProcesses: number;
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

/** Why a row is contradictory, or null. Shared by the filter chip and the row
 *  badge so the two can never disagree — the first version counted rows in the
 *  chip that carried no marker, which is worse than not flagging them at all.
 *
 *  Two shapes, both real in production on 2026-09-08:
 *    - retired with live work (Halemeyer, 2 live, categorised To Drop)
 *    - still a customer, but its category files it under a closed zone
 *      (Bradley & Beams, To Drop, active, 4 live) */
export function contradictionFor(
  row: { active: boolean; liveProcesses: number; zone: string },
  zones: { value: string }[]
): string | null {
  const closedExists = zones.some((z) => z.value === "closed");
  if (!row.active && row.liveProcesses > 0) {
    return `Marked as no longer a customer, but ${row.liveProcesses} process${row.liveProcesses === 1 ? " is" : "es are"} still live`;
  }
  if (row.active && closedExists && row.zone === "closed" && row.liveProcesses > 0) {
    return `Still a customer with ${row.liveProcesses} live process${row.liveProcesses === 1 ? "" : "es"}, but its category files it under a closed zone`;
  }
  return null;
}

/** The 8 --st-* chip hues, as the inline style the chips already use. Lets a
 *  category minted in the product carry a real colour instead of falling
 *  through CATEGORY_VARIANT to grey. */
function hueChipStyle(hue: string | null): React.CSSProperties | undefined {
  if (!hue) return undefined;
  return {
    color: `var(--st-${hue}-fg)`,
    background: `var(--st-${hue}-bg)`,
    borderColor: `var(--st-${hue}-bd)`,
  };
}

function CustomerStrip({
  row,
  vocabulary,
}: {
  row: CustomerRow;
  vocabulary: CustomerVocabulary;
}) {
  const zone = vocabulary.zones.find((z) => z.value === row.zone);
  const isClosed = row.zone === "closed";
  const categoryDef = vocabulary.categories.find((c) => c.value === row.category);
  // DB hue first, then the compiled CATEGORY_VARIANT, then grey — the same
  // layering resolveHue() uses, so a category with no row degrades to today's
  // appearance rather than to nothing.
  const hueStyle = hueChipStyle(categoryDef?.hue ?? null);
  const catStyle = hueStyle
    ? ""
    : CATEGORY_VARIANT[row.category] ??
      "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]";
  const urgency = renewalUrgency(row.renewalDate);
  const contradiction = contradictionFor(row, vocabulary.zones);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  void zone;

  /** Retire, restore, or re-file a customer.
   *
   *  Goes through the record card's own POST /api/customers/[key]/manual-update
   *  rather than the Configure tab's PATCH /api/customers/roster, which this
   *  change deletes. One route means one allow-list, one field_provenance write
   *  and one audit event (CATEGORY_CHANGED / PROFILE_UPDATED) instead of two
   *  that drift — Configure's route was silently skipping the audit event the
   *  360 page has always logged. */
  async function save(field: string, value: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/customers/${row.key}/manual-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      if (res.ok) {
        setMenuOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
    <Link
      href={`/customers/${row.key}`}
      className="group glass-card glass-card-hover flex items-center gap-4 pl-4 pr-10 py-3 transition-all"
      style={row.active ? undefined : { opacity: 0.62 }}
    >
      <CustomerAvatar
        name={row.displayName}
        logoUrl={row.logoUrl}
        domain={row.domain}
        category={row.category}
        size="sm"
        dimmed={isClosed || !row.active}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]"
            title={row.displayName}
          >
            {row.displayName}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${catStyle}`}
            style={hueStyle}
          >
            {categoryDef?.label ?? row.category}
          </span>
          {row.partner && row.category !== "Partner Managed" ? (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
              title={`Partner-managed via ${row.partner}`}
            >
              Partner Managed
            </span>
          ) : null}
          {/* `active` was not carried to this list at all before 2026-09-08.
              Retired rows only appear behind the toggle, so the marker is here
              to say why they look different rather than to filter them. */}
          {!row.active ? (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
              style={{
                color: "var(--st-neutral-fg)",
                background: "var(--st-neutral-bg)",
                borderColor: "var(--st-neutral-bd)",
              }}
              title="Marked as no longer a customer — hidden from every customer picker in Delivery"
            >
              No longer a customer
            </span>
          ) : null}
          {/* Same helper the Contradictions chip counts through, so a row the
              chip includes always carries a marker explaining why. */}
          {contradiction ? (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
              style={{
                color: "var(--st-amber-fg)",
                background: "var(--st-amber-bg)",
                borderColor: "var(--st-amber-bd)",
              }}
              title={contradiction}
            >
              ⚠ {row.liveProcesses} live
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
        {row.staleCount > 0 ? (
          <span
            title={`${row.staleCount} field(s) haven't been confirmed recently`}
            className="data-label px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
          >
            {row.staleCount} stale
          </span>
        ) : null}
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

      {/* Sibling of the Link, not a child: the whole strip is an anchor, so a
          nested button would be invalid markup and would navigate on click. */}
      <button
        type="button"
        aria-label={`Manage ${row.displayName}`}
        title={`Manage ${row.displayName}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
      >
        ⋯
      </button>

      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div
            className="dops-rise-in absolute right-1 top-full z-30 mt-1 w-64 rounded-md border shadow-lg py-1"
            style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
              {row.displayName}
            </div>
            <div className="px-3 py-1">
              <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                Category
              </span>
              <select
                value={row.category}
                disabled={busy}
                onChange={(e) => void save("custom_category", e.target.value || null)}
                className="dops-field w-full text-[12.5px]"
              >
                <option value="">—</option>
                {/* Retired categories still list when a customer holds one, so
                    an edit elsewhere in the menu can't silently reassign it. */}
                {vocabulary.categories
                  .filter((c) => c.active || c.value === row.category)
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                      {c.active ? "" : " (retired)"}
                    </option>
                  ))}
              </select>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save("active", row.active ? "false" : "true")}
              className="w-full text-left px-3 py-1.5 mt-1 text-[12.5px] border-t hover:bg-[var(--glass-bg)] disabled:opacity-60"
              style={{
                borderColor: "var(--glass-border)",
                color: row.active ? "var(--st-amber-fg)" : "var(--st-emerald-fg)",
              }}
              title={
                row.active
                  ? "Removes them from every customer picker in Delivery. Processes and history stay."
                  : "Puts them back in every customer picker."
              }
            >
              {busy
                ? "Saving…"
                : row.active
                  ? "Mark as no longer a customer"
                  : "Restore as a customer"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function CustomersBrowser({
  rows,
  vocabulary,
}: {
  rows: CustomerRow[];
  /** Zones and categories from vocabulary_values (0045). Threaded in rather
   *  than fetched: this is a client component, and it is the convention every
   *  other map in the app follows. */
  vocabulary: CustomerVocabulary;
}) {
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState<Zone | "all">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [collapsed, setCollapsed] = useState<Partial<Record<Zone, boolean>>>({});
  const [attentionOnly, setAttentionOnly] = useState(false);
  // Retired customers are hidden by default, the same call Configure -> Roster
  // makes for people who have left. Their 360 pages stay reachable by URL and
  // by search either way, so this is a list default and not a restriction.
  const [showRetired, setShowRetired] = useState(false);
  // Its own state, not attentionOnly's. Sharing one made the two chips the
  // same filter, and since "Needs attention" matches every row with a stale
  // field (41 of 41 in production) the contradictions chip narrowed nothing.
  const [contradictionsOnly, setContradictionsOnly] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const router = useRouter();

  /** Creates a customer through the existing POST /api/customers, which
   *  slugifies the key server-side. Moved here from Delivery -> Configure so
   *  every customer action lives on the customer page. */
  async function addCustomer() {
    const display_name = newName.trim();
    if (!display_name) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAddError(json.error || `HTTP ${res.status}`);
        return;
      }
      setNewName("");
      setAdding(false);
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }

  const zones = useMemo(
    () => (vocabulary.zones.length > 0 ? vocabulary.zones.filter((z) => z.active) : FALLBACK_ZONES),
    [vocabulary.zones]
  );

  /** The rows this list is about, before search, sort or zone filtering. */
  // Filtering to contradictions reveals retired rows regardless of the toggle:
  // 6 of the 6 in production are retired, so respecting the toggle would show
  // an empty list from a chip that says there are 6.
  const scoped = useMemo(
    () => rows.filter((r) => r.active || showRetired || contradictionsOnly),
    [rows, showRetired, contradictionsOnly]
  );
  const retiredCount = useMemo(() => rows.filter((r) => !r.active).length, [rows]);

  // Per-zone counts for the filter chips, over the scoped set so a chip never
  // promises rows the list won't show.
  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of scoped) counts[r.zone] = (counts[r.zone] ?? 0) + 1;
    return counts;
  }, [scoped]);

  const attentionCount = useMemo(() => rows.filter((r) => r.staleCount > 0).length, [rows]);

  /** Retired with work still running, or active but filed under a Closed zone.
   *  Six customers in production on 2026-09-08 — surfaced as a filter because
   *  whether each is a stale category or a real wind-down is a judgement about
   *  the customer, not something the app should decide. */
  const contradictions = useMemo(
    () => rows.filter((r) => contradictionFor(r, vocabulary.zones) !== null),
    [rows, vocabulary.zones]
  );

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

  const contradictionKeys = useMemo(
    () => new Set(contradictions.map((r) => r.key)),
    [contradictions]
  );

  const visibleZones = useMemo(() => {
    return zones
      .filter((z) => zoneFilter === "all" || zoneFilter === z.value)
      .map((z) => {
        const zoneRows = scoped
          .filter(
            (r) =>
              r.zone === z.value &&
              matches(r, q) &&
              (!attentionOnly || r.staleCount > 0) &&
              (!contradictionsOnly || contradictionKeys.has(r.key))
          )
          .sort(sortRows);
        return { zone: z, zoneRows };
      })
      .filter(({ zoneRows }) => zoneRows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, zones, zoneFilter, q, sort, attentionOnly, contradictionsOnly, contradictionKeys]);

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
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="btn-primary rounded-md px-3 h-9 text-sm font-semibold"
        >
          + Add customer
        </button>
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          className="h-9 rounded-md border px-3 text-sm"
          style={{ borderColor: "var(--yellow-line)", color: "var(--yellow-ink)" }}
          title="Edit zones, category colours and which zone each category rolls up into"
        >
          ⚙ Categories
        </button>
      </div>

      {adding ? (
        <div
          className="rounded-lg border px-3 py-2.5 flex flex-wrap gap-2 items-center"
          style={{ borderColor: "var(--yellow-line)", background: "var(--glass-bg)" }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCustomer();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Customer name…"
            className="dops-input flex-1 min-w-[200px] px-2 py-1.5 text-[13px]"
          />
          <button
            type="button"
            disabled={addBusy || !newName.trim()}
            onClick={() => void addCustomer()}
            className="btn-primary rounded-full px-4 py-1.5 text-[12px] font-semibold disabled:opacity-60"
          >
            {addBusy ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded-full border px-3 py-1.5 text-[12px]"
            style={{ borderColor: "var(--glass-border)", color: "var(--foreground)" }}
          >
            Cancel
          </button>
          {addError ? (
            <span className="text-[12px] w-full" style={{ color: "var(--st-red-fg)" }}>
              {addError}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Zone filter chips */}
      <div className="flex gap-2 flex-wrap">
        <ZoneChip
          label="All"
          count={scoped.length}
          active={zoneFilter === "all"}
          onClick={() => setZoneFilter("all")}
        />
        {zones.map((z) => (
          <ZoneChip
            key={z.value}
            label={z.label}
            count={zoneCounts[z.value] ?? 0}
            active={zoneFilter === z.value}
            onClick={() => setZoneFilter(z.value)}
          />
        ))}
        {contradictions.length > 0 ? (
          <button
            type="button"
            onClick={() => setContradictionsOnly((v) => !v)}
            title="Retired customers that still have live processes, or live work filed under a closed zone"
            className={`data-label px-2.5 py-1 rounded-full border transition-colors ${
              contradictionsOnly
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40"
                : "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)] hover:text-[color:var(--foreground)]"
            }`}
          >
            ⚠ Contradictions · {contradictions.length}
          </button>
        ) : null}
        {attentionCount > 0 ? (
          <button
            type="button"
            onClick={() => setAttentionOnly((v) => !v)}
            className={`data-label px-2.5 py-1 rounded-full border transition-colors ${
              attentionOnly
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40"
                : "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)] hover:text-[color:var(--foreground)]"
            }`}
          >
            Needs attention · {attentionCount}
          </button>
        ) : null}
      </div>

      {/* Zones */}
      {anyResults ? (
        visibleZones.map(({ zone, zoneRows }) => {
          const isCollapsed = !!collapsed[zone.value];
          return (
            <section key={zone.value} className={`space-y-2 ${zone.value === "closed" ? "opacity-70" : ""}`}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [zone.value]: !c[zone.value] }))}
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
                {/* Label and sub-label both come from vocabulary_values (0045)
                    so the group headers are editable — they were compiled into
                    ZONE_ORDER/ZONE_DESC until 2026-09-08. */}
                <span className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">{zone.label}</span>
                <span className="data-label text-[color:var(--muted-foreground)] tabular-nums">{zoneRows.length}</span>
                {zone.description ? (
                  <span className="text-[10px] text-[color:var(--muted-foreground)] italic">{zone.description}</span>
                ) : null}
              </button>
              {!isCollapsed ? (
                <div className="space-y-2">
                  {zoneRows.map((r) => (
                    <CustomerStrip key={r.key} row={r} vocabulary={vocabulary} />
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

      {/* Retired customers, hidden by default. Same call Configure -> Roster
          makes for people who have left: 24 of 41 production customers were
          retired on 2026-09-08 and this list showed all 41 alike, so the
          default view was more than half noise. Their 360 pages stay reachable
          by URL and by search either way — this is a list default, not a
          restriction. */}
      {retiredCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowRetired((v) => !v)}
          className="w-full text-left rounded-lg border px-3 py-2 text-[12.5px]"
          style={{ borderColor: "var(--glass-border)", color: "var(--yellow-ink)", background: "var(--glass-bg)" }}
        >
          {showRetired ? "▾ Hide" : "▸ Show"} the {retiredCount} no longer customer
          {retiredCount === 1 ? "" : "s"}
        </button>
      ) : null}

      {configOpen ? (
        <CustomerConfigDialog
          initial={vocabulary}
          onClose={() => {
            setConfigOpen(false);
            // Zones, colours and roll-ups all arrive in the server payload, so
            // the refresh is what makes an edit visible behind the dialog.
            router.refresh();
          }}
        />
      ) : null}
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
