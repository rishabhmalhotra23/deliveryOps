// Scheduled tasks — port of legacy/scheduler/{task_store,executor}.py.
// Schedule kinds: once / recurring / cron. Schedules + actions are JSONB so
// the legacy shapes survive verbatim. The executor lives in
// app/api/jobs/run-task/route.ts (replaces APScheduler), dispatched by the
// /api/cron/run-tasks Vercel cron.

import { requireAdmin } from "@/lib/supabase/server";
import {
  TABLES,
  type CuratorTask,
  type TaskAction,
  type TaskSchedule,
} from "@/lib/supabase/types";
import { requireCustomerByKey } from "@/lib/customers";

export async function createTask(
  customerKey: string,
  input: {
    description: string;
    schedule: TaskSchedule;
    action: TaskAction;
    name?: string;
    tags?: string[];
  }
): Promise<CuratorTask> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  const nextRun = computeNextRun(input.schedule, null);

  const { data, error } = await sb
    .from(TABLES.tasks)
    .insert({
      customer_id: customer.id,
      name: input.name ?? input.description.slice(0, 80),
      description: input.description,
      schedule: input.schedule,
      action: input.action,
      tags: input.tags ?? [],
      next_run: nextRun?.toISOString() ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CuratorTask;
}

export async function listTasks(
  customerKey: string,
  opts: { includeCompleted?: boolean } = {}
): Promise<CuratorTask[]> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  let q = sb
    .from(TABLES.tasks)
    .select("*")
    .eq("customer_id", customer.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!opts.includeCompleted) q = q.eq("status", "active");

  const { data, error } = await q;
  if (error) throw error;
  return (data as CuratorTask[]) ?? [];
}

export async function cancelTask(customerKey: string, taskId: string): Promise<boolean> {
  const customer = await requireCustomerByKey(customerKey);
  const sb = requireAdmin();

  const { data, error } = await sb
    .from(TABLES.tasks)
    .update({ status: "completed", deleted_at: new Date().toISOString() })
    .eq("customer_id", customer.id)
    .eq("id", taskId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function listDueTasks(now: Date = new Date()): Promise<CuratorTask[]> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.tasks)
    .select("*")
    .eq("status", "active")
    .is("deleted_at", null)
    .lte("next_run", now.toISOString());
  if (error) throw error;
  return (data as CuratorTask[]) ?? [];
}

export async function markTaskRun(taskId: string, ranAt: Date): Promise<void> {
  const sb = requireAdmin();
  const { data: existing, error: fetchErr } = await sb
    .from(TABLES.tasks)
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) return;

  const task = existing as CuratorTask;
  const next = computeNextRun(task.schedule, ranAt);
  const status = task.schedule.type === "once" ? "completed" : task.status;

  const { error } = await sb
    .from(TABLES.tasks)
    .update({
      last_run: ranAt.toISOString(),
      next_run: next?.toISOString() ?? null,
      status,
    })
    .eq("id", taskId);
  if (error) throw error;
}

export async function markTaskFailed(taskId: string, message: string): Promise<void> {
  const sb = requireAdmin();
  await sb
    .from(TABLES.tasks)
    .update({ status: "failed", last_run: new Date().toISOString() })
    .eq("id", taskId);
  console.warn("[tasks] %s failed: %s", taskId, message);
}

// ─── schedule math ───────────────────────────────────────────────────────────

function parseInterval(s: string): number | null {
  const m = /^(\d+)\s*([hdwm])$/i.exec(s.trim());
  if (!m) return null;
  const val = Number(m[1]);
  const unit = m[2].toLowerCase();
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return val * (multipliers[unit] ?? 0) || null;
}

export function computeNextRun(schedule: TaskSchedule, lastRun: Date | null): Date | null {
  switch (schedule.type) {
    case "once": {
      if (!schedule.at) return null;
      const target = new Date(schedule.at);
      if (lastRun && target <= lastRun) return null;
      return target;
    }
    case "recurring": {
      if (!schedule.every) return null;
      const ms = parseInterval(schedule.every);
      if (!ms) return null;
      const base = lastRun ?? new Date();
      const next = new Date(base.getTime() + ms);
      if (schedule.until && next > new Date(schedule.until)) return null;
      return next;
    }
    case "cron":
      // Vercel Cron handles cron resolution at the trigger level — we just
      // store the expression and let the cron route filter on each tick.
      return null;
    default:
      return null;
  }
}

const CRON_PARTS = 5;

export function cronIsDue(expr: string, now: Date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== CRON_PARTS) return false;
  const [minute, hour, dom, month, dow] = parts;
  const matches = (field: string, value: number): boolean => {
    if (field === "*") return true;
    for (const item of field.split(",")) {
      if (/^\d+$/.test(item) && Number(item) === value) return true;
      const range = /^(\d+)-(\d+)$/.exec(item);
      if (range && Number(range[1]) <= value && value <= Number(range[2])) return true;
      const step = /^\*\/(\d+)$/.exec(item);
      if (step && Number(step[1]) > 0 && value % Number(step[1]) === 0) return true;
    }
    return false;
  };
  const utc = now;
  return (
    matches(minute, utc.getUTCMinutes()) &&
    matches(hour, utc.getUTCHours()) &&
    matches(dom, utc.getUTCDate()) &&
    matches(month, utc.getUTCMonth() + 1) &&
    matches(dow, utc.getUTCDay())
  );
}
