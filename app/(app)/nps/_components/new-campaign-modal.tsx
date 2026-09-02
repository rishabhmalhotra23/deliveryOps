"use client";

// New campaign creation. Visual pattern matches
// app/(app)/delivery/_components/new-process-modal.tsx: a solid var(--card)
// background, not the translucent .glass-card class — this modal is a
// full-screen overlay stacked on top of the live campaign list, and
// .glass-card's ~5% opacity is fine for a normal in-flow card but lets
// content behind it bleed through / ghost when stacked over other content
// (fixed 2026-09-01 on the Delivery "New Process" modal for the same reason).

import { useState } from "react";
import {
  DEFAULT_INVITE_SUBJECT,
  DEFAULT_INVITE_BODY,
  DEFAULT_REMINDER_SUBJECT,
  DEFAULT_REMINDER_BODY,
  currentFiscalQuarter,
} from "@/lib/nps/constants";

const inputClass =
  "w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]";

interface UploadResult {
  campaignId: string;
  recipientCount: number;
  errors: string[];
}

// nps_responses.quarter is stored "<quarter-digit>Q<2-digit-year>" (e.g.
// "4Q25", "1Q26") -- the format the 84 historical rows already use and
// every existing quarter-sort helper (lib/analytics/loader.ts,
// lib/dashboard/stats-drilldown.ts, lib/customers/view-model.ts,
// lib/nps/history.ts) parses. A free-text field here previously let an
// admin type "Q1'26", which none of those sort correctly -- composing it
// from two selects makes the wrong format unreachable.
//
// The year in "year" is Kognitos's FISCAL year (Feb-Jan, named after the
// year it ends in), not the raw calendar year -- defaulting to
// currentFiscalQuarter() means the common case (today's quarter) needs no
// mental math; the 2026-09-02 historical backfill exists precisely because
// an earlier version of this picker defaulted to calendar year instead and
// silently produced a quarter label a full FY off for anything after
// January.
const DEFAULT_FQ = currentFiscalQuarter();
const YEAR_OPTIONS = [DEFAULT_FQ.year - 1, DEFAULT_FQ.year, DEFAULT_FQ.year + 1];

export function NewCampaignModal({
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: (campaignId: string) => void;
}) {
  const [quarterNum, setQuarterNum] = useState<number>(DEFAULT_FQ.quarterNum);
  const [year, setYear] = useState(DEFAULT_FQ.year);
  const quarter = `${quarterNum}Q${String(year).slice(-2)}`;
  const [file, setFile] = useState<File | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [inviteSubject, setInviteSubject] = useState(DEFAULT_INVITE_SUBJECT);
  const [inviteBody, setInviteBody] = useState(DEFAULT_INVITE_BODY);
  const [reminderSubject, setReminderSubject] = useState(DEFAULT_REMINDER_SUBJECT);
  const [reminderBody, setReminderBody] = useState(DEFAULT_REMINDER_BODY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function submit() {
    if (busy || !file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("quarter", quarter);
      form.set("file", file);
      form.set("inviteSubject", inviteSubject);
      form.set("inviteBody", inviteBody);
      form.set("reminderSubject", reminderSubject);
      form.set("reminderBody", reminderBody);

      const res = await fetch("/api/nps/campaigns", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult({
        campaignId: json.campaign.id,
        recipientCount: json.recipients?.length ?? 0,
        errors: json.errors ?? [],
      });
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
        className="w-full max-w-lg rounded-2xl border p-5 space-y-3 shadow-2xl max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
          New NPS campaign
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="text-sm text-[color:var(--foreground)]">
              {result.recipientCount} recipient{result.recipientCount === 1 ? "" : "s"} added.
              {result.errors.length > 0
                ? ` ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped:`
                : " No email has been sent yet."}
            </div>
            {result.errors.length > 0 ? (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-300 max-h-40 overflow-y-auto space-y-0.5">
                {result.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onContinue(result.campaignId)}
                className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                Continue to campaign →
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                Quarter
              </label>
              <div className="flex gap-2">
                <select
                  value={quarterNum}
                  onChange={(e) => setQuarterNum(Number(e.target.value))}
                  className={inputClass}
                >
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      Q{q}
                    </option>
                  ))}
                </select>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Kognitos fiscal year (Feb–Jan) — defaults to the current quarter.
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                Recipient CSV
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={inputClass}
              />
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Columns: customer_key, email, respondent_name (optional), respondent_type (optional).
                Rows with an unknown customer_key are reported, not sent to.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTemplates((v) => !v)}
              className="text-[12px] underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            >
              {showTemplates ? "Hide" : "Customize"} email templates
            </button>

            {showTemplates ? (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    Invite subject
                  </label>
                  <input value={inviteSubject} onChange={(e) => setInviteSubject(e.target.value)} className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    Invite body
                  </label>
                  <textarea
                    value={inviteBody}
                    onChange={(e) => setInviteBody(e.target.value)}
                    rows={6}
                    className={`${inputClass} resize-y font-mono`}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    Reminder subject
                  </label>
                  <input value={reminderSubject} onChange={(e) => setReminderSubject(e.target.value)} className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    Reminder body
                  </label>
                  <textarea
                    value={reminderBody}
                    onChange={(e) => setReminderBody(e.target.value)}
                    rows={6}
                    className={`${inputClass} resize-y font-mono`}
                  />
                </div>
              </div>
            ) : null}

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
                disabled={busy || !file}
                className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              >
                {busy ? "Uploading…" : "Upload & preview"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
