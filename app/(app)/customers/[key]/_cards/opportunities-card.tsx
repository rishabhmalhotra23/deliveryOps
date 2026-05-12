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
import { fmtMoney, type OpportunitiesCardProps } from "@/lib/customers/view-model";

function oppBadgeVariant(o: { is_won: boolean; is_closed: boolean; probability: number | null }): "success" | "secondary" | "default" | "outline" {
  if (o.is_won) return "success";
  if (o.is_closed) return "secondary";
  if ((o.probability ?? 0) >= 70) return "default";
  return "outline";
}

function oppBadgeLabel(o: { is_won: boolean; is_closed: boolean; stage_name: string | null; probability: number | null }): string {
  if (o.is_won) return "Won";
  if (o.is_closed) return "Lost";
  return o.stage_name ?? "Open";
}

export function OpportunitiesCard({
  accountName,
  accountIndustry,
  accountRevenue,
  accountEmployees,
  accountOwner,
  accountHq,
  accountWebsite,
  accountPhone,
  sfAccountId,
  opportunities,
  cases,
  salesforceSyncedAt,
  className,
}: OpportunitiesCardProps & { className?: string }) {
  const openOpps = opportunities.filter((o) => !o.is_closed);
  const wonOpps = opportunities.filter((o) => o.is_won);
  const openCases = cases.filter((c) => !c.is_closed);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Salesforce</CardTitle>
          {salesforceSyncedAt ? (
            <Text level="xSmall" color="muted">
              synced {relTime(salesforceSyncedAt)}
            </Text>
          ) : null}
        </div>
        {accountName ? (
          <Text level="small" color="muted">
            {accountName}
            {accountIndustry ? ` · ${accountIndustry}` : ""}
          </Text>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {!sfAccountId ? (
          <EmptyState
            icon="Link2"
            title="No Salesforce account mapped"
            description="Use the import flow or operations chat to link a Salesforce account."
          />
        ) : (
          <>
            {/* Quick account facts */}
            {accountName ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 pb-3 border-b border-border text-sm">
                <KV label="Revenue" value={fmtMoney(accountRevenue)} />
                <KV label="Employees" value={accountEmployees?.toLocaleString() ?? "—"} />
                <KV label="HQ" value={accountHq} />
                <KV label="Owner" value={accountOwner} />
                {accountWebsite ? (
                  <div className="col-span-2">
                    <Text level="xSmall" color="muted">Website</Text>
                    <a
                      href={accountWebsite.startsWith("http") ? accountWebsite : `https://${accountWebsite}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline decoration-primary decoration-2 underline-offset-4"
                    >
                      {accountWebsite}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Opportunities */}
            {opportunities.length > 0 ? (
              <Accordion type="single" collapsible defaultValue="opps">
                <AccordionItem value="opps">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <span>Opportunities ({opportunities.length})</span>
                      <Badge variant="outline" className="text-xs">
                        {openOpps.length} open · {wonOpps.length} won
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-1 pt-1">
                      {opportunities.map((o) => (
                        <div
                          key={o.sf_id}
                          className="flex items-baseline justify-between gap-3 py-2 border-b border-border last:border-0"
                        >
                          <div className="min-w-0 flex-1">
                            <Text level="small" weight="medium" className="truncate">
                              {o.name}
                            </Text>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant={oppBadgeVariant(o)} className="text-[10px]">
                                {oppBadgeLabel(o)}
                              </Badge>
                              {o.close_date ? (
                                <Text level="xSmall" color="muted">
                                  {o.close_date}
                                </Text>
                              ) : null}
                            </div>
                          </div>
                          <Text level="small" weight="semibold" className="tabular-nums shrink-0">
                            {fmtMoney(o.amount)}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : (
              <EmptyState
                icon="DollarSign"
                title="No opportunities"
                description="Salesforce opportunities for this account will appear here once synced."
              />
            )}

            {/* Cases */}
            {cases.length > 0 ? (
              <Accordion type="single" collapsible>
                <AccordionItem value="cases">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <span>Cases ({cases.length})</span>
                      {openCases.length > 0 ? (
                        <Badge variant="warning" className="text-xs">
                          {openCases.length} open
                        </Badge>
                      ) : null}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-1 pt-1">
                      {cases.map((c) => (
                        <div
                          key={c.sf_id}
                          className="py-2 border-b border-border last:border-0"
                        >
                          <div className="flex items-baseline gap-2">
                            <Text level="xSmall" color="muted">
                              {c.case_number}
                            </Text>
                            <Text level="small" weight="medium">
                              {c.subject ?? "(no subject)"}
                            </Text>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={c.is_closed ? "secondary" : "outline"} className="text-[10px]">
                              {c.status ?? "—"}
                            </Badge>
                            {c.priority ? (
                              <Badge variant="outline" className="text-[10px]">
                                {c.priority}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <Text level="xSmall" color="muted">{label}</Text>
      <Text level="small">{value ?? "—"}</Text>
    </div>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}