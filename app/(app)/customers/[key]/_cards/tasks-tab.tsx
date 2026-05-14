"use client";

import { useEffect, useState } from "react";
import type { CuratorTask } from "@/lib/supabase/types";

interface TasksTabProps {
  customerKey: string;
}

type ScheduleType = "once" | "recurring" | "cron";
type ActionType = "remind" | "check" | "run_prompt";
type ChannelType = "slack" | "email" | "internal";

interface DraftTask {
  description: string;
  scheduleType: ScheduleType;
  scheduleAt: string;
  scheduleEvery: string;
  scheduleCron: string;
  actionType: ActionType;
  actionChannel: ChannelType;
  actionMessage: string;
  actionPrompt: string;
}

const EMPTY_DRAFT: DraftTask = {
  description: "",
  scheduleType: "once",
  scheduleAt: "",
  scheduleEvery: "1d",
  scheduleCron: "0 9 * * 1",
  actionType: "remind",
  actionChannel: "slack",
  actionMessage: "",
  actionPrompt: "",
};

function formatNext(t: CuratorTask): string {
  if (t.next_run) return new Date(t.next_run).toLocaleString();
  if (t.schedule.at) return new Date(t.schedule.at).toLocaleString();
  if (t.schedule.cron) return `cron: ${t.schedule.cron}`;
  if (t.schedule.every) return `every ${t.schedule.every}`;
  return "—";
}

export function TasksTab({ customerKey }: TasksTabProps) {
  const [tasks, setTasks] = useState<CuratorTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<DraftTask>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/customers/${customerKey}/tasks${showCompleted ? "?include_completed=true" : ""}`;
      const res = await fetch(url);
      const json = (await res.json()) as { tasks?: CuratorTask[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setTasks(json.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerKey, showCompleted]);

  async function cancel(taskId: string) {
    if (!confirm(`Cancel task ${taskId}?`)) return;
    try {
      const res = await fetch(`/api/customers/${customerKey}/tasks?task_id=${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      alert(`Failed to cancel: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function submit() {
    if (!draft.description.trim()) {
      alert("Description is required.");
      return;
    }
    setSubmitting(true);
    try {
      const schedule: Record<string, string> = { type: draft.scheduleType };
      if (draft.scheduleType === "once") schedule.at = draft.scheduleAt;
      if (draft.scheduleType === "recurring") schedule.every = draft.scheduleEvery;
      if (draft.scheduleType === "cron") schedule.cron = draft.scheduleCron;

      const action: Record<string, string> = {
        type: draft.actionType,
        channel: draft.actionChannel,
      };
      if (draft.actionType === "remind") action.message = draft.actionMessage;
      if (draft.actionType === "run_prompt" || draft.actionType === "check") {
        action.prompt = draft.actionPrompt;
      }

      const res = await fetch(`/api/customers/${customerKey}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: draft.description, schedule, action }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      await load();
    } catch (err) {
      alert(`Failed to create task: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSubmitting(false);
    }
  }

  const active = tasks.filter((t) => t.status === "active" || t.status === "paused");
  const inactive = tasks.filter((t) => t.status === "completed" || t.status === "failed");

  return (
    <div className="glass-card glass-card-hover p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow text-[color:var(--muted-foreground)]">Tasks</div>
          <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
            Scheduled reminders, checks, and agent runs
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[color:var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            Show completed
          </label>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs"
          >
            {showForm ? "Cancel" : "+ New task"}
          </button>
        </div>
      </div>

      {showForm ? (
        <div className="border border-[var(--glass-border)] rounded-lg p-4 space-y-3 bg-[var(--glass-bg)]">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
              Description
            </label>
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="e.g. Follow up on Q3 renewal terms"
              className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-3 py-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                Schedule
              </label>
              <select
                value={draft.scheduleType}
                onChange={(e) => setDraft({ ...draft, scheduleType: e.target.value as ScheduleType })}
                className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
              >
                <option value="once">Once</option>
                <option value="recurring">Recurring</option>
                <option value="cron">Cron</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                {draft.scheduleType === "once"
                  ? "At (ISO)"
                  : draft.scheduleType === "recurring"
                  ? "Every (1h / 1d / 1w)"
                  : "Cron expression"}
              </label>
              {draft.scheduleType === "once" ? (
                <input
                  type="datetime-local"
                  value={draft.scheduleAt}
                  onChange={(e) => setDraft({ ...draft, scheduleAt: e.target.value })}
                  className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
                />
              ) : draft.scheduleType === "recurring" ? (
                <input
                  type="text"
                  value={draft.scheduleEvery}
                  onChange={(e) => setDraft({ ...draft, scheduleEvery: e.target.value })}
                  className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
                />
              ) : (
                <input
                  type="text"
                  value={draft.scheduleCron}
                  onChange={(e) => setDraft({ ...draft, scheduleCron: e.target.value })}
                  className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm font-mono"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                Action
              </label>
              <select
                value={draft.actionType}
                onChange={(e) => setDraft({ ...draft, actionType: e.target.value as ActionType })}
                className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
              >
                <option value="remind">Remind</option>
                <option value="check">Check (agent run)</option>
                <option value="run_prompt">Run prompt (agent)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                Channel
              </label>
              <select
                value={draft.actionChannel}
                onChange={(e) => setDraft({ ...draft, actionChannel: e.target.value as ChannelType })}
                className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
              >
                <option value="slack">Slack</option>
                <option value="email">Email</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                {draft.actionType === "remind" ? "Message" : "Prompt"}
              </label>
              <input
                type="text"
                value={draft.actionType === "remind" ? draft.actionMessage : draft.actionPrompt}
                onChange={(e) =>
                  draft.actionType === "remind"
                    ? setDraft({ ...draft, actionMessage: e.target.value })
                    : setDraft({ ...draft, actionPrompt: e.target.value })
                }
                placeholder={draft.actionType === "remind" ? "Reminder text" : "What should the agent do?"}
                className="w-full rounded-md border border-[var(--glass-border)] bg-[color:var(--background)] px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create task"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="text-xs text-[color:var(--muted-foreground)]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-500">Error: {error}</div>
      ) : tasks.length === 0 ? (
        <div className="text-xs text-[color:var(--muted-foreground)]">
          No tasks yet. Use “+ New task” or ask the agent.
        </div>
      ) : (
        <div className="space-y-3">
          <TaskSection title="Active" tasks={active} onCancel={cancel} />
          {showCompleted ? <TaskSection title="Done" tasks={inactive} onCancel={cancel} /> : null}
        </div>
      )}
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  onCancel,
}: {
  title: string;
  tasks: CuratorTask[];
  onCancel: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div className="eyebrow text-[color:var(--muted-foreground)] mb-1.5">
        {title} · {tasks.length}
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[color:var(--foreground)] truncate">
                {t.description || t.name || t.id}
              </div>
              <div className="text-[10px] tracking-wider text-[color:var(--muted-foreground)] uppercase">
                {t.schedule.type}
                {" · "}
                {formatNext(t)}
                {" · "}
                {t.action.type}
                {t.action.channel ? `→${t.action.channel}` : ""}
                {" · "}
                <span className="font-mono">{t.id}</span>
              </div>
            </div>
            {t.status === "active" ? (
              <button
                onClick={() => onCancel(t.id)}
                className="text-xs text-[color:var(--muted-foreground)] hover:text-red-500 transition-colors"
              >
                Cancel
              </button>
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                {t.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
