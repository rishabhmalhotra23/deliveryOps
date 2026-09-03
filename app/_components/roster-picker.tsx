"use client";

// One control for FDE, TAM and Partner. Types ahead against `roster_entries`
// (+ `roster_aliases`, so old spellings like "karthik n" keep resolving),
// and the only path to a new value is an explicit "Add to roster" — never a
// free-text field — so a stray spelling can never re-enter the system.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Roster picker panel.

import { useEffect, useRef, useState } from "react";
import type { RosterEntry, RosterKind, RosterRole } from "@/lib/supabase/types";

interface RosterHit extends RosterEntry {
  matched_alias?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return s || name.slice(0, 2).toUpperCase() || "?";
}

export function RosterPicker({
  kind,
  role,
  valueLabel,
  onPick,
  onClear,
  dense = false,
}: {
  kind: RosterKind;
  role?: RosterRole;
  /** Current display name (the denormalized text mirror), or null. */
  valueLabel: string | null;
  onPick: (entry: RosterEntry) => void;
  onClear?: () => void;
  dense?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RosterHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ kind });
      if (role) params.set("role", role);
      if (query.trim()) params.set("q", query.trim());
      setBusy(true);
      fetch(`/api/roster?${params}`)
        .then((r) => r.json())
        .then((json) => setResults(json.entries ?? []))
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 180);
    return () => clearTimeout(t);
  }, [editing, query, kind, role]);

  useEffect(() => {
    if (!editing) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setEditing(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [editing]);

  // The results panel is position:fixed, measured off the input: inside a
  // table cell an absolutely-positioned panel gets clipped by the table's
  // own overflow:auto scrollport. Any scroll dismisses it rather than leaving
  // it stranded away from its input.
  useEffect(() => {
    if (!editing) {
      setMenuPos(null);
      return;
    }
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = 288;
      setMenuPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.min(rect.bottom + 4, window.innerHeight - 300),
      });
    }
    place();
    function onScroll() {
      setEditing(false);
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editing]);

  async function addToRoster() {
    const display_name = query.trim() || (kind === "person" ? "New teammate" : "New partner");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, display_name, roles: role ? [role] : [] }),
      });
      const json = await res.json();
      // A 409 means the name exists but didn't match this picker's role
      // filter — surface it instead of leaving the dropdown sitting there.
      if (!res.ok) {
        setError(
          res.status === 409
            ? `"${display_name}" is already in the roster — it may not hold the ${role ?? "required"} role.`
            : json.error || `HTTP ${res.status}`
        );
        return;
      }
      onPick(json.entry as RosterEntry);
      setJustAdded(true);
      setEditing(false);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const avatarRadius = kind === "person" ? 9999 : 6;
  const avatarSize = dense ? 18 : 22;

  if (!editing) {
    return (
      <div className={`flex items-center gap-1 ${dense ? "" : "w-full"}`}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`flex items-center gap-1.5 min-w-0 flex-1 text-left rounded transition-colors hover:bg-[var(--glass-bg)] ${
            dense ? "px-1 py-0.5" : "px-2 py-1.5 border border-transparent hover:border-[var(--brand-metal-line)]"
          }`}
        >
          {valueLabel ? (
            <>
              <span
                className="shrink-0 flex items-center justify-center text-[9px] font-semibold"
                style={{ width: avatarSize, height: avatarSize, borderRadius: avatarRadius, background: "var(--brand-yellow)", color: "#171717" }}
              >
                {initials(valueLabel)}
              </span>
              <span className="truncate text-[color:var(--foreground)]">{valueLabel}</span>
            </>
          ) : (
            <span className="text-[color:var(--muted-foreground)]">—</span>
          )}
        </button>
        {justAdded ? (
          <span className="shrink-0 text-[10px]" style={{ color: "var(--yellow-ink)" }} title="Available on every process from now on">
            added
          </span>
        ) : null}
        {valueLabel && onClear ? (
          <button
            type="button"
            onClick={onClear}
            title="Clear"
            className="shrink-0 text-[11px] opacity-40 hover:opacity-100 hover:text-red-500 px-1"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={kind === "person" ? 'Search people — try "karthik n"' : "Search partner organisations"}
        className="dops-input dops-input-accent w-full min-w-[180px] px-2 py-1 text-[13px]"
        style={{ borderColor: "var(--yellow-line)" }}
      />
      <div
        className="dops-rise-in fixed z-50 w-72 max-h-72 overflow-auto rounded-md border shadow-lg"
        style={{
          left: menuPos?.left ?? 0,
          top: menuPos?.top ?? 0,
          visibility: menuPos ? "visible" : "hidden",
          background: "var(--surface-3, var(--card))",
          borderColor: "var(--brand-metal-line)",
        }}
      >
        {error ? (
          <div className="px-2.5 py-2 text-[11.5px]" style={{ color: "var(--status-bad)" }}>
            {error}
          </div>
        ) : null}
        {results.length === 0 && !busy ? (
          <div className="px-2.5 py-2 text-[12px] text-[color:var(--muted-foreground)]">
            Nobody in the roster matches &quot;{query}&quot;.
          </div>
        ) : (
          results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onPick(r);
                setEditing(false);
                setQuery("");
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--glass-bg)]"
            >
              <span
                className="shrink-0 flex items-center justify-center text-[9px] font-semibold"
                style={{ width: 22, height: 22, borderRadius: avatarRadius, background: "var(--brand-yellow)", color: "#171717" }}
              >
                {initials(r.display_name)}
              </span>
              <span className="flex-1 min-w-0">
                <div className="text-[12.5px] text-[color:var(--foreground)] truncate">{r.display_name}</div>
                <div className="text-[10.5px] text-[color:var(--muted-foreground)] truncate">
                  {r.kind === "partner_org" ? "Partner" : r.roles.join(" · ") || "—"}
                </div>
              </span>
              {r.matched_alias ? (
                <span className="text-[10px] shrink-0" style={{ color: "var(--yellow-ink)" }}>
                  matched &quot;{r.matched_alias}&quot;
                </span>
              ) : null}
            </button>
          ))
        )}
        <button
          type="button"
          onClick={addToRoster}
          disabled={busy}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-left border-t disabled:opacity-60"
          style={{ borderColor: "var(--brand-metal-line)", background: "var(--field)" }}
        >
          <span
            className="shrink-0 flex items-center justify-center border border-dashed rounded text-[12px]"
            style={{ width: 24, height: 24, borderColor: "var(--brand-metal-line)" }}
          >
            +
          </span>
          <span className="text-[12px] text-[color:var(--foreground)]">
            Add {query.trim() || (kind === "person" ? "a new person" : "a new partner organisation")} to the roster
          </span>
        </button>
      </div>
      {justAdded ? (
        <div className="mt-1 text-[10.5px]" style={{ color: "var(--yellow-ink)" }}>
          Added to the roster — available on every process from now on.
        </div>
      ) : null}
    </div>
  );
}
