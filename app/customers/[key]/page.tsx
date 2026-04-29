import { getProfile } from "@/lib/profile/profile";
import { listEvents } from "@/lib/events/events";
import { listTasks } from "@/lib/tasks/tasks";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function CustomerOverview({ params }: Props) {
  const { key } = await params;

  const [profile, events, tasks] = await Promise.all([
    safe(getProfile(key)),
    safe(listEvents(key, { limit: 8 })),
    safe(listTasks(key)),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          label="ARR"
          value={
            profile.value
              ? `$${(profile.value.arr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : "—"
          }
          sub={profile.value?.tier ?? "tier unknown"}
        />
        <Stat
          label="Active automations"
          value={profile.value ? String(profile.value.automations_live) : "—"}
          sub={`${profile.value?.active_users ?? 0} active users`}
        />
        <Stat
          label="Renewal"
          value={profile.value?.renewal_date ?? "—"}
          sub={profile.value?.deployment_stage ?? "—"}
        />
      </div>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
          Recent events
        </h2>
        {events.error ? (
          <ErrorBox message={events.error} />
        ) : events.value && events.value.length > 0 ? (
          <ul className="space-y-2">
            {events.value.map((e) => (
              <li
                key={e.id}
                className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm"
              >
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{e.summary}</span>
                  <span className="text-xs text-[color:var(--brand-gray)] tabular-nums">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--brand-gray)] mt-1">
                  {e.event_type}
                  {e.tags.length > 0 ? ` · ${e.tags.join(", ")}` : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyBox text="No events yet. Drop a file in the customer Slack channel or have someone @mention us." />
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--brand-gray)] mb-2">
          Active tasks
        </h2>
        {tasks.error ? (
          <ErrorBox message={tasks.error} />
        ) : tasks.value && tasks.value.length > 0 ? (
          <ul className="space-y-2">
            {tasks.value.map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm"
              >
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{t.description ?? t.name}</span>
                  <span className="text-xs text-[color:var(--brand-gray)]">{t.status}</span>
                </div>
                <div className="text-xs text-[color:var(--brand-gray)] mt-1 tabular-nums">
                  Next run: {t.next_run ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyBox text="No active tasks. The agent can create reminders / recurring checks via create_task." />
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1">{value}</div>
      {sub ? <div className="text-xs text-[color:var(--brand-gray)] mt-1">{sub}</div> : null}
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-4 text-sm text-[color:var(--brand-gray)]">
      {text}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
      <div className="font-medium mb-1">Couldn&rsquo;t load this section.</div>
      <div className="text-[color:var(--brand-gray)]">{message}</div>
    </div>
  );
}

async function safe<T>(p: Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    const value = await p;
    return { value, error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}
