// POST /api/jobs/run-task
//
// Background job: execute a single scheduled task (reminder / check /
// run_prompt). Triggered by the /api/cron/run-tasks cron, which finds due
// tasks every cron tick and dispatches one job per task.

import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/runner";
import { markTaskFailed, markTaskRun } from "@/lib/tasks/tasks";
import { requireCustomerByKey } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import type { CuratorTask } from "@/lib/supabase/types";
import { postMessage } from "@/lib/slack/client";
import { assertJobAuth } from "@/lib/jobs/dispatch";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = logger("jobs.run-task");

export async function POST(request: Request) {
  const authErr = await assertJobAuth(request);
  if (authErr) return authErr;

  let task: CuratorTask;
  try {
    task = (await request.json()) as CuratorTask;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!task?.id) {
    return NextResponse.json({ error: "Missing task in payload." }, { status: 400 });
  }

  const ranAt = new Date();
  try {
    const customerKey = await getCustomerKeyForTask(task);
    if (!customerKey) throw new Error(`No customer for task ${task.id}`);
    const channel = task.action.channel ?? "internal";
    const message = task.action.message ?? task.description ?? "Reminder";

    switch (task.action.type) {
      case "remind":
        await postReminder(customerKey, channel, message);
        break;
      case "check": {
        const result = await runAgent({
          customerKey,
          userMessage: `Run a health check for this customer. ${task.description ?? ""}`.trim(),
          source: "web",
        });
        await postReminder(customerKey, channel, result.text);
        break;
      }
      case "run_prompt": {
        const prompt = task.action.prompt ?? task.description ?? "Run a check.";
        const result = await runAgent({ customerKey, userMessage: prompt, source: "web" });
        await postReminder(customerKey, channel, result.text);
        break;
      }
    }

    await appendEvent(
      customerKey,
      "TASK_EXECUTED",
      { task_id: task.id, description: task.description ?? "" },
      { summary: `Task executed: ${task.description ?? task.id}`, tags: ["task"] }
    );
    await markTaskRun(task.id, ranAt);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markTaskFailed(task.id, msg).catch(() => {});
    log.error("task failed", { task: task.id, ...errorCtx(err) });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function getCustomerKeyForTask(task: CuratorTask): Promise<string | null> {
  const { requireAdmin } = await import("@/lib/supabase/server");
  const sb = requireAdmin();
  const { data } = await sb
    .from("customers")
    .select("key")
    .eq("id", task.customer_id)
    .maybeSingle();
  return (data as { key: string } | null)?.key ?? null;
}

async function postReminder(customerKey: string, channel: string, body: string): Promise<void> {
  switch (channel) {
    case "slack": {
      const customer = await requireCustomerByKey(customerKey);
      const slackChannel = customer.slack_channel ?? customer.key;
      await postMessage(slackChannel, body);
      return;
    }
    case "email":
      await appendEvent(customerKey, "TASK_EMAIL_QUEUED", { body },
        { summary: "Email reminder queued (email-approval port pending).", tags: ["task", "email"] });
      return;
    case "internal":
    default:
      await postMessage("cs-internal", `[${customerKey}] ${body}`).catch(() => {});
      return;
  }
}
