"use client";

// The process edit drawer. Per docs/mockups/ia-step-1.5.html panel 3: one
// process at a time, every field saves as it changes (no Save button),
// derived fields are visually distinct and unclickable, and "Mark reviewed"
// is a separate action from editing.
//
// Built on DrillDownPanel's slide-over shell (ESC-to-close, body-scroll-lock)
// rather than ProjectDetailPanel, which is hardcoded to the Monday shape and
// is being retired, not extended.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { DrillDownPanel } from "@/app/_components/drilldown-panel";
import {
  PROCESS_LIFECYCLES,
  PROCESS_PHASES,
  PROCESS_HEALTHS,
  PROCESS_BLOCKED_ON,
  PROCESS_WORK_MODES,
  PROCESS_PLATFORMS,
  MIGRATION_STAGES,
  MIGRATION_STAGE_LABELS,
  type Process,
} from "@/lib/supabase/types";

const OTHER = "__other__";

function label(s: string): string {
  return s.replace(/_/g, " ");
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]">
      {children}
    </span>
  );
}

function daysAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// A non-JSON response (an HTML login page, a Vercel error interstitial) means
// something upstream of the route handler intercepted the request — most
// often an expired session. res.json() on that throws an opaque "Unexpected
// token '<'"; this gives a message a user can actually act on.
async function parseJsonResponse(res: Response): Promise<{ error?: string; process?: Process }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Your session expired — refresh the page and log in again."
        : `Unexpected response (HTTP ${res.status}) — try refreshing the page.`
    );
  }
  return res.json();
}

// ─── Field row ───────────────────────────────────────────────────────────────

type FieldKind = "select" | "text" | "date" | "number" | "textarea";

function FieldRow({
  fieldLabel,
  kind,
  value,
  options,
  onCommit,
}: {
  fieldLabel: string;
  kind: FieldKind;
  value: string | number | null;
  options?: { value: string; label: string }[];
  onCommit: (value: string | number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  async function commit(next: string | number | null) {
    if (next === (value ?? "")) return;
    setBusy(true);
    setError(null);
    try {
      await onCommit(next === "" ? null : next);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    } catch (err) {
      setDraft(value ?? "");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ctlClass = `flex-1 rounded-md border px-2.5 py-1.5 text-[13px] bg-[var(--glass-bg)] text-[color:var(--foreground)] transition-colors ${
    flash ? "border-[color:var(--brand-yellow)] bg-[rgba(242,255,112,0.12)]" : "border-[var(--glass-border)]"
  } focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)] disabled:opacity-60`;

  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 items-start py-2 border-b border-[var(--glass-border)]/60">
      <div className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold pt-2">
        {fieldLabel}
      </div>
      <div>
        {kind === "select" ? (
          <select
            value={draft}
            disabled={busy}
            onChange={(e) => {
              setDraft(e.target.value);
              void commit(e.target.value);
            }}
            className={ctlClass}
          >
            <option value="">—</option>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : kind === "textarea" ? (
          <textarea
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            rows={2}
            className={`${ctlClass} resize-y`}
          />
        ) : (
          <input
            type={kind}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(kind === "number" ? (draft === "" ? "" : Number(draft)) : draft)}
            className={ctlClass}
          />
        )}
        {error ? <div className="text-[11px] text-red-600 mt-1">{error}</div> : null}
      </div>
    </div>
  );
}

// A select backed by real data (existing FDE/TAM/partner names already in
// use) rather than a hardcoded roster — there is no canonical employee or
// partner list anywhere in this app to hardcode against. "+ add new" falls
// back to free text so a new hire or partner never gets blocked on a list
// nobody maintains.
function ComboRow({
  fieldLabel,
  value,
  options,
  onCommit,
}: {
  fieldLabel: string;
  value: string | null;
  options: string[];
  onCommit: (value: string | null) => Promise<void>;
}) {
  const knownOptions = Array.from(new Set(value ? [...options, value] : options)).sort();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  async function commit(next: string | null) {
    if (next === value) {
      setCustomizing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCommit(next);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      setCustomizing(false);
    } catch (err) {
      setDraft(value ?? "");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ctlClass = `flex-1 rounded-md border px-2.5 py-1.5 text-[13px] bg-[var(--glass-bg)] text-[color:var(--foreground)] transition-colors ${
    flash ? "border-[color:var(--brand-yellow)] bg-[rgba(242,255,112,0.12)]" : "border-[var(--glass-border)]"
  } focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)] disabled:opacity-60`;

  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 items-start py-2 border-b border-[var(--glass-border)]/60">
      <div className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold pt-2">
        {fieldLabel}
      </div>
      <div>
        {customizing ? (
          <input
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft.trim() === "" ? null : draft.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(value ?? "");
                setCustomizing(false);
              }
            }}
            placeholder="Type a name…"
            className={ctlClass}
          />
        ) : (
          <select
            value={value ?? ""}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setDraft("");
                setCustomizing(true);
                return;
              }
              void commit(e.target.value === "" ? null : e.target.value);
            }}
            className={ctlClass}
          >
            <option value="">—</option>
            {knownOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value={OTHER}>+ add new…</option>
          </select>
        )}
        {error ? <div className="text-[11px] text-red-600 mt-1">{error}</div> : null}
      </div>
    </div>
  );
}

