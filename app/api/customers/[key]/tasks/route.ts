import { NextResponse } from "next/server";
import { cancelTask, createTask, listTasks } from "@/lib/tasks/tasks";
import { parseBody, TaskCreateSchema } from "@/lib/api/schemas";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ key: string }> }
const log = logger("api/tasks");

export async function GET(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const url = new URL(request.url);
  const includeCompleted = url.searchParams.get("include_completed") === "true";
  try {
    const tasks = await listTasks(key, { includeCompleted });
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load tasks." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const parsed = await parseBody(request, TaskCreateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const task = await createTask(key, parsed.data);
    log.info("Task created", { customer_key: key, task_id: task.id });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    log.error("Failed to create task", { customer_key: key, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create task." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const url = new URL(request.url);
  const taskId = url.searchParams.get("task_id") ?? "";
  if (!taskId) return NextResponse.json({ error: "Missing task_id." }, { status: 400 });
  try {
    const ok = await cancelTask(key, taskId);
    return NextResponse.json({ cancelled: ok });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel task." },
      { status: 500 }
    );
  }
}
