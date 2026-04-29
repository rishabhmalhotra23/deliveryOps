import { inngest } from "../client";
import { runAgent } from "@/lib/agent/runner";
import { markTaskFailed, markTaskRun } from "@/lib/tasks/tasks";
import { requireCustomerByKey } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";
import type { CuratorTask } from "@/lib/supabase/types";
import { postMessage } from "@/lib/slack/client";

export const runTask = inngest.createFunction(
  { id: "run-task", retries: 2 },
  { event: "delivery-ops/task.run" },
  async ({ event, step }) => {
    const task = event.data as CuratorTask;
    if (!task?.id) throw new Error("run-task: missing task in event payload.");

    const ranAt = new Date();

    try {
      await step.run("dispatch", async () => {
        const customer = await requireCustomerByKey(
          (await getCustomerKeyForTask(task)) ?? ""
        );
        const customerKey = customer.key;
        const channel = task.action.channel ?? "internal";
        const message = task.action.message ?? task.description ?? "Reminder";

        switch (task.action.type) {
          case "remind": {
            await postReminder(customerKey, channel, message);
            break;
          }
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
            const result = await runAgent({
              customerKey,
              userMessage: prompt,
              source: "web",
            });
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
      });

      await step.run("mark-run", async () => markTaskRun(task.id, ranAt));
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markTaskFailed(task.id, message);
      throw err;
    }
  }
);

async function getCustomerKeyForTask(task: CuratorTask): Promise<string | null> {
  // The task row stores customer_id (uuid). Resolve it back to a key without
  // bloating runAgent's signature.
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
    case "email": {
      // Email reminders post a draft via the email-approval flow once that
      // ports — until then, log for visibility.
      await appendEvent(
        customerKey,
        "TASK_EMAIL_QUEUED",
        { body },
        { summary: "Email reminder queued (email-approval port pending).", tags: ["task", "email"] }
      );
      return;
    }
    case "internal":
    default: {
      await postMessage("cs-internal", `[${customerKey}] ${body}`).catch(() => {
        /* internal channel not configured — drop silently */
      });
      return;
    }
  }
}
