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
import type { ContactsCardProps } from "@/lib/customers/view-model";

export function ContactsCard({ contacts, className }: ContactsCardProps & { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
        <Text level="xSmall" color="muted">from Salesforce · {contacts.length} contact{contacts.length === 1 ? "" : "s"}</Text>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <EmptyState
            icon="Users"
            title="No contacts yet"
            description="SF Contacts linked to this account appear here after the next profile backfill."
          />
        ) : (
          <Accordion type="single" collapsible>
            <AccordionItem value="contacts">
              <AccordionTrigger>
                View {contacts.length} contact{contacts.length === 1 ? "" : "s"}
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-3 sm:grid-cols-2 pt-2">
                  {contacts.slice(0, 12).map((c, i) => (
                    <div
                      key={`${c.email || c.name}-${i}`}
                      className="rounded-md border border-border bg-muted/30 p-3"
                    >
                      <Text level="small" weight="medium">{c.name || "(unnamed)"}</Text>
                      {c.role ? <Text level="xSmall" color="muted">{c.role}</Text> : null}
                      <div className="mt-2 space-y-1">
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="block text-xs truncate underline decoration-primary decoration-2 underline-offset-4"
                          >
                            {c.email}
                          </a>
                        ) : null}
                        {c.phone ? (
                          <a
                            href={`tel:${c.phone.replace(/\s+/g, "")}`}
                            className="block text-xs text-muted-foreground"
                          >
                            {c.phone}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}