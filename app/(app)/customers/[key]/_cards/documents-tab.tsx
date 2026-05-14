"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface DocumentsTabProps {
  customerKey: string;
}

interface DocumentRow {
  package_id: string;
  filename: string;
  category: string;
  source: string;
  ingested_at: string;
  original_path: string | null;
  organized_path: string | null;
  summary: string;
  snippet?: string;
  match_count?: number;
}

const CATEGORIES = [
  "all",
  "contracts",
  "meeting-notes",
  "sops",
  "support",
  "onboarding",
  "invoices",
  "reports",
  "presentations",
  "correspondence",
  "other",
] as const;

const CATEGORY_TONE: Record<string, string> = {
  contracts: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  "meeting-notes": "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  sops: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  support: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  onboarding: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  invoices: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  reports: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  presentations: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20",
  correspondence: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  other: "bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] border-[var(--glass-border)]",
};

export function DocumentsTab({ customerKey }: DocumentsTabProps) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (qOverride?: string, catOverride?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const q = qOverride ?? query;
        const cat = catOverride ?? category;
        if (q.trim()) params.set("q", q.trim());
        if (cat && cat !== "all") params.set("category", cat);
        const res = await fetch(`/api/customers/${customerKey}/documents?${params.toString()}`);
        const json = (await res.json()) as { documents?: DocumentRow[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setDocs(json.documents ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [customerKey, query, category]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerKey, category]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSubmitting(true);
    setUploadStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        const res = await fetch(`/api/customers/${customerKey}/upload`, {
          method: "POST",
          body: form,
        });
        if (!res.ok && res.status !== 202) {
          const text = await res.text();
          throw new Error(`Upload ${file.name} failed: ${text}`);
        }
      }
      setUploadStatus(
        `Queued. The ingestion pipeline runs in the background — check the Activity tab in a minute.`
      );
      await load();
    } catch (err) {
      setUploadStatus(`Upload failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="glass-card glass-card-hover p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow text-[color:var(--muted-foreground)]">Documents</div>
          <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
            Every file we&apos;ve ingested for this customer — search + drag-drop
          </div>
        </div>
        <form onSubmit={onSearch} className="flex gap-2 items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search filename, summary, or content…"
            className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-3 py-1.5 text-sm w-72"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs"
          >
            Search
          </button>
        </form>
      </div>

      {/* Drag-drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-[var(--brand-yellow)] bg-[rgba(242,255,112,0.08)]"
            : "border-[var(--glass-border)] hover:border-[var(--brand-yellow)] hover:bg-[var(--glass-bg)]"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => uploadFiles(e.target.files)}
          accept="application/pdf,image/*,text/*,.md,.csv,.json,.docx,.xlsx,.pptx"
        />
        <div className="text-sm text-[color:var(--muted-foreground)]">
          {submitting
            ? uploadStatus
            : "Drop files here or click to upload — PDFs, images, transcripts, docs"}
        </div>
        {uploadStatus && !submitting ? (
          <div className="text-[11px] text-[color:var(--muted-foreground)] mt-1">{uploadStatus}</div>
        ) : null}
      </div>

      {loading ? (
        <div className="text-xs text-[color:var(--muted-foreground)]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-500">Error: {error}</div>
      ) : docs.length === 0 ? (
        <div className="text-xs text-[color:var(--muted-foreground)]">
          {query
            ? `No documents matched "${query}"${category !== "all" ? ` in ${category}` : ""}.`
            : "No documents ingested yet. Drop files above, attach them in Slack, or send to the customer's email alias."}
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.package_id || d.filename}
              className="border border-[var(--glass-border)] rounded-md p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[color:var(--foreground)] truncate">
                      {d.filename}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_TONE[d.category] ?? CATEGORY_TONE.other}`}
                    >
                      {d.category}
                    </span>
                    {d.match_count ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--brand-yellow)] text-[color:var(--brand-night)] font-medium">
                        {d.match_count} hit{d.match_count === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mt-0.5">
                    {d.source} · {new Date(d.ingested_at).toLocaleString()}
                  </div>
                  {d.snippet ? (
                    <div className="text-xs text-[color:var(--muted-foreground)] mt-1.5 italic">
                      …{highlightQuery(d.snippet, query)}…
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function highlightQuery(snippet: string, query: string): React.ReactNode {
  if (!query.trim()) return snippet;
  const lower = snippet.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return snippet;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="bg-[var(--brand-yellow)] text-[color:var(--brand-night)] rounded px-0.5">
        {snippet.slice(idx, idx + q.length)}
      </mark>
      {snippet.slice(idx + q.length)}
    </>
  );
}
