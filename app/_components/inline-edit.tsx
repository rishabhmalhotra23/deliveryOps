"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Option {
  value: string;
  label: string;
}

interface InlineEditProps {
  customerKey: string;
  field: string;
  initialValue: string | null;
  /** When provided, renders as a select. Otherwise renders as a text input
   *  (with autocomplete from `suggestions` if provided). */
  options?: Option[];
  suggestions?: string[];
  placeholder?: string;
  label: string;
  /** Allow clearing to null. Default true. */
  allowNull?: boolean;
}

export function InlineEdit({
  customerKey,
  field,
  initialValue,
  options,
  suggestions,
  placeholder = "—",
  label,
  allowNull = true,
}: InlineEditProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // Sync external changes (e.g. router.refresh)
  useEffect(() => setValue(initialValue ?? ""), [initialValue]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save() {
    if (busy) return;
    const trimmed = value.trim();
    if (trimmed === (initialValue ?? "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerKey}/manual-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: trimmed === "" && allowNull ? null : trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditing(false);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setValue(initialValue ?? "");
    setError(null);
    setEditing(false);
  }

  // Display mode
  if (!editing) {
    return (
      <div className="group inline-flex items-center gap-2">
        <span
          className={`transition-colors duration-700 ${
            flash ? "bg-[color:var(--brand-yellow-soft)] -mx-1 px-1 rounded" : ""
          }`}
        >
          {initialValue ? (
            <span>{initialValue}</span>
          ) : (
            <span className="text-[color:var(--brand-gray)] italic">{placeholder}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]"
          aria-label={`Edit ${label}`}
        >
          edit
        </button>
      </div>
    );
  }

  // Edit mode
  const datalistId = suggestions ? `inline-edit-${field}-suggest` : undefined;
  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex items-center gap-1">
        {options ? (
          <select
            ref={(el) => {
              inputRef.current = el;
            }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="rounded border border-[color:var(--brand-night)] bg-white px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]"
          >
            {allowNull ? <option value="">—</option> : null}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              ref={(el) => {
                inputRef.current = el;
              }}
              value={value}
              list={datalistId}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
              disabled={busy}
              className="rounded border border-[color:var(--brand-night)] bg-white px-2 py-0.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]"
            />
            {suggestions ? (
              <datalist id={datalistId}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            ) : null}
          </>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-[10px] uppercase tracking-wider rounded bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] px-2 py-0.5 disabled:opacity-50"
        >
          {busy ? "…" : "save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)] px-1"
        >
          cancel
        </button>
      </div>
      {error ? <div className="text-[11px] text-red-700">{error}</div> : null}
    </div>
  );
}
