"use client";

// One place for vocabularies, replacing "+ add new" in every field. Migration
// stage and Lifecycle are real Postgres enums (0021) — a new value there
// needs an additive migration, not a client-side list, so those two tabs are
// shown read-only with that explained rather than faking support the schema
// can't back. Roster and Colours are both genuinely live here: Roster POSTs
// to /api/roster, and Colours writes into the same colorMap every chip
// (table, board, lane dot) resolves through.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Configure dialog.

import { useEffect, useState } from "react";
import {
  MIGRATION_STAGES,
  MIGRATION_STAGE_LABELS,
  PROCESS_LIFECYCLES,
  PROCESS_HEALTHS,
  type MigrationStage,
  type ProcessHealth,
  type ProcessLifecycle,
  ROSTER_ROLES,
  CUSTOMER_CATEGORIES,
  type Customer,
  type RosterEntry,
  type RosterKind,
} from "@/lib/supabase/types";
import { HUES, hueStyle, resolveHue, type ColorField, type ColorMap, type Hue } from "@/lib/delivery/hues";
import { healthLabel, lifecycleLabel, stageLabel } from "@/lib/delivery/labels";

type Tab = "stages" | "lifecycle" | "roster" | "customers" | "colours";

const ROLE_LABELS: Record<string, string> = { fde: "FDE", tam: "TAM", engg: "Engineering" };

/** Display name -> the stable `key` slug. Mirrors what the existing seed and
 *  sync paths produce, so a customer added here joins to the same
 *  /customers/[key] route and integration lookups as an imported one. */
