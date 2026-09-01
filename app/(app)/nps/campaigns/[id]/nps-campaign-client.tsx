"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NpsCampaign, NpsCampaignRecipient } from "@/lib/supabase/types";

type RecipientRow = NpsCampaignRecipient & { customer_display_name: string };

const STATUS_LABEL: Record<NpsCampaignRecipient["status"], string> = {
  queued: "Queued",
  sent: "Sent",
  responded: "Responded",
  failed: "Failed",
};

const inputClass =
  "w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]";

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-US") : "—";
}

export function NpsCampaignClient({
  campaign: initialCampaign,
  recipients: initialRecipients,
}: {
  campaign: NpsCampaign;
  recipients: RecipientRow[];
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [editingTemplates, setEditingTemplates] = useState(false);
  const [templates, setTemplates] = useState({
    invite_subject: campaign.invite_subject,
    invite_body: campaign.invite_body,
    reminder_subject: campaign.reminder_subject,
    reminder_body: campaign.reminder_body,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveTemplates() {
    setBusy("templates");
    setError(null);
    try {
      const res = await fetch(`/api/nps/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCampaign(json.campaign);
      setEditingTemplates(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!confirm(`Send this survey to ${recipients.length} recipient(s)? This can't be undone.`)) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(`/api/nps/campaigns/${campaign.id}/send`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCampaign((c) => ({ ...c, status: "sending" }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remindAll() {
    if (!confirm("Send a reminder to every recipient who hasn't responded yet?")) return;
    setBusy("remind-all");
    setError(null);
    try {
      const res = await fetch(`/api/nps/campaigns/${campaign.id}/remind-all`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function closeCampaign() {
    if (!confirm("Close this campaign? It will stop receiving automatic reminders.")) return;
    setBusy("close");
    setError(null);
    try {
      const res = await fetch(`/api/nps/campaigns/${campaign.id}/close`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCampaign(json.campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remindOne(recipientId: string) {
    setBusy(`remind-${recipientId}`);
    setError(null);
    try {
      const res = await fetch(`/api/nps/campaigns/${campaign.id}/recipients/${recipientId}/remind`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRecipients((rows) => rows.map((r) => (r.id === recipientId ? { ...r, ...json.recipient } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)] uppercase tracking-wider">
            {campaign.status}
          </span>
          <span className="text-sm text-[color:var(--muted-foreground)]">
            {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "draft" ? (
            <button
              type="button"
              onClick={send}
              disabled={busy !== null || recipients.length === 0}
              className="btn-primary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {busy === "send" ? "Sending…" : "Send"}
            </button>
          ) : null}
          {campaign.status === "active" || campaign.status === "sending" ? (
            <button
              type="button"
              onClick={remindAll}
              disabled={busy !== null}
              className="rounded-full px-4 py-2 text-sm font-semibold border border-[var(--glass-border)] disabled:opacity-60"
            >
              {busy === "remind-all" ? "Sending…" : "Remind all pending"}
            </button>
          ) : null}
          {campaign.status !== "closed" ? (
            <button
              type="button"
              onClick={closeCampaign}
              disabled={busy !== null}
              className="rounded-full px-4 py-2 text-sm font-semibold text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] disabled:opacity-60"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="text-[12px] text-red-600">{error}</div> : null}

      <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[color:var(--foreground)]">Email templates</div>
          {campaign.status === "draft" ? (
            <button
              type="button"
              onClick={() => setEditingTemplates((v) => !v)}
              className="text-[12px] underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            >
              {editingTemplates ? "Cancel" : "Edit"}
            </button>
          ) : null}
        </div>
        {editingTemplates ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                Invite subject
              </label>
              <input
                value={templates.invite_subject}
                onChange={(e) => setTemplates((t) => ({ ...t, invite_subject: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                Invite body
              </label>
              <textarea
                value={templates.invite_body}
                onChange={(e) => setTemplates((t) => ({ ...t, invite_body: e.target.value }))}
                rows={8}
                className={`${inputClass} resize-y font-mono`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                Reminder subject
              </label>
              <input
                value={templates.reminder_subject}
                onChange={(e) => setTemplates((t) => ({ ...t, reminder_subject: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                Reminder body
              </label>
              <textarea
                value={templates.reminder_body}
                onChange={(e) => setTemplates((t) => ({ ...t, reminder_body: e.target.value }))}
                rows={8}
                className={`${inputClass} resize-y font-mono`}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveTemplates}
                disabled={busy !== null}
                className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              >
                {busy === "templates" ? "Saving…" : "Save templates"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-[color:var(--muted-foreground)] space-y-1">
            <div>
              <span className="font-medium text-[color:var(--foreground)]">Invite:</span> {campaign.invite_subject}
            </div>
            <div>
              <span className="font-medium text-[color:var(--foreground)]">Reminder:</span> {campaign.reminder_subject}
            </div>
          </div>
        )}
      </div>

      {recipients.length === 0 ? (
        <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 p-6 text-sm text-[color:var(--muted-foreground)]">
          No recipients matched a known customer_key on upload.
        </div>
      ) : (
        <div className="glass-card dark:bg-[color:var(--surface-1)] dark:border-0 overflow-hidden">
          <div className="overflow-x-auto p-2 dark:p-2.5">
            <table className="w-full text-sm dark:border-separate dark:[border-spacing:0_4px]">
              <thead className="bg-[var(--glass-bg)] dark:bg-transparent text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Customer</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Email</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Status</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Sent</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">Reminders</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Last reminder</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-left">Opened (score)</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-right" />
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => {
                  const td = "dark:bg-[color:var(--surface-2)]";
                  return (
                    <tr key={r.id} className="border-t border-[var(--glass-border)] dark:border-0 align-top">
                      <td className={`px-3 py-2 font-medium text-[color:var(--foreground)] dark:rounded-l-lg ${td}`}>
                        {r.customer_display_name}
                      </td>
                      <td className={`px-3 py-2 text-[color:var(--muted-foreground)] ${td}`}>{r.email}</td>
                      <td className={`px-3 py-2 ${td}`}>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--glass-border)]">
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className={`px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] ${td}`}>
                        {fmtDate(r.sent_at)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)] ${td}`}>
                        {r.reminder_count}
                      </td>
                      <td className={`px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] ${td}`}>
                        {fmtDate(r.last_reminder_at)}
                      </td>
                      <td className={`px-3 py-2 tabular-nums text-[color:var(--muted-foreground)] ${td}`}>
                        {r.quick_score != null ? `${r.quick_score}/10 (${fmtDate(r.quick_score_at)})` : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right dark:rounded-r-lg ${td}`}>
                        <button
                          type="button"
                          onClick={() => remindOne(r.id)}
                          disabled={busy !== null || r.status !== "sent"}
                          className="text-[11px] underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] disabled:opacity-40 disabled:no-underline"
                        >
                          {busy === `remind-${r.id}` ? "Sending…" : "Remind"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
