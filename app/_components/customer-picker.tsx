"use client";

// The customer field, everywhere. A plain <select> of customerOptions until
// 2026-09-04, which meant two things were impossible: the list included
// churned customers (it only filtered deleted_at), and there was no way to
// add a customer without leaving for Configure.
//
// The option list itself is now filtered to active customers upstream
// (facets.customerOptions in lib/processes/loader.ts), so this component's job
// is the inline "+ Add a new customer" path — mirroring RosterPicker's
// "Add to roster", for the same reason: if adding requires a detour, people
// type the name into a free-text field instead and the roster forks.
//
// A native <select> plus a conditional input, rather than a custom listbox:
// the select is keyboard- and screen-reader-correct for free, and this field
// is one of nine in a dense table row.

import { useState } from "react";
import { slugifyCustomerKey } from "@/app/_components/configure-dialog";

export function CustomerPicker({
  value,
  options,
  onPick,
  className = "dops-field text-[13px]",
  onCustomerAdded,
}: {
  value: string | null;
  options: { id: string; display_name: string }[];
  onPick: (customerId: string | null) => void;
  className?: string;
  /** Lets the parent add the new customer to its own option list, so the
   *  picker shows the new name without waiting for a page refetch. */
  onCustomerAdded?: (customer: { id: string; display_name: string }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const display_name = name.trim();
    if (!display_name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: slugifyCustomerKey(display_name), display_name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      const created = json.customer as { id: string; display_name: string };
      onCustomerAdded?.(created);
      onPick(created.id);
      setAdding(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <div className="min-w-0">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
            if (e.key === "Escape") {
              setAdding(false);
              setName("");
              setError(null);
            }
          }}
          onBlur={() => {
            // Blur commits rather than discards: this sits in a table cell,
            // so clicking the Save-adjacent area of the row would otherwise
            // throw away a name somebody just typed.
            if (name.trim()) void create();
            else setAdding(false);
          }}
          disabled={busy}
          placeholder="New customer name…"
          className="dops-input dops-input-accent w-full px-2 py-1 text-[13px]"
          style={{ borderColor: "var(--yellow-ink)" }}
        />
        {error ? (
          <div className="text-[10.5px] mt-0.5" style={{ color: "var(--status-bad)" }}>
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value === "__add__") {
          setAdding(true);
          return;
        }
        onPick(e.target.value || null);
      }}
      className={className}
    >
      <option value="">—</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.display_name}
        </option>
      ))}
      {/* An inactive customer still owns processes, so a row can point at one
          that is no longer in `options`. Without this the select would show
          "—" and the next save would silently unassign it. */}
      {value && !options.some((c) => c.id === value) ? (
        <option value={value}>(inactive customer)</option>
      ) : null}
      <option value="__add__">+ Add a new customer…</option>
    </select>
  );
}
