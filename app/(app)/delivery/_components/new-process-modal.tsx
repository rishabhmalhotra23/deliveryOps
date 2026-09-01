"use client";

// Creating a process only ever sets its starting point — everything else
// (lifecycle changes, migration_stage moves, dates, owners) happens
// afterward in the existing ProcessDrawer. So this form is deliberately
// small: identity + an initial stage, nothing the drawer already owns.
// migration_stage is not exposed here — a brand-new process is delivery
// work, not migration work, by definition (see buildCreateProcessRow).

import { useState } from "react";

import { PROCESS_LIFECYCLES, PROCESS_PLATFORMS, type Process } from "@/lib/supabase/types";

const OTHER = "__other__";

function label(s: string): string {
  return s.replace(/_/g, " ");
}

const inputClass =
  "w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]";

interface CustomerOption {
  id: string;
  display_name: string;
}

export function NewProcessModal({
  customerOptions,
  onClose,
  onCreated,
}: {
  customerOptions: CustomerOption[];
  onClose: () => void;
  onCreated: (process: Process) => void;
}) {
  const [processName, setProcessName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [freeAccount, setFreeAccount] = useState("");
  const [lifecycle, setLifecycle] = useState<(typeof PROCESS_LIFECYCLES)[number]>("backlog");
  const [platform, setPlatform] = useState<(typeof PROCESS_PLATFORMS)[number]>("v2");
  const [fdeOwner, setFdeOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingOther = customerId === OTHER;
  const selectedCustomer = customerOptions.find((c) => c.id === customerId);
  const account = usingOther ? freeAccount.trim() : (selectedCustomer?.display_name ?? "");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          process_name: processName,
          account,
          customer_id: usingOther ? null : customerId || null,
          lifecycle,
          platform,
          fde_owner: fdeOwner.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onCreated(json.process as Process);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-5 space-y-3 shadow-2xl"
        style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
          New process
        </div>

        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
            Process name
          </label>
          <input
            autoFocus
            value={processName}
            onChange={(e) => setProcessName(e.target.value)}
            placeholder="e.g. Invoice reconciliation"
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
            Customer
          </label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a customer…</option>
            {customerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
            <option value={OTHER}>Other / not listed yet…</option>
          </select>
          {usingOther ? (
            <input
              value={freeAccount}
              onChange={(e) => setFreeAccount(e.target.value)}
              placeholder="Account name"
              className={`${inputClass} mt-1.5`}
            />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
              Initial stage
            </label>
            <select
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value as (typeof PROCESS_LIFECYCLES)[number])}
              className={inputClass}
            >
              {PROCESS_LIFECYCLES.map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
              Platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as (typeof PROCESS_PLATFORMS)[number])}
              className={inputClass}
            >
              {PROCESS_PLATFORMS.map((v) => (
                <option key={v} value={v}>
                  {v.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
            FDE owner (optional)
          </label>
          <input
            value={fdeOwner}
            onChange={(e) => setFdeOwner(e.target.value)}
            className={inputClass}
          />
        </div>

        {error ? <div className="text-[11px] text-red-600">{error}</div> : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !processName.trim() || !account}
            className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create process"}
          </button>
        </div>
      </div>
    </div>
  );
}
