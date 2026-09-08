"use client";

// Zones and categories, editable from /customers.
//
// Everything here was compiled in until 2026-09-08:
//   * the group headers      app/_components/brand.tsx  ZONE_ORDER / ZONE_DESC
//   * which zone a category
//     files under            app/_components/brand.tsx  CATEGORY_TO_ZONE
//   * a category's colour    customers-browser.tsx      CATEGORY_VARIANT
//   * the picker list        lib/supabase/types.ts      CUSTOMER_CATEGORIES
//
// So minting "To be dropped post contract expiry" from the record card saved
// the name and then filed the customer under Focus — the active book — with an
// untoned chip. The label was configurable; its meaning wasn't.
//
// Zone is the field that matters most: it decides which group a customer
// appears under and whether it reads as part of the active book, and it is the
// one that silently defaulted wrong.
//
// Approved design: docs/mockups/2026-09-08-customers-one-place.html, section 7.

import { useEffect, useState } from "react";

import { HUES } from "@/lib/delivery/hues";
import type { CustomerVocabulary } from "@/lib/vocabulary/store";

type Tab = "categories" | "zones";

function chipStyle(hue: string | null): React.CSSProperties | undefined {
  if (!hue) return undefined;
  return {
    color: `var(--st-${hue}-fg)`,
    background: `var(--st-${hue}-bg)`,
    borderColor: `var(--st-${hue}-bd)`,
  };
}

