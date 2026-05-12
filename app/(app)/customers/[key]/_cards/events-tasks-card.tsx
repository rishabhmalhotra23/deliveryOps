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
  EmptyState,
  Text,
} from "@kognitos/lattice";
import type { EventsTasksCardProps } from "@/lib/customers/view-model";

export function EventsTasksCard({ events, activeTasks, className }: EventsTasksCardProps & { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Events + scheduled tasks</CardTitle>
        <Text level="xSmall" color="muted">
          {events.length} event{events.length === 1 ? "" : "s"} · {activeTasks.length} active task{activeTasks.length === 1 ? "" : "s"}
        </Text>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Events */}
        <Accordion type="single" collapsible>
          <AccordionItem value="events">
            <AccordionTrigger>Recent events ({events.length})</AccordionTrigger>
            <AccordionContent>
              {events.length === 0 ? (
                <EmptyState
                  icon="Activity"
                  title="No events yet"
                  description="Profile changes, agent actions, and ingested documents all appear here."
                />
              ) : (
                <ul className="divide-y divide-border pt-1">
                  {events.map((e) => (
                    <li key={e.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <Text level="small" weight="medium">{e.summary}</Text>
                        <Text level="xSmall" color="muted" className="tabular-nums shrink-0">
                          {new Date(e.ts).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      </div>
                      <Text level="xSmall" color="muted">
                        {e.event_type}
                        {e.tags.length > 0 ? ` · ${e.tags.join(", ")}` : ""}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Tasks */}
        <Accordion type="single" collapsible>
          <AccordionItem value="tasks">
            <AccordionTrigger>Active tasks ({activeTasks.length})</AccordionTrigger>
            <AccordionContent>
              {activeTasks.length === 0 ? (
                <EmptyState
                  icon="Clock"
                  title="No active tasks"
                  description="Ask the agent to set a reminder or recurring check and it'll appear here."
                />
              ) : (
                <ul className="divide-y divide-border pt-1">
                  {activeTasks.map((t) => (
                    <li key={t.id} className="py-2 flex items-baseline justify-between gap-2">
                      <Text level="small" weight="medium">{t.description ?? t.name}</Text>
                      {t.next_run ? (
                        <Text level="xSmall" color="muted" className="tabular-nums shrink-0">
                          next {t.next_run}
                        </Text>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}