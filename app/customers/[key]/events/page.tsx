import { listEvents } from "@/lib/events/events";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function EventsPage({ params }: Props) {
  const { key } = await params;
  let events: Awaited<ReturnType<typeof listEvents>> = [];
  let error: string | null = null;
  try {
    events = await listEvents(key, { limit: 200 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <div className="font-medium mb-1">Couldn&rsquo;t load events.</div>
        <p className="text-[color:var(--brand-gray)]">{error}</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-6 text-sm text-[color:var(--brand-gray)]">
        No events yet. They land here automatically as documents get ingested, agent calls fire, and tasks run.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((e) => (
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
          {e.details && Object.keys(e.details).length > 0 ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]">
                details
              </summary>
              <pre className="mt-1 overflow-auto whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(e.details, null, 2)}
              </pre>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
