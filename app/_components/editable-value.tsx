"use client";

// One control for a value that is displayed somewhere read-only today, with
// the "was the old value wrong?" question attached when the value isn't ours
// to own.
//
// Two kinds of field flow through here, and the difference is the whole
// point:
//
//   source: "deliveryops"  — we own the column. Save writes it. No question
//                            worth asking, so none is asked.
//   source: anything else  — the value is derived from a synced cache (chiefly
//                            Salesforce, via sf_*). There is no column to
//                            write, so a save records a `field_overrides` row
//                            (0041) that wins over the derivation. Because
//                            that decision is durable, it asks first.
//
// The one-off option matters: sometimes the sync is right and merely late, and
// making every edit permanent would quietly freeze fields that should keep
// tracking their source.
//
// Approved design: docs/mockups/2026-09-04-editable-everything.html.

import { useState } from "react";

export type ValueSource = "deliveryops" | "salesforce" | "nps" | "kognitos";

const SOURCE_LABEL: Record<ValueSource, string> = {
  deliveryops: "DeliveryOps",
  salesforce: "Salesforce",
  nps: "NPS responses",
  kognitos: "Kognitos",
};

const SOURCE_DOT: Record<ValueSource, string> = {
  deliveryops: "var(--brand-yellow)",
  salesforce: "var(--st-blue-fg, #60A5FA)",
  nps: "var(--st-emerald-fg, #4ADE80)",
  kognitos: "var(--st-fuchsia-fg, #E879F9)",
};

export interface OverrideInfo {
  value: unknown;
  synced_value: unknown;
  reason: string | null;
  set_by: string;
  set_at: string;
}

