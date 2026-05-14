"use client";

import { useEffect, useState } from "react";
import { Markdown } from "@kognitos/lattice";

interface RulesTabProps {
  customerKey: string;
}

export function RulesTab({ customerKey }: RulesTabProps) {
  const [rules, setRules] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerKey}/rules`);
      const json = (await res.json()) as { rules?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const text = json.rules ?? "";
      setRules(text);
      setDraft(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerKey]);

  async function save() {
    if (!draft.trim()) {
      alert("Rules cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerKey}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: draft }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setRules(draft);
      setEditing(false);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card glass-card-hover p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow text-[color:var(--muted-foreground)]">Customer rules</div>
          <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
            Per-customer dos and don&apos;ts — injected into every agent system prompt
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={() => {
                  setDraft(rules);
                  setEditing(false);
                }}
                className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save rules"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-[color:var(--muted-foreground)]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-500">Error: {error}</div>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={20}
          className="w-full font-mono text-xs rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-3 py-2 leading-relaxed"
        />
      ) : (
        <div className="chat-markdown text-sm text-[color:var(--foreground)]">
          <Markdown textProps={{ level: "small" }}>{rules || "_No rules set yet._"}</Markdown>
        </div>
      )}
    </div>
  );
}
