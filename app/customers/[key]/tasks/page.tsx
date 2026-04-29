import { listTasks } from "@/lib/tasks/tasks";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function TasksPage({ params }: Props) {
  const { key } = await params;
  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  let error: string | null = null;
  try {
    tasks = await listTasks(key, { includeCompleted: true });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <div className="font-medium mb-1">Couldn&rsquo;t load tasks.</div>
        <p className="text-[color:var(--brand-gray)]">{error}</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-6 text-sm text-[color:var(--brand-gray)]">
        No tasks. The agent creates these via <code>create_task</code>; you can also drop them in directly.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const sched = t.schedule;
        const schedStr = sched.at ?? sched.cron ?? sched.every ?? "—";
        return (
          <li
            key={t.id}
            className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm"
          >
            <div className="flex justify-between gap-3">
              <span className="font-medium">{t.description ?? t.name}</span>
              <span
                className={`text-xs uppercase tracking-wider ${
                  t.status === "active"
                    ? "text-[color:var(--brand-night)]"
                    : "text-[color:var(--brand-gray)]"
                }`}
              >
                {t.status}
              </span>
            </div>
            <div className="text-xs text-[color:var(--brand-gray)] mt-1 tabular-nums">
              schedule: {sched.type} · {schedStr}
              {t.next_run ? ` · next ${new Date(t.next_run).toLocaleString()}` : ""}
              {t.last_run ? ` · last ${new Date(t.last_run).toLocaleString()}` : ""}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