export function CustomerConfigDialog({
  initial,
  onClose,
}: {
  initial: CustomerVocabulary;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("categories");
  const [vocab, setVocab] = useState<CustomerVocabulary>(initial);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; hue: string; rollup: string; description: string }>({
    label: "",
    hue: "",
    rollup: "",
    description: "",
  });
  const [newLabel, setNewLabel] = useState("");

  // Usage counts come from the route rather than being derived here: a
  // category's count is over `customers`, which this component never loads.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/customers/vocabulary")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.zones) setVocab({ zones: json.zones, categories: json.categories });
        setUsage(json.usage ?? {});
      })
      .catch(() => {
        /* the dialog still works from `initial`; counts just stay blank */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(init: RequestInit, url = "/api/customers/vocabulary") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return false;
      }
      if (json.vocabulary) setVocab(json.vocabulary);
      if (json.customersMoved > 0) {
        setNotice(
          `Renamed — ${json.customersMoved} customer${json.customersMoved === 1 ? "" : "s"} moved with it.`
        );
      }
      // Counts change on delete and on rename, so refetch rather than guess.
      const fresh = await fetch("/api/customers/vocabulary").then((r) => r.json());
      if (fresh.zones) setVocab({ zones: fresh.zones, categories: fresh.categories });
      setUsage(fresh.usage ?? {});
      setEditing(null);
      setNewLabel("");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rows: { value: string; label: string; hue: string | null; rollup?: string; description?: string | null; active: boolean }[] =
    tab === "categories"
      ? vocab.categories.map((c) => ({
          value: c.value,
          label: c.label,
          hue: c.hue,
          rollup: c.zone,
          active: c.active,
        }))
      : vocab.zones.map((z) => ({
          value: z.value,
          label: z.label,
          hue: z.hue,
          description: z.description,
          active: z.active,
        }));

  const vocabulary = tab === "categories" ? "customer_category" : "customer_zone";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="dops-rise-in w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[85vh]"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-0 shrink-0">
          <div className="text-[15px] font-semibold tracking-tight">Categories &amp; zones</div>
          <div className="flex gap-4 mt-2 border-b" style={{ borderColor: "var(--glass-border)" }}>
            {(["categories", "zones"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setEditing(null);
                  setError(null);
                }}
                className="pb-2 text-[13px] capitalize"
                style={{
                  color: tab === t ? "var(--foreground)" : "var(--muted-foreground)",
                  fontWeight: tab === t ? 600 : 400,
                  borderBottom: tab === t ? "2px solid var(--yellow-ink)" : "2px solid transparent",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          {error ? (
            <div
              className="rounded-md px-2.5 py-2 mb-2 text-[12px]"
              style={{ background: "var(--st-red-bg)", border: "1px solid var(--st-red-bd)", color: "var(--st-red-fg)" }}
            >
              {error}
            </div>
          ) : null}
          {notice ? (
            <div
              className="rounded-md px-2.5 py-2 mb-2 text-[12px]"
              style={{ background: "var(--st-emerald-bg)", border: "1px solid var(--st-emerald-bd)", color: "var(--st-emerald-fg)" }}
            >
              {notice}
            </div>
          ) : null}

          <div className={`overflow-auto space-y-1 ${editing ? "max-h-[52vh]" : "max-h-72"}`}>
            {rows.map((r) => {
              const count = usage[`${vocabulary}:${r.value}`] ?? 0;
              if (editing === r.value) {
                return (
                  <div
                    key={r.value}
                    className="rounded-lg px-2.5 py-2.5 space-y-2.5"
                    style={{ background: "var(--surface-3, var(--field))", border: "1px solid var(--yellow-line)" }}
                  >
                    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5">
                          {tab === "categories" ? "Category name" : "Zone header"}
                        </span>
                        <input
                          autoFocus
                          value={draft.label}
                          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                          className="dops-input w-full px-2 py-1 text-[13px]"
                        />
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5">
                          Colour
                        </span>
                        <select
                          value={draft.hue}
                          onChange={(e) => setDraft((d) => ({ ...d, hue: e.target.value }))}
                          className="dops-field w-full text-[13px]"
                        >
                          <option value="">— none</option>
                          {HUES.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                      {tab === "categories" ? (
                        <div>
                          <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5">
                            Rolls up to
                          </span>
                          <select
                            value={draft.rollup}
                            onChange={(e) => setDraft((d) => ({ ...d, rollup: e.target.value }))}
                            className="dops-field w-full text-[13px]"
                          >
                            {vocab.zones.map((z) => (
                              <option key={z.value} value={z.value}>
                                {z.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-0.5">
                            Sub-label
                          </span>
                          <input
                            value={draft.description}
                            placeholder="the active book"
                            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                            className="dops-input w-full px-2 py-1 text-[13px]"
                          />
                        </div>
                      )}
                    </div>

                    {tab === "categories" && count > 0 && draft.label.trim() !== r.value ? (
                      <div
                        className="rounded-md px-2.5 py-1.5 text-[11.5px]"
                        style={{ background: "var(--st-amber-bg)", border: "1px solid var(--st-amber-bd)", color: "var(--st-amber-fg)" }}
                      >
                        {count} customer{count === 1 ? "" : "s"} will be moved to
                        &quot;{draft.label.trim()}&quot; — <code>customers.custom_category</code> stores the
                        name itself, so a rename repoints them in the same transaction.
                      </div>
                    ) : null}

                    <div className="flex gap-2 justify-end pt-0.5">
                      {count === 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void send(
                              { method: "DELETE" },
                              `/api/customers/vocabulary?vocabulary=${vocabulary}&value=${encodeURIComponent(r.value)}`
                            )
                          }
                          className="rounded-full px-3 py-1 text-[11.5px] border mr-auto"
                          style={{ borderColor: "var(--st-red-bd)", color: "var(--st-red-fg)" }}
                          title="Nothing uses this, so it can be removed outright"
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ vocabulary, value: r.value, active: !r.active }),
                            })
                          }
                          className="rounded-full px-3 py-1 text-[11.5px] border mr-auto"
                          style={{ borderColor: "var(--brand-metal-line)", color: "var(--muted-foreground)" }}
                          title={`${count} in use — retire it instead of deleting`}
                        >
                          {r.active ? "Retire" : "Un-retire"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-full px-3 py-1 text-[11.5px] border"
                        style={{ borderColor: "var(--brand-metal-line)", color: "var(--foreground)" }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy || !draft.label.trim()}
                        onClick={() =>
                          void send({
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              vocabulary,
                              value: r.value,
                              label: draft.label,
                              hue: draft.hue || null,
                              ...(tab === "categories"
                                ? { rollup: draft.rollup }
                                : { description: draft.description || null }),
                            }),
                          })
                        }
                        className="btn-primary rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-60"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={r.value}
                  className="rounded-md px-2.5 py-1.5 text-[13px] flex items-center gap-2.5"
                  style={{ background: "var(--field)", opacity: r.active ? 1 : 0.5 }}
                >
                  <span
                    className="text-[10.5px] px-1.5 py-0.5 rounded border font-medium"
                    style={chipStyle(r.hue) ?? { borderColor: "var(--glass-border)", color: "var(--muted-foreground)" }}
                  >
                    {r.label}
                  </span>
                  {tab === "categories" ? (
                    <span className="text-[11px] text-[color:var(--muted-foreground)]">
                      → {vocab.zones.find((z) => z.value === r.rollup)?.label ?? r.rollup}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[color:var(--muted-foreground)] italic">
                      {r.description ?? "—"}
                    </span>
                  )}
                  {!r.active ? (
                    <span className="text-[10px] text-[color:var(--muted-foreground)]">retired</span>
                  ) : null}
                  <span className="ml-auto font-mono text-[11px] text-[color:var(--muted-foreground)]">
                    {tab === "categories"
                      ? `${count} customer${count === 1 ? "" : "s"}`
                      : `${count} categor${count === 1 ? "y" : "ies"}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(r.value);
                      setError(null);
                      setDraft({
                        label: r.label,
                        hue: r.hue ?? "",
                        rollup: r.rollup ?? vocab.zones[0]?.value ?? "focus",
                        description: r.description ?? "",
                      });
                    }}
                    className="text-[13px] px-1 opacity-60 hover:opacity-100"
                    title={`Edit ${r.label}`}
                  >
                    ⋯
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 mt-3">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={
                tab === "categories" ? "Add a category…" : "Add a zone…"
              }
              className="dops-input flex-1 px-2 py-1.5 text-[13px]"
            />
            <button
              type="button"
              disabled={busy || !newLabel.trim()}
              onClick={() =>
                void send({
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    vocabulary,
                    label: newLabel,
                    hue: "neutral",
                    ...(tab === "categories" ? { rollup: vocab.zones[0]?.value ?? "focus" } : {}),
                  }),
                })
              }
              className="btn-primary rounded-full px-4 py-1 text-[12px] font-semibold disabled:opacity-60"
            >
              Add
            </button>
          </div>

          <p className="text-[11.5px] text-[color:var(--muted-foreground)] mt-3 leading-relaxed">
            {tab === "categories" ? (
              <>
                A category is a reporting bucket. <b>Rolls up to</b> is the field that decides which
                group a customer appears under on this page — a new category defaulted to{" "}
                <b>Focus</b> before this existed, so a customer you were winding down joined the
                active book. Unlike the delivery vocabularies, these are plain text: adding one runs
                no schema change, and anything nothing uses can be deleted outright rather than only
                retired.
              </>
            ) : (
              <>
                Zones are the group headers on this page, label and sub-label both. Nothing stores a
                zone — a customer&apos;s zone is derived from its category&apos;s roll-up — so
                renaming one is free and needs no data migration. A zone can only be deleted once no
                category rolls into it.
              </>
            )}
          </p>
        </div>

        <div className="px-4 py-3 border-t flex justify-end shrink-0" style={{ borderColor: "var(--glass-border)" }}>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary rounded-full px-4 py-1.5 text-[13px] font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