export function EditableValue({
  label,
  display,
  rawValue,
  source,
  kind = "text",
  override,
  onSaveOwned,
  onSaveOverride,
  onClearOverride,
  options,
}: {
  label: string;
  /** Formatted for reading — "$311,000", "12 Nov 2026". */
  display: string;
  /** Unformatted, for the input. */
  rawValue: string | number | null;
  source: ValueSource;
  kind?: "text" | "money" | "number" | "date" | "select";
  /** Present when a correction is already in force. */
  override?: OverrideInfo | null;
  /** For `source: "deliveryops"` — writes the column directly. */
  onSaveOwned?: (value: string | null) => Promise<void>;
  /** For synced fields — records the correction. `permanent: false` is the
   *  one-off case, which the caller applies without storing an override. */
  onSaveOverride?: (value: string, opts: { permanent: boolean; reason: string }) => Promise<void>;
  onClearOverride?: () => Promise<void>;
  options?: { value: string; label: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [permanent, setPermanent] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const owned = source === "deliveryops";

  function open() {
    setDraft(rawValue == null ? "" : String(rawValue));
    setReason(override?.reason ?? "");
    setPermanent(true);
    setError(null);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setConfirming(false);
    setError(null);
  }

  async function submit() {
    // An owned field has nothing to confirm — go straight to the write.
    if (owned) return void commitOwned();
    // A synced field asks before it remembers anything.
    setConfirming(true);
  }

  async function commitOwned() {
    setBusy(true);
    setError(null);
    try {
      await onSaveOwned?.(draft.trim() === "" ? null : draft.trim());
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitOverride() {
    setBusy(true);
    setError(null);
    try {
      await onSaveOverride?.(draft.trim(), { permanent, reason: reason.trim() });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revert() {
    setBusy(true);
    setError(null);
    try {
      await onClearOverride?.();
      setDetailOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── The confirm step ────────────────────────────────────────────────────
  if (confirming) {
    return (
      <div
        className="rounded-xl border p-3 space-y-2.5"
        style={{ borderColor: "var(--yellow-line)", background: "var(--surface-3, var(--card))" }}
      >
        <div className="text-[13.5px] font-semibold text-[color:var(--foreground)]">
          Change {label} to {formatForConfirm(draft, kind)}?
        </div>
        <p className="text-[12px] text-[color:var(--muted-foreground)] leading-snug m-0">
          {SOURCE_LABEL[source]} is the source for this field. Tell me which it is, so tonight&rsquo;s
          sync knows what to do.
        </p>

        <div className="flex gap-2">
          <div
            className="flex-1 rounded-lg border px-2.5 py-1.5 opacity-70"
            style={{ borderColor: "var(--brand-metal-line)", background: "var(--surface-2, var(--muted))" }}
          >
            <div className="dops-tiny-label">{SOURCE_LABEL[source]} says</div>
            <b className="text-[13px]">{display}</b>
          </div>
          <div
            className="flex-1 rounded-lg border px-2.5 py-1.5"
            style={{ borderColor: "var(--yellow-line)", background: "var(--yellow-soft)" }}
          >
            <div className="dops-tiny-label">You say</div>
            <b className="text-[13px]">{formatForConfirm(draft, kind)}</b>
          </div>
        </div>

        <Choice
          selected={permanent}
          onSelect={() => setPermanent(true)}
          title={`${SOURCE_LABEL[source]} is wrong — remember mine`}
          detail={`${formatForConfirm(draft, kind)} sticks. Tonight's sync won't touch it, and it stays yours until you clear it.`}
        />
        <Choice
          selected={!permanent}
          onSelect={() => setPermanent(false)}
          title="Just a one-off fix"
          detail={`Applies now. Tonight's sync will overwrite it back to ${display}.`}
        />

        {permanent ? (
          <div>
            <label className="dops-tiny-label" htmlFor={`reason-${label}`}>
              Why? (optional, but it&rsquo;s what future-you reads)
            </label>
            <input
              id={`reason-${label}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. renegotiated in Feb — the SF opp is the pre-renewal figure"
              className="dops-input w-full px-2 py-1 text-[12.5px]"
            />
          </div>
        ) : null}

        {error ? (
          <div className="text-[11.5px]" style={{ color: "var(--status-bad)" }}>
            {error}
          </div>
        ) : null}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={close} className="dops-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void commitOverride()}
            disabled={busy}
            className="btn-primary rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  // ── The edit step ───────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="space-y-1.5">
        <span className="dops-tiny-label">{label}</span>
        {kind === "select" && options ? (
          <select
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="dops-field text-[13px] w-full"
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            type={kind === "date" ? "date" : kind === "money" || kind === "number" ? "number" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") close();
            }}
            className="dops-input dops-input-accent w-full px-2 py-1 text-[13px]"
          />
        )}
        {error ? (
          <div className="text-[11.5px]" style={{ color: "var(--status-bad)" }}>
            {error}
          </div>
        ) : null}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={close} className="dops-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="btn-primary rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-60"
          >
            {busy ? "Saving…" : owned ? "Save" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  // ── Resting state ───────────────────────────────────────────────────────
  return (
    <div className="group/ev">
      <span className="dops-tiny-label">{label}</span>
      <button
        type="button"
        onClick={open}
        title={`Edit ${label}`}
        className="block text-left w-full"
      >
        <span className="text-[17px] font-semibold tracking-[-.3px] text-[color:var(--foreground)]">
          {display}
        </span>
        <span className="ml-1.5 text-[10px] opacity-0 group-hover/ev:opacity-60">✎</span>
      </button>

      {override ? (
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 text-[9px] uppercase tracking-[.5px]"
          style={{
            color: "var(--st-amber-fg, #FBBF24)",
            background: "var(--st-amber-bg, rgba(251,191,36,.14))",
            borderColor: "var(--st-amber-bd, rgba(251,191,36,.32))",
          }}
        >
          ✎ corrected · {shortActor(override.set_by)}, {shortDate(override.set_at)}
        </button>
      ) : (
        <span className="mt-0.5 flex items-center gap-1 text-[9px] uppercase tracking-[.5px] text-[color:var(--muted-foreground)]">
          <span
            className="inline-block rounded-full"
            style={{ width: 5, height: 5, background: SOURCE_DOT[source] }}
          />
          {SOURCE_LABEL[source]}
        </span>
      )}

      {/* Nothing is hidden: the synced value stays visible so a correction
          that has since gone stale is findable rather than silently
          permanent. */}
      {override && detailOpen ? (
        <div
          className="mt-1.5 rounded-lg border px-2.5 py-2 text-[11.5px] leading-snug"
          style={{ borderColor: "var(--brand-metal-line)", background: "var(--surface-2, var(--muted))" }}
        >
          <div className="font-semibold text-[color:var(--foreground)]">Your correction</div>
          <div className="text-[color:var(--muted-foreground)]">
            {display} · set by {override.set_by}, {shortDate(override.set_at)}
          </div>
          {override.reason ? (
            <div className="text-[color:var(--muted-foreground)] italic mt-0.5">
              &ldquo;{override.reason}&rdquo;
            </div>
          ) : null}
          {override.synced_value != null ? (
            <div className="mt-0.5" style={{ color: "var(--st-blue-fg, #60A5FA)" }}>
              {SOURCE_LABEL[source]} still says {String(override.synced_value)}
            </div>
          ) : null}
          {error ? (
            <div className="mt-1" style={{ color: "var(--status-bad)" }}>
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void revert()}
            disabled={busy}
            className="mt-1 underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] disabled:opacity-60"
          >
            {busy ? "Reverting…" : `Revert to ${SOURCE_LABEL[source]}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex gap-2 items-start rounded-lg border px-2.5 py-2 text-left"
      style={{
        borderColor: selected ? "var(--yellow-line)" : "var(--brand-metal-line)",
        background: selected ? "var(--yellow-soft)" : "var(--surface-2, var(--muted))",
      }}
    >
      <span
        className="mt-0.5 shrink-0 rounded-full border"
        style={{
          width: 12,
          height: 12,
          borderColor: selected ? "var(--brand-yellow)" : "var(--muted-foreground)",
          background: selected ? "var(--brand-yellow)" : "transparent",
        }}
      />
      <span>
        <span className="block text-[12px] text-[color:var(--foreground)]">{title}</span>
        <span className="block text-[10.5px] text-[color:var(--muted-foreground)] mt-px">{detail}</span>
      </span>
    </button>
  );
}

function formatForConfirm(raw: string, kind: string): string {
  if (raw.trim() === "") return "—";
  if (kind === "money") {
    const n = Number(raw);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : raw;
  }
  return raw;
}

/** "rishabh@kognitos.com" -> "you" is wrong for anyone else, so this just
 *  trims the domain rather than guessing identity. */
function shortActor(who: string): string {
  return who.includes("@") ? who.split("@")[0]! : who;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
