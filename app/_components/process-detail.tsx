"use client";

// One process at a time, every field saves as it changes (no Save button).
// Mounts identically whether the parent puts it in the 420px split-panel
// column or the 880px centre overlay — only the wrapper differs, in
// delivery-client.tsx. Replaces app/_components/process-drawer.tsx.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Process detail panel.

import { useEffect, useRef, useState } from "react";
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
  type RosterEntry,
} from "@/lib/supabase/types";
import type { TicketRow } from "@/lib/tickets/types";
import { FIELD_TO_COL, formatMoney, staleDays, type ColKey } from "@/lib/delivery/columns";
import {
  BLOCKED_ON_LABELS,
  HEALTH_LABELS,
  LIFECYCLE_LABELS,
  PHASE_LABELS,
  PLATFORM_LABELS,
  WORK_MODE_LABELS,
  healthLabel,
  platformLabel,
  sentenceCase,
  stageLabel,
} from "@/lib/delivery/labels";
import { RosterPicker } from "@/app/_components/roster-picker";
import { ActivityFeed } from "@/app/_components/activity-feed";

/** completion_pct is a 0..1 fraction; the UI talks in whole percents. */
function clampPct(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

/** Column name -> the label the panel shows for that field, so the history
 *  list reads "FDE owner changed" rather than "fde owner id changed". */
const FIELD_DISPLAY_NAMES: Record<string, string> = {
  process_name: "Process name",
  customer_id: "Customer",
  lifecycle: "Lifecycle",
  migration_stage: "Migration stage",
  phase: "Phase",
  health: "Health",
  blocked_on: "Blocked on",
  work_mode: "Work mode",
  platform: "Platform",
  kickoff_date: "Kickoff",
  go_live_date: "Go live",
  date_parity_complete: "Parity complete",
  date_customer_handover: "Customer handover",
  date_customer_validation: "Customer validation",
  completion_pct: "Completion %",
  total_effort_hours: "Effort hours",
  fde_owner: "FDE owner",
  fde_owner_id: "FDE owner",
  tam_owner: "TAM owner",
  tam_owner_id: "TAM owner",
  partner: "Partner",
  partner_id: "Partner",
  engg_owner: "Engineering owner",
  engg_owner_id: "Engineering owner",
  arr: "ARR (snapshot)",
  company_size: "Company size",
  value_minutes_saved_per_run: "Minutes saved / run",
  value_basis: "Value basis",
  blockers: "Blocker flag",
  notes: "Latest note",
  linear_ticket_ids: "Linear tickets",
  board_position: "Board order",
  complexity: "Complexity",
  priority: "Priority",
};

function fieldName(column: string): string {
  return FIELD_DISPLAY_NAMES[column] ?? sentenceCase(column);
}

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

export type DetailProcess = Process & {
  customer_display_name: string;
  confirmed_arr?: number | null;
};

interface ProcessDetailProps {
  process: DetailProcess;
  list: DetailProcess[];
  onSelectId: (id: string) => void;
  customerOptions: { id: string; display_name: string }[];
  onUpdated: (updated: Process) => void;
  onArchived: (id: string) => void;
  onClose: () => void;
  onAddColumn: (colKey: ColKey) => void;
  /** Attaching a ticket or posting a blocker is mirrored into
   *  processes.linear_ticket_ids / .blockers server-side, so the row's Linear
   *  cell and ⚑ indicator only update once the page data is refetched. */
  onDataChanged: () => void;
}

function FieldWrapper({
  fieldLabel,
  promote,
  flashed,
  children,
}: {
  fieldLabel: string;
  promote?: () => void;
  flashed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border px-2.5 py-1.5"
      style={{
        background: flashed ? "var(--yellow-soft)" : "var(--field)",
        borderColor: flashed ? "var(--yellow-line)" : "var(--brand-metal-line)",
        transition: "background 700ms ease, border-color 700ms ease",
      }}
    >
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
          {fieldLabel}
        </span>
        {promote ? (
          <button
            type="button"
            onClick={promote}
            title={`Add ${fieldLabel} as a column`}
            className="ml-auto w-[15px] h-[15px] shrink-0 flex items-center justify-center rounded text-[10px] leading-none opacity-55 hover:opacity-100 transition-opacity"
            style={{ color: "var(--yellow-ink)" }}
          >
            +
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DerivedField({ fieldLabel, display }: { fieldLabel: string; display: string }) {
  return (
    <FieldWrapper fieldLabel={fieldLabel} flashed={false}>
      <div className="text-[13px] italic text-[color:var(--muted-foreground)]">{display}</div>
    </FieldWrapper>
  );
}

export function ProcessDetail({
  process,
  list,
  onSelectId,
  customerOptions,
  onUpdated,
  onArchived,
  onClose,
  onAddColumn,
  onDataChanged,
}: ProcessDetailProps) {
  const [proc, setProc] = useState<DetailProcess>(process);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(process.process_name);

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketResults, setTicketResults] = useState<Partial<TicketRow>[]>([]);

  useEffect(() => {
    setProc(process);
  }, [process]);

  // Keyed on the id and the stored name, not the object identity: every
  // router.refresh() rebuilds all row objects, which used to wipe a rename
  // you were halfway through typing.
  useEffect(() => {
    setNameDraft(process.process_name);
  }, [process.id, process.process_name]);

  // Clicking through records quickly fires overlapping requests; without the
  // cancelled flag a slower earlier response could paint the previous
  // process's tickets under the current process's header.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/processes/${proc.id}/tickets`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setTickets(json.tickets ?? []);
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [proc.id]);

  useEffect(() => {
    if (!ticketQuery.trim()) {
      setTicketResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/linear-tickets/search?q=${encodeURIComponent(ticketQuery.trim())}`)
        .then((r) => r.json())
        .then((json) => {
          if (!cancelled) setTicketResults(json.tickets ?? []);
        })
        .catch(() => {
          if (!cancelled) setTicketResults([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ticketQuery]);

  async function commit(field: keyof Process, fieldLabel: string, value: unknown) {
    setError(null);
    try {
      const res = await fetch(`/api/processes/${proc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const updated = json.process as Process;
      setProc((cur) => ({ ...cur, ...updated }));
      onUpdated(updated);
      setSavedField(fieldLabel);
      setTimeout(() => setSavedField((cur) => (cur === fieldLabel ? null : cur)), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function promote(field: keyof Process) {
    const col = FIELD_TO_COL[field];
    if (col) onAddColumn(col);
  }

  async function markReviewed() {
    setReviewBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/processes/${proc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-reviewed" }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.process) throw new Error(json.error || `HTTP ${res.status}`);
      setProc((cur) => ({ ...cur, ...json.process }));
      onUpdated(json.process as Process);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewBusy(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Archive "${proc.process_name}"? It can be restored from All processes.`)) return;
    setArchiveBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/processes/${proc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onArchived(proc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function attachTicket(ticketId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/processes/${proc.id}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setTicketQuery("");
      setTicketResults([]);
      const listed = await fetch(`/api/processes/${proc.id}/tickets`);
      const json = await listed.json();
      setTickets(json.tickets ?? []);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function detachTicket(ticketId: string) {
    const previous = tickets;
    setTickets((cur) => cur.filter((t) => t.id !== ticketId));
    try {
      const res = await fetch(`/api/processes/${proc.id}/tickets?ticket_id=${encodeURIComponent(ticketId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDataChanged();
    } catch (err) {
      // Put it back rather than showing a detached ticket that is still
      // attached in the database.
      setTickets(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const index = list.findIndex((p) => p.id === proc.id);
  const total = list.length;
  // Editing a record can push it out of the active filter. Remember where it
  // was so prev/next stay usable instead of dead-ending on index -1.
  const anchorRef = useRef(0);
  if (index >= 0) anchorRef.current = index;
  const navIndex = index >= 0 ? index : Math.min(anchorRef.current, total - 1);

  const historyEntries = Object.entries(proc.field_provenance ?? {}).sort(
    (a, b) => (b[1]?.at ?? "").localeCompare(a[1]?.at ?? "")
  );

  const confirmedArr = proc.confirmed_arr ?? proc.arr;

  return (
    // `min-h-0` on both the shell and the scroll region is what makes the
    // internal scrollbar work: a flex item defaults to min-height:auto, so it
    // refuses to shrink below its content and overflow-y-auto never engages —
    // the panel just grew past its container and got clipped instead.
    <div className="flex flex-col h-full min-h-0 flex-1">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: "var(--brand-metal-line)" }}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
              {proc.customer_display_name}
            </div>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (nameDraft.trim() && nameDraft !== proc.process_name) {
                  void commit("process_name" as keyof Process, "Process name", nameDraft.trim());
                } else {
                  setNameDraft(proc.process_name);
                }
              }}
              className="dops-field text-[17px] font-semibold tracking-tight"
              style={{ borderColor: "transparent" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand-yellow)")}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0 pt-1">
            <button
              type="button"
              disabled={navIndex <= 0}
              onClick={() => navIndex > 0 && onSelectId(list[navIndex - 1].id)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)] disabled:opacity-30"
              title="Previous"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={navIndex < 0 || navIndex >= total - 1}
              onClick={() => navIndex >= 0 && navIndex < total - 1 && onSelectId(list[navIndex + 1].id)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)] disabled:opacity-30"
              title="Next"
            >
              ›
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--brand-metal-line)]">
            {platformLabel(proc.platform)}
          </span>
          {proc.health ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--brand-metal-line)]">
              {healthLabel(proc.health)}
            </span>
          ) : null}
          <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--brand-metal-line)]">
            updated {staleDays(proc.updated_at)}d ago
          </span>
          <span className="ml-auto text-[10px] font-mono text-[color:var(--muted-foreground)]">
            {index >= 0 ? `${index + 1} of ${total}` : "not in current filter"}
          </span>
          <a href={`/processes/${proc.id}`} className="text-[10px] font-mono text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] underline">
            /processes/{proc.id.slice(0, 8)}
          </a>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
        {proc.needs_attention_reason ? (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {proc.needs_attention_reason}
          </div>
        ) : null}

        {/* Key facts strip */}
        <div className="grid grid-cols-4 divide-x rounded-lg border" style={{ borderColor: "var(--brand-metal-line)" }}>
          <KeyFact label="Migration stage" value={stageLabel(proc.migration_stage)} />
          <KeyFact label="Progress" value={proc.completion_pct != null ? `${Math.round(proc.completion_pct * 100)}%` : "—"} accent />
          <KeyFact
            label={proc.confirmed_arr != null ? "Confirmed ARR" : "ARR (snapshot)"}
            value={formatMoney(confirmedArr ?? null)}
            accent
          />
          <KeyFact label="TTV" value={proc.ttv_days != null ? `${proc.ttv_days}d` : "—"} />
        </div>

        <GroupHeader title="Identity" />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <FieldWrapper fieldLabel="Customer" flashed={savedField === "Customer"}>
            <select
              value={proc.customer_id ?? ""}
              onChange={(e) => void commit("customer_id", "Customer", e.target.value || null)}
              className="dops-field text-[13px]"
            >
              <option value="">—</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </FieldWrapper>
        </div>

        <GroupHeader title="State" />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <SelectField
            fieldLabel="Lifecycle"
            value={proc.lifecycle}
            options={PROCESS_LIFECYCLES}
            optionLabels={LIFECYCLE_LABELS}
            flashed={savedField === "Lifecycle"}
            onCommit={(v) => commit("lifecycle", "Lifecycle", v)}
            onPromote={() => promote("lifecycle")}
          />
          <SelectField
            fieldLabel="Migration stage"
            value={proc.migration_stage}
            options={MIGRATION_STAGES}
            optionLabels={MIGRATION_STAGE_LABELS}
            flashed={savedField === "Migration stage"}
            onCommit={(v) => commit("migration_stage", "Migration stage", v)}
            onPromote={() => promote("migration_stage")}
          />
          <SelectField
            fieldLabel="Phase"
            value={proc.phase}
            options={PROCESS_PHASES}
            optionLabels={PHASE_LABELS}
            flashed={savedField === "Phase"}
            clearable
            onCommit={(v) => commit("phase", "Phase", v)}
            onPromote={() => promote("phase")}
          />
          <SelectField
            fieldLabel="Health"
            value={proc.health}
            options={PROCESS_HEALTHS}
            optionLabels={HEALTH_LABELS}
            flashed={savedField === "Health"}
            clearable
            onCommit={(v) => commit("health", "Health", v)}
            onPromote={() => promote("health")}
          />
          <SelectField
            fieldLabel="Blocked on"
            value={proc.blocked_on}
            options={PROCESS_BLOCKED_ON}
            optionLabels={BLOCKED_ON_LABELS}
            flashed={savedField === "Blocked on"}
            onCommit={(v) => commit("blocked_on", "Blocked on", v)}
          />
          <SelectField
            fieldLabel="Work mode"
            value={proc.work_mode}
            options={PROCESS_WORK_MODES}
            optionLabels={WORK_MODE_LABELS}
            flashed={savedField === "Work mode"}
            clearable
            onCommit={(v) => commit("work_mode", "Work mode", v)}
          />
          <SelectField
            fieldLabel="Platform"
            value={proc.platform}
            options={PROCESS_PLATFORMS}
            optionLabels={PLATFORM_LABELS}
            flashed={savedField === "Platform"}
            onCommit={(v) => commit("platform", "Platform", v)}
            onPromote={() => promote("platform")}
          />
        </div>

        <GroupHeader title="Dates & effort" />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <DateField fieldLabel="Kickoff" value={proc.kickoff_date} flashed={savedField === "Kickoff"} onCommit={(v) => commit("kickoff_date", "Kickoff", v)} onPromote={() => promote("kickoff_date")} />
          <DateField fieldLabel="Go live" value={proc.go_live_date} flashed={savedField === "Go live"} onCommit={(v) => commit("go_live_date", "Go live", v)} onPromote={() => promote("go_live_date")} />
          <DateField fieldLabel="Parity complete" value={proc.date_parity_complete} flashed={savedField === "Parity complete"} onCommit={(v) => commit("date_parity_complete", "Parity complete", v)} />
          <DateField fieldLabel="Customer handover" value={proc.date_customer_handover} flashed={savedField === "Customer handover"} onCommit={(v) => commit("date_customer_handover", "Customer handover", v)} />
          <DateField fieldLabel="Customer validation" value={proc.date_customer_validation} flashed={savedField === "Customer validation"} onCommit={(v) => commit("date_customer_validation", "Customer validation", v)} />
          {/* Stored 0..1, shown 0..100. This field used to bind the raw
              value under a "%" label, so it displayed 0.65 and a user typing
              the obvious 65 wrote completion_pct = 65 — which rendered as
              6500% in the table and blew the progress bar across the row. */}
          <NumberField
            fieldLabel="Completion %"
            value={proc.completion_pct != null ? Math.round(proc.completion_pct * 100) : null}
            min={0}
            max={100}
            flashed={savedField === "Completion %"}
            onCommit={(v) => commit("completion_pct", "Completion %", v == null ? null : clampPct(v) / 100)}
            onPromote={() => promote("completion_pct")}
          />
          <NumberField fieldLabel="Effort hours" value={proc.total_effort_hours} flashed={savedField === "Effort hours"} onCommit={(v) => commit("total_effort_hours", "Effort hours", v)} onPromote={() => promote("total_effort_hours")} />
          <DerivedField fieldLabel="TTV" display={proc.ttv_days != null ? `${proc.ttv_days} days` : "Set once kickoff and go-live are both filled in"} />
        </div>

        <GroupHeader title="Ownership" />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <FieldWrapper fieldLabel="FDE owner" promote={() => promote("fde_owner_id")} flashed={savedField === "FDE owner"}>
            <RosterPicker
              kind="person"
              role="fde"
              valueLabel={proc.fde_owner}
              onPick={(entry: RosterEntry) => commit("fde_owner_id", "FDE owner", entry.id)}
              onClear={() => commit("fde_owner_id", "FDE owner", null)}
            />
          </FieldWrapper>
          <FieldWrapper fieldLabel="TAM owner" promote={() => promote("tam_owner_id")} flashed={savedField === "TAM owner"}>
            <RosterPicker
              kind="person"
              role="tam"
              valueLabel={proc.tam_owner}
              onPick={(entry: RosterEntry) => commit("tam_owner_id", "TAM owner", entry.id)}
              onClear={() => commit("tam_owner_id", "TAM owner", null)}
            />
          </FieldWrapper>
          <FieldWrapper fieldLabel="Partner" promote={() => promote("partner_id")} flashed={savedField === "Partner"}>
            <RosterPicker
              kind="partner_org"
              valueLabel={proc.partner}
              onPick={(entry: RosterEntry) => commit("partner_id", "Partner", entry.id)}
              onClear={() => commit("partner_id", "Partner", null)}
            />
          </FieldWrapper>
        </div>

        <GroupHeader title="Value" />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          {/* The editable column is the one-time import snapshot; the strip
              above prefers Salesforce's confirmed ARR where we have it. */}
          <NumberField
            fieldLabel="ARR (snapshot)"
            value={proc.arr}
            flashed={savedField === "ARR (snapshot)"}
            onCommit={(v) => commit("arr", "ARR (snapshot)", v)}
            onPromote={() => promote("arr")}
          />
          <TextField fieldLabel="Company size" value={proc.company_size} flashed={savedField === "Company size"} onCommit={(v) => commit("company_size", "Company size", v)} />
          <NumberField fieldLabel="Minutes saved / run" value={proc.value_minutes_saved_per_run} flashed={savedField === "Minutes saved / run"} onCommit={(v) => commit("value_minutes_saved_per_run", "Minutes saved / run", v)} />
          <DerivedField
            fieldLabel="Runs this quarter"
            display={proc.k2_process_id ? "—" : "Not linked to a Kognitos automation yet"}
          />
        </div>

        <GroupHeader title="Notes on the record" />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {/* The ⚑ flag in the table reads from `blockers`, which the activity
              feed mirrors into. Without an editable field here a flag raised
              by a note that was later deleted could never be cleared. */}
          <TextField
            fieldLabel="Blocker flag"
            value={proc.blockers}
            flashed={savedField === "Blocker flag"}
            onCommit={(v) => commit("blockers", "Blocker flag", v)}
          />
          <TextField
            fieldLabel="Latest note"
            value={proc.notes}
            flashed={savedField === "Latest note"}
            onCommit={(v) => commit("notes", "Latest note", v)}
          />
        </div>

        <GroupHeader title="Linear tickets" />
        <div className="space-y-1.5">
          {tickets.length === 0 ? (
            <div className="text-[12px] text-[color:var(--muted-foreground)] italic">No tickets attached.</div>
          ) : (
            tickets.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--brand-metal-line)" }}>
                <span className="text-[11px] font-mono text-[color:var(--muted-foreground)]">{t.id}</span>
                <span className="text-[12px] text-[color:var(--foreground)] truncate flex-1">{t.title}</span>
                {t.linear_status ? (
                  <span className="text-[10px] text-[color:var(--muted-foreground)] shrink-0">{t.linear_status}</span>
                ) : null}
                <button type="button" onClick={() => detachTicket(t.id)} className="text-[12px] opacity-50 hover:opacity-100 hover:text-red-500 shrink-0">
                  ×
                </button>
              </div>
            ))
          )}
          <div className="relative">
            <input
              value={ticketQuery}
              onChange={(e) => setTicketQuery(e.target.value)}
              placeholder="Attach a ticket — search Linear…"
              className="dops-input dops-input-dashed w-full px-2.5 py-1.5 text-[12.5px]"
              style={{ borderColor: "var(--brand-metal-line)" }}
            />
            {ticketResults.length > 0 ? (
              <div
                className="dops-rise-in absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border shadow-lg"
                style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--brand-metal-line)" }}
              >
                {ticketResults.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => t.id && attachTicket(t.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--glass-bg)]"
                  >
                    <span className="text-[11px] font-mono text-[color:var(--muted-foreground)]">{t.id}</span>
                    <span className="text-[12px] text-[color:var(--foreground)] truncate">{t.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <GroupHeader title="Activity" />
        <ActivityFeed processId={proc.id} compact onPosted={onDataChanged} />

        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[11px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] flex items-center gap-1"
          >
            <span className="inline-block transition-transform" style={{ transform: historyOpen ? "rotate(90deg)" : "none" }}>
              ▸
            </span>
            Field history · {historyEntries.length} changes
          </button>
          {historyOpen ? (
            <div className="mt-1.5 space-y-1 border-l pl-2.5" style={{ borderColor: "var(--brand-metal-line)" }}>
              {historyEntries.length === 0 ? (
                <div className="text-[11px] italic text-[color:var(--muted-foreground)] py-1">No edits since import.</div>
              ) : (
                historyEntries.map(([field, prov]) => (
                  <div key={field} className="text-[11px] text-[color:var(--muted-foreground)] py-0.5">
                    {fieldName(field)} changed · {prov?.by ?? "unknown"}
                    {prov?.at ? ` · ${staleDays(prov.at)}d ago` : ""}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t flex items-center justify-between gap-3" style={{ borderColor: "var(--brand-metal-line)" }}>
        <div className="text-[11px] text-[color:var(--muted-foreground)] min-w-0 truncate">
          {error ? (
            <span className="text-red-500">{error}</span>
          ) : savedField ? (
            <span style={{ color: "var(--yellow-ink)" }}>{savedField} saved</span>
          ) : (
            <>
              Changes save as you make them.
              {proc.reviewed_at ? (
                <span className="ml-2" style={{ color: "var(--yellow-ink)" }}>
                  reviewed {staleDays(proc.reviewed_at)}d ago
                </span>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={archive}
            disabled={archiveBusy}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold text-red-600 border-red-600/30 hover:bg-red-500/10 disabled:opacity-60"
          >
            {archiveBusy ? "…" : "Archive"}
          </button>
          <button
            type="button"
            onClick={markReviewed}
            disabled={reviewBusy}
            className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          >
            {reviewBusy ? "…" : "Mark reviewed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyFact({ label: l, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-3 py-2 min-w-0">
      <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--muted-foreground)] truncate">{l}</div>
      <div
        className="text-[16px] font-mono font-semibold truncate"
        style={{ color: accent ? "var(--yellow-ink)" : "var(--foreground)" }}
      >
        {value}
      </div>
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">{title}</span>
      <div className="flex-1 h-px" style={{ background: "var(--brand-metal-line)" }} />
    </div>
  );
}

function SelectField<T extends string>({
  fieldLabel,
  value,
  options,
  optionLabels,
  flashed,
  clearable = false,
  onCommit,
  onPromote,
}: {
  fieldLabel: string;
  value: T | null;
  options: readonly T[];
  optionLabels?: Partial<Record<T, string>>;
  flashed: boolean;
  /** Nullable columns need a selectable "—" to get back to null; the
   *  non-nullable ones (lifecycle, migration_stage, platform) don't. */
  clearable?: boolean;
  onCommit: (v: T | null) => void;
  onPromote?: () => void;
}) {
  return (
    <FieldWrapper fieldLabel={fieldLabel} promote={onPromote} flashed={flashed}>
      <select
        value={value ?? ""}
        onChange={(e) => onCommit((e.target.value || null) as T | null)}
        className="dops-field text-[13px]"
      >
        <option value="" disabled={!clearable}>
          —
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabels?.[o] ?? sentenceCase(o)}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

function DateField({
  fieldLabel,
  value,
  flashed,
  onCommit,
  onPromote,
}: {
  fieldLabel: string;
  value: string | null;
  flashed: boolean;
  onCommit: (v: string | null) => void;
  onPromote?: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <FieldWrapper fieldLabel={fieldLabel} promote={onPromote} flashed={flashed}>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value ?? "") && onCommit(draft || null)}
        className="dops-field font-mono text-[13px]"
      />
    </FieldWrapper>
  );
}

function NumberField({
  fieldLabel,
  value,
  flashed,
  min,
  max,
  onCommit,
  onPromote,
}: {
  fieldLabel: string;
  value: number | null;
  flashed: boolean;
  min?: number;
  max?: number;
  onCommit: (v: number | null) => void;
  onPromote?: () => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  useEffect(() => setDraft(value != null ? String(value) : ""), [value]);
  return (
    <FieldWrapper fieldLabel={fieldLabel} promote={onPromote} flashed={flashed}>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft === "" ? null : Number(draft);
          if (next != null && !Number.isFinite(next)) {
            setDraft(value != null ? String(value) : "");
            return;
          }
          if (next !== value) onCommit(next);
        }}
        className="dops-field font-mono text-[13px]"
      />
    </FieldWrapper>
  );
}

function TextField({
  fieldLabel,
  value,
  flashed,
  onCommit,
  onPromote,
}: {
  fieldLabel: string;
  value: string | null;
  flashed: boolean;
  onCommit: (v: string | null) => void;
  onPromote?: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <FieldWrapper fieldLabel={fieldLabel} promote={onPromote} flashed={flashed}>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value ?? "") && onCommit(draft.trim() || null)}
        className="dops-field text-[13px]"
      />
    </FieldWrapper>
  );
}
