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
  type RosterEntry,
  type RosterKind,
} from "@/lib/supabase/types";
import { HUES, hueStyle, resolveHue, type ColorField, type ColorMap, type Hue } from "@/lib/delivery/hues";
import { healthLabel, lifecycleLabel, stageLabel } from "@/lib/delivery/labels";

type Tab = "stages" | "lifecycle" | "roster" | "colours";

const ROLE_LABELS: Record<string, string> = { fde: "FDE", tam: "TAM", engg: "Engineering" };

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
  const [rosterLoading, setRosterLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [colorField, setColorField] = useState<ColorField>("stage");

  useEffect(() => {
    if (tab !== "roster") return;
    setRosterLoading(true);
    fetch(`/api/roster?kind=${rosterKind}`)
      .then((r) => r.json())
      .then((json) => setRoster(json.entries ?? []))
      .catch(() => setRoster([]))
      .finally(() => setRosterLoading(false));
  }, [tab, rosterKind]);

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
          <div className="flex gap-4 border-b" style={{ borderColor: "var(--brand-metal-line)" }}>
            {(["roster", "colours", "stages", "lifecycle"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="dops-tab-underline pb-2 text-[13px]"
                style={{
                  color: tab === t ? "var(--foreground)" : "var(--muted-foreground)",
                  borderBottom: tab === t ? "2px solid var(--yellow-ink)" : "2px solid transparent",
                }}
              >
                {t === "stages" ? "Migration stages" : t === "lifecycle" ? "Lifecycle states" : t === "roster" ? "Roster" : "Colours"}
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
                ) : roster.length === 0 ? (
                  <div className="text-[12px] text-[color:var(--muted-foreground)] py-2 italic">Nobody here yet.</div>
                ) : (
                  roster.map((r) => (
                    <div key={r.id} className="rounded-md px-2.5 py-1.5 text-[13px] flex items-center gap-2" style={{ background: "var(--field)" }}>
                      <span
                        className="shrink-0 flex items-center justify-center text-[9px] font-semibold"
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: r.kind === "person" ? 9999 : 5,
                          background: "var(--brand-yellow)",
                          color: "#171717",
                        }}
                      >
                        {initials(r.display_name)}
                      </span>
                      <span className="text-[color:var(--foreground)] truncate">{r.display_name}</span>
                      <span className="text-[10.5px] text-[color:var(--muted-foreground)] ml-auto shrink-0">
                        {r.roles.length > 0 ? r.roles.map((role) => ROLE_LABELS[role] ?? role).join(" · ") : "No role"}
                      </span>
                    </div>
                  ))
                )}
              </div>
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
