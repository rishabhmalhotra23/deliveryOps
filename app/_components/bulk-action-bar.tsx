"use client";

// The floating multi-select action bar. All writes go through
// PATCH /api/processes {ids, patch} and render the partial-failure shape
// {updated, failed} honestly — never claim success for rows that failed.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Delivery workspace
// panel (bulk-select bar).

import { useEffect, useState } from "react";
import {
  MIGRATION_STAGES,
  MIGRATION_STAGE_LABELS,
  PROCESS_HEALTHS,
  type Process,
  type ProcessNoteKind,
  type RosterEntry,
} from "@/lib/supabase/types";
import { RosterPicker } from "@/app/_components/roster-picker";
import { HEALTH_LABELS } from "@/lib/delivery/labels";

export interface BulkResult {
  updated: Process[];
  failed: { id: string; error: string }[];
}

export function BulkActionBar({
  selectedIds,
  onClearSelection,
  onBulkPatch,
  onBulkArchive,
  onBulkNote,
}: {
  selectedIds: string[];
  onClearSelection: () => void;
  onBulkPatch: (ids: string[], patch: Partial<Process>) => Promise<BulkResult>;
  onBulkArchive: (ids: string[]) => Promise<BulkResult>;
  onBulkNote: (ids: string[], body: string, kind: ProcessNoteKind) => Promise<BulkResult>;
}) {
  const [dialog, setDialog] = useState<null | "owner" | "stage" | "health" | "note">(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteKind, setNoteKind] = useState<ProcessNoteKind>("note");

  // The bar unmounts its own output when the selection empties, but the state
  // lives on — without this, an abandoned "Add note" dialog (and its draft)
  // reappeared the next time any row was selected.
  useEffect(() => {
    if (selectedIds.length === 0) {
      setDialog(null);
      setNoteDraft("");
      setBanner(null);
      setError(null);
    }
  }, [selectedIds.length]);

  if (selectedIds.length === 0) return null;

  function report(result: BulkResult, verb: string) {
    setBanner(
      result.failed.length > 0
        ? `${verb} ${result.updated.length}, ${result.failed.length} failed.`
        : `${verb} ${result.updated.length}.`
    );
    setTimeout(() => setBanner(null), 3600);
  }

  async function patch(p: Partial<Process>) {
    setBusy(true);
    setError(null);
    try {
      report(await onBulkPatch(selectedIds, p), "Updated");
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    const n = selectedIds.length;
    if (!window.confirm(`Archive ${n} process${n > 1 ? "es" : ""}? This can be undone per row.`)) return;
    setBusy(true);
    setError(null);
    try {
      report(await onBulkArchive(selectedIds), "Archived");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function postNote() {
    if (!noteDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onBulkNote(selectedIds, noteDraft.trim(), noteKind);
      setBanner(
        result.failed.length > 0
          ? `Posted to ${selectedIds.length - result.failed.length}, ${result.failed.length} failed.`
          : `Posted to ${selectedIds.length} process${selectedIds.length > 1 ? "es" : ""}.`
      );
      setTimeout(() => setBanner(null), 3600);
      setNoteDraft("");
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="dops-rise-in-centred fixed left-1/2 bottom-6 z-40 -translate-x-1/2 rounded-xl border shadow-2xl px-3 py-2 flex items-center gap-2"
        style={{ background: "var(--surface-1, var(--card))", borderColor: "var(--brand-metal-line)" }}
      >
        <span className="text-[12.5px] font-mono font-semibold" style={{ color: "var(--yellow-ink)" }}>
          {selectedIds.length}
        </span>
        <span className="text-[12px] text-[color:var(--muted-foreground)]">selected</span>
        <div className="w-px h-4" style={{ background: "var(--brand-metal-line)" }} />
        <BarButton onClick={() => setDialog("owner")}>Change owner</BarButton>
        <BarButton onClick={() => setDialog("stage")}>Change stage</BarButton>
        <BarButton onClick={() => setDialog("health")}>Change health</BarButton>
        <BarButton onClick={() => setDialog("note")}>Add note</BarButton>
        <BarButton onClick={archive} disabled={busy} tone="danger">
          Archive
        </BarButton>
        <button type="button" onClick={onClearSelection} className="ml-1 text-[12px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
          Clear
        </button>
      </div>

      {banner || error ? (
        <div
          className="dops-rise-in-centred fixed left-1/2 bottom-20 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-[12px] shadow-lg"
          style={{
            background: "var(--surface-3, var(--card))",
            borderColor: error ? "var(--status-bad)" : "var(--brand-metal-line)",
            color: error ? "var(--status-bad)" : "var(--foreground)",
          }}
        >
          {error ?? banner}
        </div>
      ) : null}

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDialog(null)}>
          <div
            className="dops-rise-in w-full max-w-sm rounded-2xl border p-4 space-y-3 shadow-2xl"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {dialog === "owner" ? (
              <>
                <div className="text-sm font-semibold text-[color:var(--foreground)]">Change owner for {selectedIds.length} processes</div>
                <RosterPicker
                  kind="person"
                  role="fde"
                  valueLabel={null}
                  onPick={(entry: RosterEntry) => void patch({ fde_owner_id: entry.id })}
                />
              </>
            ) : null}
            {dialog === "stage" ? (
              <>
                <div className="text-sm font-semibold text-[color:var(--foreground)]">Change migration stage for {selectedIds.length} processes</div>
                <div className="max-h-64 overflow-auto space-y-1">
                  {MIGRATION_STAGES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => void patch({ migration_stage: s })}
                      className="w-full text-left rounded-md px-2.5 py-1.5 text-[13px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)]"
                    >
                      {MIGRATION_STAGE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {dialog === "health" ? (
              <>
                <div className="text-sm font-semibold text-[color:var(--foreground)]">Change health for {selectedIds.length} processes</div>
                <div className="space-y-1">
                  {PROCESS_HEALTHS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      disabled={busy}
                      onClick={() => void patch({ health: h })}
                      className="w-full text-left rounded-md px-2.5 py-1.5 text-[13px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)]"
                    >
                      {HEALTH_LABELS[h]}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {dialog === "note" ? (
              <>
                <div className="text-sm font-semibold text-[color:var(--foreground)]">Add a note to {selectedIds.length} processes</div>
                <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--brand-metal-line)" }}>
                  <button type="button" onClick={() => setNoteKind("note")} className="px-2 py-0.5 rounded-full text-[11px]" style={noteKind === "note" ? { background: "var(--yellow-soft)" } : undefined}>
                    Note
                  </button>
                  <button type="button" onClick={() => setNoteKind("blocker")} className="px-2 py-0.5 rounded-full text-[11px]" style={noteKind === "blocker" ? { background: "var(--yellow-soft)" } : undefined}>
                    Blocker
                  </button>
                </div>
                <textarea
                  autoFocus
                  rows={3}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Posted identically to every selected process's activity feed."
                  className="dops-input w-full px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: "var(--brand-metal-line)" }}
                />
              </>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDialog(null)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
                Cancel
              </button>
              {dialog === "note" ? (
                <button type="button" onClick={postNote} disabled={busy || !noteDraft.trim()} className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                  {busy ? "…" : "Post"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-2.5 py-1 text-[12px] font-medium disabled:opacity-60 ${
        tone === "danger" ? "text-red-500 hover:bg-red-500/10" : "text-[color:var(--foreground)] hover:bg-[var(--glass-bg)]"
      }`}
    >
      {children}
    </button>
  );
}