export function slugifyCustomerKey(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** A 401 here means the Auth0 session lapsed, which the middleware answers
 *  before the route ever runs — so there is no error body to show and the
 *  only useful instruction is "reload". Anything else is worth surfacing
 *  verbatim rather than as a blank list. */
function describeFetchFailure(status: number): string {
  if (status === 401 || status === 403) {
    return "Your session expired — reload the page to sign back in.";
  }
  return `Couldn't load this list (HTTP ${status}). Try reopening Configure.`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return s || name.slice(0, 2).toUpperCase() || "?";
}

const COLOR_FIELDS: { key: ColorField; label: string }[] = [
  { key: "stage", label: "Migration stage" },
  { key: "health", label: "Health" },
  { key: "lifecycle", label: "Lifecycle" },
];

const VALUES_BY_FIELD: Record<ColorField, readonly string[]> = {
  stage: MIGRATION_STAGES,
  health: PROCESS_HEALTHS,
  lifecycle: PROCESS_LIFECYCLES,
};

const VALUE_LABEL: Record<ColorField, (v: string) => string> = {
  stage: (v) => stageLabel(v as MigrationStage),
  health: (v) => healthLabel(v as ProcessHealth),
  lifecycle: (v) => lifecycleLabel(v as ProcessLifecycle),
};

export function ConfigureDialog({
  colorMap,
  onColorMapChange,
  onClose,
}: {
  colorMap: ColorMap;
  onColorMapChange: (next: ColorMap) => void;
  onClose: () => void;
}) {
  // Roster is the tab people actually come here for (stages/lifecycle are
  // fixed enums), so it opens first.
  const [tab, setTab] = useState<Tab>("roster");
  const [rosterKind, setRosterKind] = useState<RosterKind>("person");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [rosterLoading, setRosterLoading] = useState(false);
  const [newName, setNewName] = useState("");
  // Which row's inline editor is open, plus its uncommitted draft. One at a
  // time: two half-finished renames would be a way to lose an edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ display_name: string; roles: string[]; active: boolean }>({
    display_name: "",
    roles: [],
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [colorField, setColorField] = useState<ColorField>("stage");

  // Customers tab. Same shape as the roster above — customers ARE the
  // customer roster (41 rows, external IDs, a 360 page each), so this
  // deliberately reuses that interaction rather than inventing a second one.
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custCounts, setCustCounts] = useState<Record<string, number>>({});
  const [custLoading, setCustLoading] = useState(false);
  const [custEditingKey, setCustEditingKey] = useState<string | null>(null);
  const [custDraft, setCustDraft] = useState<{ display_name: string; custom_category: string; active: boolean }>({
    display_name: "",
    custom_category: "",
    active: true,
  });
  const [custSaving, setCustSaving] = useState(false);
  const [custError, setCustError] = useState<string | null>(null);
  const [showInactiveCust, setShowInactiveCust] = useState(false);
  const [newCustomer, setNewCustomer] = useState("");

  // Always loads leavers and counts: this is the management view, and the
  // leavers are exactly who you come here to edit. `showLeft` only controls
  // whether they're rendered, so toggling it costs no refetch.
  useEffect(() => {
    if (tab !== "roster") return;
    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);
    // A failed load must NOT fall through to an empty list. It used to
    // `.catch(() => setRoster([]))`, which rendered "Nobody here yet." — so
    // an expired Auth0 session (the middleware answers /api/roster with a
    // bare 401) looked exactly like an empty roster, and the whole tab
    // appeared to be broken or unbuilt. Reported 2026-09-04 and confirmed in
    // the Vercel logs: three 401s, then a 200 a minute later.
    fetch(`/api/roster?kind=${rosterKind}&include_inactive=1&counts=1`)
      .then(async (r) => {
        if (!r.ok) throw new Error(describeFetchFailure(r.status));
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setRoster(json.entries ?? []);
        setCounts(json.counts ?? {});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRoster([]);
        setRosterError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, rosterKind]);

  useEffect(() => {
    if (tab !== "customers") return;
    let cancelled = false;
    setCustLoading(true);
    setCustError(null);
    fetch("/api/customers/roster")
      .then(async (r) => {
        if (!r.ok) throw new Error(describeFetchFailure(r.status));
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setCustomers(json.customers ?? []);
        setCustCounts(json.counts ?? {});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCustomers([]);
        setCustError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setCustLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  function openCustEditor(c: Customer) {
    setCustError(null);
    setCustEditingKey(c.key);
    setCustDraft({
      display_name: c.display_name,
      custom_category: c.custom_category ?? "",
      active: c.active,
    });
  }

  async function saveCustEditor(c: Customer) {
    setCustSaving(true);
    setCustError(null);
    try {
      const res = await fetch("/api/customers/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: c.key, ...custDraft }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCustError(json.error || `HTTP ${res.status}`);
        return;
      }
      const updated = json.customer as Customer;
      setCustomers((cur) =>
        cur
          .map((x) => (x.key === updated.key ? updated : x))
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
      );
      if (!updated.active) setShowInactiveCust(true);
      setCustEditingKey(null);
    } catch (err) {
      setCustError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustSaving(false);
    }
  }

  async function addCustomer() {
    const display_name = newCustomer.trim();
    if (!display_name) return;
    setCustError(null);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `key` is the stable slug every integration and the /customers/[key]
      // route join on, so it's derived here rather than typed — a hand-typed
      // key with a space or capital in it would break those links silently.
      body: JSON.stringify({ key: slugifyCustomerKey(display_name), display_name }),
    });
    const json = await res.json();
    if (!res.ok) {
      setCustError(json.error || `HTTP ${res.status}`);
      return;
    }
    setCustomers((cur) =>
      [...cur, json.customer as Customer].sort((a, b) => a.display_name.localeCompare(b.display_name))
    );
    setNewCustomer("");
  }

  function openEditor(entry: RosterEntry) {
    setRosterError(null);
    setEditingId(entry.id);
    setDraft({ display_name: entry.display_name, roles: [...entry.roles], active: entry.active });
  }

  async function saveEditor(entry: RosterEntry) {
    setSaving(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/roster/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) {
        setRosterError(json.error || `HTTP ${res.status}`);
        return;
      }
      const updated = json.entry as RosterEntry;
      setRoster((cur) =>
        cur
          .map((r) => (r.id === updated.id ? updated : r))
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
      );
      // A leaver stays visible until the panel is reopened rather than
      // vanishing mid-edit, which would read as "did that save?".
      if (!updated.active) setShowLeft(true);
      setEditingId(null);
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const inactiveCustomers = customers.filter((c) => !c.active);
  const visibleCustomers = customers.filter(
    (c) => c.active || showInactiveCust || c.key === custEditingKey
  );

  const leavers = roster.filter((r) => !r.active);
  // A leaver being edited stays on screen regardless of the toggle, so the
  // row you are working on can't disappear from under you.
  const visibleRoster = roster.filter((r) => r.active || showLeft || r.id === editingId);

  function toggleDraftRole(role: string) {
    setDraft((cur) => ({
      ...cur,
      roles: cur.roles.includes(role) ? cur.roles.filter((r) => r !== role) : [...cur.roles, role],
    }));
  }

  async function addRosterEntry() {
    const display_name = newName.trim();
    if (!display_name) return;
    const res = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Both owner pickers filter by role (`?role=fde` / `?role=tam`), so a
      // person added with no roles would be invisible in exactly the places
      // this tab exists to populate.
      body: JSON.stringify({
        kind: rosterKind,
        display_name,
        roles: rosterKind === "person" ? ["fde", "tam"] : [],
      }),
    });
    const json = await res.json();
    if (res.ok) {
      setRoster((cur) => [...cur, json.entry as RosterEntry].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      setNewName("");
      setRosterError(null);
    } else {
      setRosterError(json.error || `HTTP ${res.status}`);
    }
  }

  function setHue(field: ColorField, value: string, hue: Hue) {
    onColorMapChange({ ...colorMap, [`${field}:${value}`]: hue });
  }

  function resetColors() {
    onColorMapChange({});
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="dops-rise-in w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[80vh]"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4">
          <div className="text-sm font-semibold text-[color:var(--foreground)] mb-2">Configure</div>
          {/* shrink-0 + overflow-x: five tabs no longer fit a max-w-lg
              dialog, and flex's default shrinking wrapped "Migration stages"
              onto two lines and pushed Customers out of easy reach. */}
          <div className="flex gap-4 border-b overflow-x-auto" style={{ borderColor: "var(--brand-metal-line)" }}>
            {(["roster", "customers", "colours", "stages", "lifecycle"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="dops-tab-underline pb-2 text-[13px] shrink-0 whitespace-nowrap"
                style={{
                  color: tab === t ? "var(--foreground)" : "var(--muted-foreground)",
                  borderBottom: tab === t ? "2px solid var(--yellow-ink)" : "2px solid transparent",
                }}
              >
                {t === "stages"
                  ? "Migration stages"
                  : t === "lifecycle"
                    ? "Lifecycle states"
                    : t === "roster"
                      ? "Roster"
                      : t === "customers"
                        ? "Customers"
                        : "Colours"}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          {tab === "stages" || tab === "lifecycle" ? (
            <div className="space-y-2">
              <div className="max-h-64 overflow-auto space-y-1">
                {(tab === "stages" ? MIGRATION_STAGES : PROCESS_LIFECYCLES).map((v) => (
                  <div key={v} className="rounded-md px-2.5 py-1.5 text-[13px] flex items-center gap-2" style={{ background: "var(--field)" }}>
                    <span className="text-[color:var(--foreground)]">
                      {tab === "stages" ? stageLabel(v as MigrationStage) : lifecycleLabel(v as ProcessLifecycle)}
                    </span>
                    <span className="font-mono text-[10.5px] text-[color:var(--muted-foreground)] ml-auto">{v}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)] pt-1">
                {tab === "stages" ? "Migration stage" : "Lifecycle"} is a fixed Postgres enum — adding a value here would need an
                additive schema migration, not a client-side list. Ping an engineer to add one.
              </div>
            </div>
          ) : null}

          {tab === "roster" ? (
            <div className="space-y-2">
              <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--brand-metal-line)" }}>
                <button
                  type="button"
                  onClick={() => setRosterKind("person")}
                  className="px-2.5 py-0.5 rounded-full text-[11px]"
                  style={rosterKind === "person" ? { background: "var(--yellow-soft)" } : undefined}
                >
                  People
                </button>
                <button
                  type="button"
                  onClick={() => setRosterKind("partner_org")}
                  className="px-2.5 py-0.5 rounded-full text-[11px]"
                  style={rosterKind === "partner_org" ? { background: "var(--yellow-soft)" } : undefined}
                >
                  Partners
                </button>
              </div>
              <div className="max-h-56 overflow-auto space-y-1">
                {rosterLoading ? (
                  <div className="text-[12px] text-[color:var(--muted-foreground)] py-2">Loading…</div>
                ) : visibleRoster.length === 0 ? (
                  <div className="text-[12px] text-[color:var(--muted-foreground)] py-2 italic">
                    {rosterError
                      ? "Couldn't load the roster — see below."
                      : roster.length === 0
                        ? "Nobody here yet."
                        : "Everyone here has left."}
                  </div>
                ) : (
                  visibleRoster.map((r) =>
                    editingId === r.id ? (
                      <div
                        key={r.id}
                        className="rounded-lg px-2.5 py-2.5 space-y-2.5"
                        style={{ background: "var(--surface-3, var(--field))", border: "1px solid var(--yellow-line)" }}
                      >
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5" htmlFor={`roster-name-${r.id}`}>
                            {r.kind === "person" ? "Display name" : "Organisation name"}
                          </label>
                          <input
                            id={`roster-name-${r.id}`}
                            autoFocus
                            value={draft.display_name}
                            onChange={(e) => setDraft((cur) => ({ ...cur, display_name: e.target.value }))}
                            className="dops-input w-full px-2 py-1 text-[13px]"
                          />
                        </div>

                        {/* Partner orgs hold no role — the pickers only ever
                            rank people by fde/tam/engg. */}
                        {r.kind === "person" ? (
                          <div>
                            <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">Roles</span>
                            <div className="flex gap-3 pt-0.5">
                              {ROSTER_ROLES.map((role) => (
                                <label key={role} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={draft.roles.includes(role)}
                                    onChange={() => toggleDraftRole(role)}
                                    style={{ accentColor: "var(--brand-yellow)" }}
                                  />
                                  <span
                                    style={{
                                      color: draft.roles.includes(role)
                                        ? "var(--foreground)"
                                        : "var(--muted-foreground)",
                                    }}
                                  >
                                    {ROLE_LABELS[role] ?? role}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <label className="flex items-center gap-2 text-[12px] cursor-pointer pt-0.5">
                          <input
                            type="checkbox"
                            checked={draft.active}
                            onChange={(e) => setDraft((cur) => ({ ...cur, active: e.target.checked }))}
                            style={{ accentColor: "var(--brand-yellow)" }}
                          />
                          <span style={{ color: draft.active ? "var(--foreground)" : "var(--muted-foreground)" }}>
                            {draft.active
                              ? r.kind === "person"
                                ? "Still at Kognitos"
                                : "Still a partner"
                              : "Has left — hidden from every dropdown"}
                          </span>
                        </label>

                        {/* The number is why this isn't a blind toggle. Their
                            existing work stays attributed to them, so it has
                            to be handed over somewhere — and that somewhere is
                            the table, where you can see the context. */}
                        {!draft.active && (counts[r.id] ?? 0) > 0 ? (
                          <div
                            className="rounded-md px-2.5 py-1.5 text-[11.5px]"
                            style={{
                              background: "var(--st-amber-bg)",
                              border: "1px solid var(--st-amber-bd)",
                              color: "var(--st-amber-fg)",
                            }}
                          >
                            Still assigned to {counts[r.id]} process{counts[r.id] === 1 ? "" : "es"}. Marking
                            them as left won&rsquo;t change that —{" "}
                            <a
                              className="underline"
                              // ?person=, not ?owner=: the count above spans FDE, TAM and
                              // engineering, and ?owner= only ever matched the FDE
                              // column — so for anyone who is purely a TAM the link
                              // landed on an empty table contradicting the warning.
                              href={`/delivery?person=${encodeURIComponent(r.display_name)}`}
                            >
                              open those in Delivery
                            </a>{" "}
                            to hand them over.
                          </div>
                        ) : null}

                        <div className="flex gap-2 justify-end pt-0.5">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-full px-3 py-1 text-[11.5px] border"
                            style={{ borderColor: "var(--brand-metal-line)", color: "var(--foreground)" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEditor(r)}
                            disabled={saving || !draft.display_name.trim()}
                            className="btn-primary rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-60"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={r.id}
                        className="rounded-md px-2.5 py-1.5 text-[13px] flex items-center gap-2"
                        style={{ background: "var(--field)", opacity: r.active ? 1 : 0.5 }}
                      >
                        <span
                          className="shrink-0 flex items-center justify-center text-[9px] font-semibold"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: r.kind === "person" ? 9999 : 5,
                            background: r.active ? "var(--brand-yellow)" : "var(--st-neutral-bd)",
                            color: r.active ? "#171717" : "var(--muted-foreground)",
                          }}
                        >
                          {initials(r.display_name)}
                        </span>
                        <span className="text-[color:var(--foreground)] truncate flex-1 min-w-0">
                          {r.display_name}
                        </span>
                        <span className="text-[10.5px] text-[color:var(--muted-foreground)] shrink-0">
                          {!r.active
                            ? "left"
                            : r.kind === "partner_org"
                              ? "Partner"
                              : r.roles.length > 0
                                ? r.roles.map((role) => ROLE_LABELS[role] ?? role).join(" · ")
                                : "No role"}
                        </span>
                        <span
                          className="shrink-0 text-[10.5px] rounded-full px-1.5 min-w-[26px] text-center"
                          style={{ background: "var(--glass-bg)", color: "var(--muted-foreground)" }}
                          title={`Assigned to ${counts[r.id] ?? 0} process${(counts[r.id] ?? 0) === 1 ? "" : "es"}`}
                        >
                          {counts[r.id] ?? 0}
                        </span>
                        <button
                          type="button"
                          onClick={() => openEditor(r)}
                          title="Edit name, roles, or mark as left"
                          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                        >
                          ⋯
                        </button>
                      </div>
                    )
                  )
                )}
              </div>
              {leavers.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowLeft((v) => !v)}
                  className="text-[11.5px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] text-left"
                >
                  {showLeft ? "▾ Hide" : "▸ Show"} the {leavers.length}{" "}
                  {rosterKind === "person" ? "who ha" : "which ha"}
                  {leavers.length === 1 ? "s" : "ve"} left
                </button>
              ) : null}

              {rosterError ? (
                <div className="text-[11.5px]" style={{ color: "var(--status-bad)" }}>
                  {rosterError}
                </div>
              ) : null}

              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={rosterKind === "person" ? "Add a person…" : "Add a partner organisation…"}
                  className="dops-input dops-input-dashed flex-1 px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: "var(--brand-metal-line)" }}
                />
                <button type="button" onClick={addRosterEntry} disabled={!newName.trim()} className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                  Add
                </button>
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)] pt-1 leading-snug">
                One roster for FDE, TAM and Partner — it backs every owner picker in the
                table, the board and the detail panel. Adding here (or via &ldquo;Add to
                roster&rdquo; in a picker) is the only way a new name enters the system, which
                is what stops the same person appearing under three spellings.
                Marking someone as left removes them from every dropdown but keeps their
                past work attributed to them; renaming follows through to every process
                they own.
              </div>
            </div>
          ) : null}

          {tab === "customers" ? (
            <div className="space-y-2">
              <div className="max-h-56 overflow-auto space-y-1">
                {custLoading ? (
                  <div className="text-[12px] text-[color:var(--muted-foreground)] py-2">Loading…</div>
                ) : visibleCustomers.length === 0 ? (
                  <div className="text-[12px] text-[color:var(--muted-foreground)] py-2 italic">
                    {custError
                      ? "Couldn't load customers — see below."
                      : customers.length === 0
                        ? "No customers yet."
                        : "Every customer is inactive."}
                  </div>
                ) : (
                  visibleCustomers.map((c) =>
                    custEditingKey === c.key ? (
                      <div
                        key={c.key}
                        className="rounded-lg px-2.5 py-2.5 space-y-2.5"
                        style={{ background: "var(--surface-3, var(--field))", border: "1px solid var(--yellow-line)" }}
                      >
                        <div>
                          <label
                            className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5"
                            htmlFor={`cust-name-${c.key}`}
                          >
                            Customer name
                          </label>
                          <input
                            id={`cust-name-${c.key}`}
                            autoFocus
                            value={custDraft.display_name}
                            onChange={(e) => setCustDraft((cur) => ({ ...cur, display_name: e.target.value }))}
                            className="dops-input w-full px-2 py-1 text-[13px]"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5"
                            htmlFor={`cust-cat-${c.key}`}
                          >
                            Category
                          </label>
                          <select
                            id={`cust-cat-${c.key}`}
                            value={custDraft.custom_category}
                            onChange={(e) => setCustDraft((cur) => ({ ...cur, custom_category: e.target.value }))}
                            className="dops-field text-[13px]"
                          >
                            <option value="">—</option>
                            {CUSTOMER_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>

                        <label className="flex items-center gap-2 text-[12px] cursor-pointer pt-0.5">
                          <input
                            type="checkbox"
                            checked={custDraft.active}
                            onChange={(e) => setCustDraft((cur) => ({ ...cur, active: e.target.checked }))}
                            style={{ accentColor: "var(--brand-yellow)" }}
                          />
                          <span style={{ color: custDraft.active ? "var(--foreground)" : "var(--muted-foreground)" }}>
                            {custDraft.active ? "Still a customer" : "No longer a customer — hidden from every dropdown"}
                          </span>
                        </label>

                        {/* Category and active are independent on purpose: a
                            customer can be At Risk and still very much
                            active. The only thing `active` controls is
                            whether they can be picked for new work. */}
                        {!custDraft.active && (custCounts[c.id] ?? 0) > 0 ? (
                          <div
                            className="rounded-md px-2.5 py-1.5 text-[11.5px]"
                            style={{
                              background: "var(--st-amber-bg)",
                              border: "1px solid var(--st-amber-bd)",
                              color: "var(--st-amber-fg)",
                            }}
                          >
                            Keeps its {custCounts[c.id]} process{custCounts[c.id] === 1 ? "" : "es"} and its
                            customer page — it just can&rsquo;t be picked for new work.
                          </div>
                        ) : null}

                        <div className="flex gap-2 justify-end pt-0.5">
                          <button
                            type="button"
                            onClick={() => setCustEditingKey(null)}
                            className="rounded-full px-3 py-1 text-[11.5px] border"
                            style={{ borderColor: "var(--brand-metal-line)", color: "var(--foreground)" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveCustEditor(c)}
                            disabled={custSaving || !custDraft.display_name.trim()}
                            className="btn-primary rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-60"
                          >
                            {custSaving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={c.key}
                        className="rounded-md px-2.5 py-1.5 text-[13px] flex items-center gap-2"
                        style={{ background: "var(--field)", opacity: c.active ? 1 : 0.5 }}
                      >
                        <span
                          className="shrink-0 rounded-full"
                          style={{
                            width: 8,
                            height: 8,
                            background: c.active ? "var(--status-good)" : "var(--st-neutral-bd)",
                          }}
                        />
                        <span className="text-[color:var(--foreground)] truncate flex-1 min-w-0">
                          {c.display_name}
                        </span>
                        <span className="text-[10.5px] text-[color:var(--muted-foreground)] shrink-0">
                          {c.custom_category ?? "No category"}
                          {c.active ? "" : " · inactive"}
                        </span>
                        <span
                          className="shrink-0 text-[10.5px] rounded-full px-1.5 min-w-[26px] text-center"
                          style={{ background: "var(--glass-bg)", color: "var(--muted-foreground)" }}
                          title={`${custCounts[c.id] ?? 0} process${(custCounts[c.id] ?? 0) === 1 ? "" : "es"}`}
                        >
                          {custCounts[c.id] ?? 0}
                        </span>
                        <button
                          type="button"
                          onClick={() => openCustEditor(c)}
                          title="Edit name, category, or mark as no longer a customer"
                          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
                        >
                          ⋯
                        </button>
                      </div>
                    )
                  )
                )}
              </div>

              {inactiveCustomers.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowInactiveCust((v) => !v)}
                  className="text-[11.5px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] text-left"
                >
                  {showInactiveCust ? "▾ Hide" : "▸ Show"} the {inactiveCustomers.length} inactive
                </button>
              ) : null}

              {custError ? (
                <div className="text-[11.5px]" style={{ color: "var(--status-bad)" }}>
                  {custError}
                </div>
              ) : null}

              <div className="flex gap-2">
                <input
                  value={newCustomer}
                  onChange={(e) => setNewCustomer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addCustomer();
                  }}
                  placeholder="Add a customer…"
                  className="dops-input dops-input-dashed flex-1 px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: "var(--brand-metal-line)" }}
                />
                <button
                  type="button"
                  onClick={() => void addCustomer()}
                  disabled={!newCustomer.trim()}
                  className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                >
                  Add
                </button>
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)] pt-1 leading-snug">
                This is the customer roster — it backs every customer dropdown in the table, the
                board and the detail panel. Marking one inactive removes it from those dropdowns
                but keeps its processes and its customer page, so history stays intact.
                Category is a reporting bucket and stays independent: a customer can be At Risk
                and still active.
              </div>
            </div>
          ) : null}

          {tab === "colours" ? (
            <div className="space-y-2">
              <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--brand-metal-line)" }}>
                {COLOR_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setColorField(f.key)}
                    className="px-2.5 py-0.5 rounded-full text-[11px]"
                    style={colorField === f.key ? { background: "var(--yellow-soft)" } : undefined}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="max-h-64 overflow-auto space-y-1.5">
                {VALUES_BY_FIELD[colorField].map((v) => {
                  const hue = resolveHue(colorField, v, colorMap);
                  return (
                    <div key={v} className="flex items-center gap-2">
                      <span className="w-[132px] shrink-0 text-[11px] px-2 py-1 rounded border truncate" style={hueStyle(hue)}>
                        {VALUE_LABEL[colorField](v)}
                      </span>
                      <div className="flex gap-1">
                        {HUES.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setHue(colorField, v, h)}
                            title={h}
                            className="w-[17px] h-[17px] rounded-[5px] transition-transform hover:scale-[1.18]"
                            style={{
                              background: `var(--st-${h}-fg)`,
                              boxShadow: hue === h ? "0 0 0 2px var(--foreground)" : "none",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-[11px] text-[color:var(--muted-foreground)]">
                  Colours are per value, not per row. They follow the value everywhere — table, board, rollup.
                </div>
                <button type="button" onClick={resetColors} className="text-[11px] underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] shrink-0 ml-2">
                  Reset
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t flex justify-end" style={{ borderColor: "var(--brand-metal-line)" }}>
          <button type="button" onClick={onClose} className="btn-primary rounded-full px-4 py-1.5 text-xs font-semibold">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