function DerivedRow({ fieldLabel, display }: { fieldLabel: string; display: string }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 items-start py-2 border-b border-[var(--glass-border)]/60">
      <div className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold pt-2">
        {fieldLabel}
      </div>
      <div className="rounded-md border border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--muted-foreground)]">
        {display}
      </div>
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-1 first:mt-0">
      <span className="text-[10.5px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
        {title}
      </span>
      <div className="flex-1 h-px bg-[var(--glass-border)]" />
    </div>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export interface ProcessDrawerFacets {
  fdeOwners: string[];
  tamOwners: string[];
  partners: string[];
  customerOptions: { id: string; display_name: string }[];
}

export function ProcessDrawer({
  process,
  customerDisplayName,
  facets,
  onClose,
}: {
  process: Process;
  customerDisplayName: string;
  facets: ProcessDrawerFacets;
  onClose: () => void;
}) {
  const router = useRouter();
  const [proc, setProc] = useState(process);
  const [reviewBusy, setReviewBusy] = useState(false);

  async function saveField(field: keyof Process, value: string | number | null) {
    const res = await fetch(`/api/processes/${proc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const json = await parseJsonResponse(res);
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setProc(json.process as Process);
    // The board/table lists are a server-fetched snapshot passed down as
    // props — refresh so a lifecycle change actually moves the card to its
    // new lane instead of only updating inside the (still-open) drawer.
    router.refresh();
  }

  async function markReviewed() {
    setReviewBusy(true);
    try {
      const res = await fetch(`/api/processes/${proc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-reviewed" }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setProc(json.process as Process);
      router.refresh();
    } catch {
      /* best-effort — the field rows already surface per-field errors */
    } finally {
      setReviewBusy(false);
    }
  }

  const resolvedCustomerName =
    facets.customerOptions.find((c) => c.id === proc.customer_id)?.display_name ?? customerDisplayName;

  const historyEntries = Object.entries(proc.field_provenance ?? {}).sort(
    (a, b) => (b[1]?.at ?? "").localeCompare(a[1]?.at ?? "")
  );

  return (
    <DrillDownPanel
      title={proc.process_name}
      subtitle={
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {resolvedCustomerName}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip>{label(proc.platform)}</Chip>
            {proc.complexity ? <Chip>{proc.complexity}</Chip> : null}
            {proc.health ? <Chip>{label(proc.health)}</Chip> : null}
            <Chip>updated {daysAgo(proc.updated_at)}d ago</Chip>
            {proc.needs_attention ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-red-500/10 text-red-700 border-red-500/25">
                needs attention
              </span>
            ) : null}
          </div>
        </div>
      }
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span>Saves per field, optimistically. No Save button.</span>
          <button
            type="button"
            onClick={markReviewed}
            disabled={reviewBusy}
            className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          >
            {reviewBusy ? "…" : "Mark reviewed"}
          </button>
        </div>
      }
    >
      {proc.needs_attention_reason ? (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 mb-3">
          {proc.needs_attention_reason}
        </div>
      ) : null}

      <GroupHeader title="Identity" />
      <FieldRow
        fieldLabel="Customer"
        kind="select"
        value={proc.customer_id}
        options={facets.customerOptions.map((c) => ({ value: c.id, label: c.display_name }))}
        onCommit={(v) => saveField("customer_id", v)}
      />
      <div className="text-[11px] text-[color:var(--muted-foreground)] -mt-1 mb-1 ml-[144px]">
        Only fix this for a mismatched import — it doesn't rename or move the process.
      </div>

      <GroupHeader title="State" />
      <FieldRow
        fieldLabel="Lifecycle"
        kind="select"
        value={proc.lifecycle}
        options={PROCESS_LIFECYCLES.map((v) => ({ value: v, label: label(v) }))}
        onCommit={(v) => saveField("lifecycle", v)}
      />
      <div className="text-[11px] text-[color:var(--muted-foreground)] -mt-1 mb-1 ml-[144px]">
        Changing this moves the card to another lane.
      </div>
      <FieldRow
        fieldLabel="Phase"
        kind="select"
        value={proc.phase}
        options={PROCESS_PHASES.map((v) => ({ value: v, label: label(v) }))}
        onCommit={(v) => saveField("phase", v)}
      />
      <FieldRow
        fieldLabel="Health"
        kind="select"
        value={proc.health}
        options={PROCESS_HEALTHS.map((v) => ({ value: v, label: label(v) }))}
        onCommit={(v) => saveField("health", v)}
      />
      <FieldRow
        fieldLabel="Blocked on"
        kind="select"
        value={proc.blocked_on}
        options={PROCESS_BLOCKED_ON.map((v) => ({ value: v, label: v === "none" ? "nothing" : label(v) }))}
        onCommit={(v) => saveField("blocked_on", v)}
      />
      <FieldRow
        fieldLabel="Work mode"
        kind="select"
        value={proc.work_mode}
        options={PROCESS_WORK_MODES.map((v) => ({ value: v, label: label(v) }))}
        onCommit={(v) => saveField("work_mode", v)}
      />
      <FieldRow
        fieldLabel="Platform"
        kind="select"
        value={proc.platform}
        options={PROCESS_PLATFORMS.map((v) => ({ value: v, label: v.toUpperCase() }))}
        onCommit={(v) => saveField("platform", v)}
      />
      <FieldRow
        fieldLabel="Migration stage"
        kind="select"
        value={proc.migration_stage}
        options={MIGRATION_STAGES.map((v) => ({ value: v, label: MIGRATION_STAGE_LABELS[v] }))}
        onCommit={(v) => saveField("migration_stage", v)}
      />

      <GroupHeader title="Dates & effort" />
      <FieldRow fieldLabel="Kickoff" kind="date" value={proc.kickoff_date} onCommit={(v) => saveField("kickoff_date", v)} />
      <FieldRow fieldLabel="Go live" kind="date" value={proc.go_live_date} onCommit={(v) => saveField("go_live_date", v)} />
      <DerivedRow fieldLabel="TTV" display={proc.ttv_days != null ? `${proc.ttv_days} days` : "computed on go-live · generated column"} />
      <FieldRow
        fieldLabel="Effort hours"
        kind="number"
        value={proc.total_effort_hours}
        onCommit={(v) => saveField("total_effort_hours", v)}
      />

      <GroupHeader title="Ownership" />
      <ComboRow fieldLabel="Dev / FDE" value={proc.fde_owner} options={facets.fdeOwners} onCommit={(v) => saveField("fde_owner", v)} />
      <ComboRow fieldLabel="TAM" value={proc.tam_owner} options={facets.tamOwners} onCommit={(v) => saveField("tam_owner", v)} />
      <ComboRow fieldLabel="Partner" value={proc.partner} options={facets.partners} onCommit={(v) => saveField("partner", v)} />

      <GroupHeader title="Value" />
      <FieldRow
        fieldLabel="Minutes saved / run"
        kind="number"
        value={proc.value_minutes_saved_per_run}
        onCommit={(v) => saveField("value_minutes_saved_per_run", v)}
      />
      <FieldRow
        fieldLabel="Basis"
        kind="textarea"
        value={proc.value_basis}
        onCommit={(v) => saveField("value_basis", v)}
      />
      <DerivedRow
        fieldLabel="Runs this quarter"
        display={proc.k2_process_id ? "—" : "no Kognitos link · single-workspace PAT"}
      />
      <DerivedRow fieldLabel="Value" display="nothing shown, deliberately" />

      <GroupHeader title="Notes" />
      <FieldRow fieldLabel="Blockers" kind="textarea" value={proc.blockers} onCommit={(v) => saveField("blockers", v)} />
      <FieldRow fieldLabel="Notes" kind="textarea" value={proc.notes} onCommit={(v) => saveField("notes", v)} />

      <GroupHeader title="History" />
      <div className="text-xs text-[color:var(--muted-foreground)] space-y-1">
        {historyEntries.length === 0 ? <div className="italic py-1">No edits since import.</div> : null}
        {historyEntries.map(([field, prov]) => (
          <div key={field} className="py-1 border-b border-[var(--glass-border)]/60">
            {label(field)} changed · {prov.by} · {daysAgo(prov.at)}d ago
          </div>
        ))}
        {proc.source_item_id ? (
          <div className="py-1">created from Monday item {proc.source_item_id}</div>
        ) : null}
      </div>
    </DrillDownPanel>
  );
}
