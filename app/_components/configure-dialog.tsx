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
  type RosterEntry,
  type RosterKind,
} from "@/lib/supabase/types";
import { HUES, hueStyle, resolveHue, type ColorField, type ColorMap, type Hue } from "@/lib/delivery/hues";

type Tab = "stages" | "lifecycle" | "roster" | "colours";

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
  stage: (v) => MIGRATION_STAGE_LABELS[v as keyof typeof MIGRATION_STAGE_LABELS],
  health: (v) => v.replace(/_/g, " "),
  lifecycle: (v) => v.replace(/_/g, " "),
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
  const [tab, setTab] = useState<Tab>("stages");
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
      body: JSON.stringify({ kind: rosterKind, display_name }),
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
          <div className="flex gap-4 border-b" style={{ borderColor: "var(--glass-border)" }}>
            {(["stages", "lifecycle", "roster", "colours"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="pb-2 text-[13px] capitalize"
                style={{
                  color: tab === t ? "var(--foreground)" : "var(--muted-foreground)",
                  borderBottom: tab === t ? "2px solid var(--yellow-ink)" : "2px solid transparent",
                }}
              >
                {t === "stages" ? "Migration stages" : t === "lifecycle" ? "Lifecycle states" : t}
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
                      {tab === "stages" ? MIGRATION_STAGE_LABELS[v as keyof typeof MIGRATION_STAGE_LABELS] : v.replace(/_/g, " ")}
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
              <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
                <button
                  type="button"
                  onClick={() => setRosterKind("person")}
                  className="px-2.5 py-0.5 rounded-full text-[11px]"
                  style={rosterKind === "person" ? { background: "rgba(242,255,112,0.18)" } : undefined}
                >
                  People
                </button>
                <button
                  type="button"
                  onClick={() => setRosterKind("partner_org")}
                  className="px-2.5 py-0.5 rounded-full text-[11px]"
                  style={rosterKind === "partner_org" ? { background: "rgba(242,255,112,0.18)" } : undefined}
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
                      <span className="text-[color:var(--foreground)]">{r.display_name}</span>
                      <span className="font-mono text-[10.5px] text-[color:var(--muted-foreground)] ml-auto">
                        {r.roles.join(", ") || "roster_entries"}
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
                  className="flex-1 rounded-md border border-dashed px-2.5 py-1.5 text-[13px] bg-transparent text-[color:var(--foreground)]"
                  style={{ borderColor: "var(--glass-border)" }}
                />
                <button type="button" onClick={addRosterEntry} disabled={!newName.trim()} className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                  Add
                </button>
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)] pt-1">
                One roster for FDE, TAM and Partner. Adding here is the only way a new name enters the system.
              </div>
            </div>
          ) : null}

          {tab === "colours" ? (
            <div className="space-y-2">
              <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
                {COLOR_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setColorField(f.key)}
                    className="px-2.5 py-0.5 rounded-full text-[11px]"
                    style={colorField === f.key ? { background: "rgba(242,255,112,0.18)" } : undefined}
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

        <div className="px-4 py-3 border-t flex justify-end" style={{ borderColor: "var(--glass-border)" }}>
          <button type="button" onClick={onClose} className="btn-primary rounded-full px-4 py-1.5 text-xs font-semibold">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
