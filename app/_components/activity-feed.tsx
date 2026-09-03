"use client";

// Replaces `processes.notes`/`processes.blockers` as the editing surface:
// append-only, attributed, timestamped, newest first. Posting a Blocker also
// flags the record (mirrored server-side into processes.blockers — see
// lib/processes/notes.ts). Notes are soft-deletable. Genuinely reused as a
// sub-component: standalone in the Roster/Activity mockup panel, and
// embedded (compact) inside Process Detail's Activity section.
// Approved design: 2026-09-03-v2-delivery-redesign.html, Activity feed panel.

import { useEffect, useState } from "react";
import { formatTimeAgo } from "@/app/_components/brand";
import type { ProcessNote, ProcessNoteKind } from "@/lib/supabase/types";

function initials(name: string): string {
  if (!name || name === "unknown") return "?";
  const base = name.includes("@") ? name.split("@")[0] : name;
  const parts = base.split(/[.\s_]+/).filter(Boolean);
  const s = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return s || base.slice(0, 2).toUpperCase();
}

export function ActivityFeed({
  processId,
  compact = false,
  onPosted,
}: {
  processId: string;
  compact?: boolean;
  /** A blocker post mirrors into processes.blockers server-side, so the
   *  caller needs a chance to refresh surfaces that read that column. */
  onPosted?: () => void;
}) {
  const [notes, setNotes] = useState<ProcessNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<ProcessNoteKind>("note");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guarded against out-of-order responses when the parent switches records
  // faster than the requests resolve.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/processes/${processId}/notes`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setNotes(json.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [processId]);

  async function post() {
    if (!draft.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/processes/${processId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim(), kind }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNotes((prev) => [json.note as ProcessNote, ...prev]);
      setDraft("");
      onPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    const prev = notes;
    setNotes((cur) => cur.filter((n) => n.id !== id));
    try {
      const res = await fetch(`/api/processes/${processId}/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setNotes(prev); // reconcile — the delete didn't actually happen
    }
  }

  return (
    <div
      className="rounded-lg border"
      style={{
        background: compact ? "transparent" : "var(--surface-1, var(--card))",
        borderColor: compact ? "var(--brand-metal-line)" : "var(--brand-metal-line)",
      }}
    >
      <div className="p-2.5 space-y-2">
        <div className="flex gap-2">
          <span
            className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold"
            style={{ width: 26, height: 26, background: "var(--brand-yellow)", color: "#171717" }}
          >
            ·
          </span>
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              kind === "blocker"
                ? "What is blocking this, and on whom?"
                : "Add a note — what changed, what you decided, what you are waiting on."
            }
            className="dops-input flex-1 px-2.5 py-1.5 text-[13px] resize-y"
            style={{ borderColor: "var(--brand-metal-line)" }}
          />
        </div>
        <div className="flex items-center gap-2 pl-[34px] flex-wrap">
          <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--brand-metal-line)" }}>
            <button
              type="button"
              onClick={() => setKind("note")}
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={kind === "note" ? { background: "var(--yellow-soft)" } : undefined}
            >
              Note
            </button>
            <button
              type="button"
              onClick={() => setKind("blocker")}
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={kind === "blocker" ? { background: "var(--yellow-soft)" } : undefined}
            >
              Blocker
            </button>
          </div>
          {!compact ? (
            <span className="text-[10.5px] text-[color:var(--muted-foreground)]">
              {kind === "blocker" ? "Posting a blocker also flags the record" : "Appends to the feed — nothing is overwritten"}
            </span>
          ) : null}
          <button
            type="button"
            onClick={post}
            disabled={posting || !draft.trim()}
            className="btn-primary ml-auto rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-60"
          >
            {posting ? "…" : "Post"}
          </button>
        </div>
        {error ? <div className="pl-[34px] text-[11px] text-red-600">{error}</div> : null}
      </div>
      <div className="border-t overflow-auto" style={{ borderColor: "var(--brand-metal-line)", maxHeight: compact ? 280 : 520 }}>
        {loading ? (
          <div className="p-3 text-[12px] text-[color:var(--muted-foreground)]">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="p-3 text-[12px] text-[color:var(--muted-foreground)] italic">No activity yet.</div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="flex gap-2 px-2.5 py-2 border-t first:border-t-0" style={{ borderColor: "var(--brand-metal-line)" }}>
              <span
                className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold"
                style={{ width: 26, height: 26, background: "var(--surface-3, var(--muted))" }}
              >
                {initials(n.created_by)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-medium text-[color:var(--foreground)]">{n.created_by}</span>
                  {n.kind === "blocker" ? (
                    <span
                      className="text-[9.5px] px-1.5 py-0.5 rounded-full border"
                      style={{ color: "var(--status-bad)", borderColor: "var(--status-bad)", background: "rgba(248,113,113,0.12)" }}
                    >
                      Blocker
                    </span>
                  ) : null}
                  <span className="ml-auto text-[10.5px] text-[color:var(--muted-foreground)]">{formatTimeAgo(n.created_at)}</span>
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    title="Delete"
                    className="text-[11px] opacity-50 hover:opacity-100 hover:text-red-500"
                  >
                    ×
                  </button>
                </div>
                <p className="text-[12.5px] leading-relaxed mt-0.5 text-[color:var(--foreground)] [text-wrap:pretty]">
                  {n.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
