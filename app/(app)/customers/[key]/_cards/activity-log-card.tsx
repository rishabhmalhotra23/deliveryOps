"use client";

import type { ActivityLogCardProps } from "@/lib/customers/view-model";
import type { MondayActivityCache } from "@/lib/cache/integrations";

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "bg-red-500",
  High: "bg-amber-500",
  Medium: "bg-blue-400",
  Low: "bg-slate-400",
};

const STATUS_COLOR: Record<string, string> = {
  Open: "text-blue-500",
  "In Progress": "text-amber-500",
  Closed: "text-[color:var(--muted-foreground)]",
  Resolved: "text-emerald-500",
  Blocked: "text-red-500",
};

function ActivityRow({ item }: { item: MondayActivityCache }) {
  const title = item.ai_summary ?? item.name;
  const transcriptUrl = item.source_link?.match(/https?:\/\/\S+/)?.[0] ?? null;
  const dotColor = PRIORITY_COLOR[item.priority ?? ""] ?? "bg-[color:var(--muted-foreground)]";
  const statusColor = STATUS_COLOR[item.status ?? ""] ?? "text-[color:var(--muted-foreground)]";

  return (
    <div className="flex gap-3 group">
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${dotColor}`} />
        <div className="flex-1 w-px bg-[var(--glass-border)] mt-1" />
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          {item.status ? (
            <span className={`data-label font-semibold ${statusColor}`}>{item.status}</span>
          ) : null}
          {item.due_date ? (
            <span className="data-label text-[color:var(--muted-foreground)]">due {item.due_date}</span>
          ) : null}
          {item.created_date ? (
            <span className="data-label text-[color:var(--muted-foreground)]">{item.created_date}</span>
          ) : null}
        </div>
        <p className="text-sm text-[color:var(--foreground)] tracking-tight leading-snug">{title}</p>
        {item.meeting_excerpt ? (
          <details className="mt-1 group/detail">
            <summary className="text-xs text-[color:var(--muted-foreground)] cursor-pointer hover:text-[color:var(--foreground)] list-none select-none">
              ▸ meeting context
            </summary>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)] leading-relaxed whitespace-pre-line max-w-prose">
              {item.meeting_excerpt}
            </p>
          </details>
        ) : null}
        {transcriptUrl ? (
          <a
            href={transcriptUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] underline decoration-[color:var(--brand-yellow)] decoration-1 underline-offset-2 transition-colors"
          >
            view transcript ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function ActivityLogCard({ customerName, activities, openCount, className }: ActivityLogCardProps & { className?: string }) {
  const sorted = [...activities].sort((a, b) => {
    const da = a.created_date ?? a.monday_updated_at ?? "";
    const db = b.created_date ?? b.monday_updated_at ?? "";
    return db.localeCompare(da);
  });
  const displayed = sorted.slice(0, 25);

  return (
    <div className={`glass-card overflow-hidden ${className ?? ""}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--glass-border)] flex items-center justify-between gap-2">
        <div>
          <div className="eyebrow text-[color:var(--muted-foreground)]">Activity log</div>
          <h3 className="text-sm font-semibold tracking-tighter text-[color:var(--foreground)] mt-0.5">
            {openCount > 0 ? `${openCount} open item${openCount === 1 ? "" : "s"}` : "All items resolved"}
          </h3>
        </div>
        <span className="data-label text-[color:var(--muted-foreground)]">{activities.length} total</span>
      </div>

      {/* Timeline */}
      <div className="px-4 pt-4">
        {displayed.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[color:var(--muted-foreground)]">No activity log entries</p>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-1 max-w-xs mx-auto">
              Items appear when Monday&apos;s activity board links to {customerName}.
            </p>
          </div>
        ) : (
          displayed.map((item) => (
            <ActivityRow key={item.monday_item_id} item={item} />
          ))
        )}
        {activities.length > 25 ? (
          <p className="pb-4 text-xs text-[color:var(--muted-foreground)] data-label">
            + {activities.length - 25} more items
          </p>
        ) : null}
      </div>
    </div>
  );
}
