"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Badge,
  EmptyState,
  Text,
} from "@kognitos/lattice";
import type { ActivityLogCardProps } from "@/lib/customers/view-model";

const PRIORITY_VARIANT: Record<string, "destructive" | "warning" | "default" | "secondary"> = {
  Critical: "destructive",
  High: "warning",
  Medium: "default",
  Low: "secondary",
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  Open: "default",
  "In Progress": "default",
  Closed: "secondary",
  Resolved: "success",
  Blocked: "destructive",
};

export function ActivityLogCard({ customerName, activities, openCount, className }: ActivityLogCardProps & { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            {openCount > 0 ? `Open action items (${openCount})` : "Activity log"}
          </CardTitle>
          <Text level="xSmall" color="muted">{activities.length} total</Text>
        </div>
        <Text level="xSmall" color="muted">from Monday Activity Log · Fireflies meeting summaries</Text>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <EmptyState
            icon="List"
            title="No activity log entries"
            description={`Items appear here when Monday's "Customer:" header in a Fireflies transcript names "${customerName}", or when the board-relation column is populated.`}
          />
        ) : (
          <Accordion type="single" collapsible defaultValue={openCount > 0 ? "items" : undefined}>
            <AccordionItem value="items">
              <AccordionTrigger>
                Show {activities.length} item{activities.length === 1 ? "" : "s"}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-3 pt-2">
                  {activities.slice(0, 20).map((a) => {
                    const title = a.ai_summary ?? a.name;
                    const transcriptUrl = a.source_link?.match(/https?:\/\/\S+/)?.[0] ?? null;
                    return (
                      <li key={a.monday_item_id} className="border-l-2 border-primary/40 pl-3 py-0.5">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          {a.priority ? (
                            <Badge variant={PRIORITY_VARIANT[a.priority] ?? "outline"} className="text-[10px]">
                              {a.priority}
                            </Badge>
                          ) : null}
                          {a.status ? (
                            <Badge variant={STATUS_VARIANT[a.status] ?? "outline"} className="text-[10px]">
                              {a.status}
                            </Badge>
                          ) : null}
                          {a.due_date ? (
                            <Text level="xSmall" color="muted" as="span">due {a.due_date}</Text>
                          ) : null}
                        </div>
                        <Text level="small" weight="medium">{title}</Text>
                        {a.meeting_excerpt ? (
                          <details className="mt-1 group">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none">
                              ▸ meeting context
                            </summary>
                            <Text level="xSmall" color="muted" className="mt-1 leading-relaxed whitespace-pre-line max-w-prose">
                              {a.meeting_excerpt}
                            </Text>
                          </details>
                        ) : null}
                        <div className="flex gap-3 mt-1">
                          {a.created_date ? (
                            <Text level="xSmall" color="muted" as="span">logged {a.created_date}</Text>
                          ) : null}
                          {transcriptUrl ? (
                            <a
                              href={transcriptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs underline decoration-primary decoration-2 underline-offset-4"
                            >
                              transcript
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                  {activities.length > 20 ? (
                    <li className="text-xs text-muted-foreground tabular-nums">
                      + {activities.length - 20} more
                    </li>
                  ) : null}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}