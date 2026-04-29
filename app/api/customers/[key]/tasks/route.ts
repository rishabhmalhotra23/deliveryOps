import { NextResponse } from "next/server";

import { cancelTask, createTask, listTasks } from "@/lib/tasks/tasks";
import type { TaskAction, TaskSchedule } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

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
  let body: {
    description?: string;
    schedule?: TaskSchedule;
    action?: TaskAction;
    name?: string;
    tags?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.description || !body.schedule || !body.action) {
    return NextResponse.json(
      { error: "description, schedule, and action are required." },
      { status: 400 }
    );
  }
  try {
    const task = await createTask(key, {
      description: body.description,
      schedule: body.schedule,
      action: body.action,
      name: body.name,
      tags: body.tags,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
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
