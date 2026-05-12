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
  Text,
} from "@kognitos/lattice";
import { fmtMoney, type MetadataCardProps } from "@/lib/customers/view-model";

export function MetadataCard({
  tier,
  deploymentStage,
  renewalDate,
  arr,
  creditLimit,
  automationsLive,
  activeUsers,
  salesforceAccountId,
  mondayItemId,
  mondayWorkspaceId,
  slackChannel,
  emailAlias,
  driveFolderId,
  kognitosV1DepartmentId,
  kognitosV2WorkspaceId,
  protectedFields,
  lastManuallyEditedAt,
  className,
}: MetadataCardProps & { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Profile + technical IDs</CardTitle>
        <Text level="xSmall" color="muted">
          Derived fields and external system identifiers — for plumbing and debugging, not daily-work.
        </Text>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Profile facts */}
        <Accordion type="single" collapsible>
          <AccordionItem value="profile">
            <AccordionTrigger>Profile fields</AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 pt-2 text-sm">
                <IdField label="Tier" value={tier} />
                <IdField label="Deployment stage" value={deploymentStage} />
                <IdField label="Renewal date" value={renewalDate} />
                <IdField label="Profile ARR" value={arr ? fmtMoney(arr) : null} />
                <IdField label="Credit limit" value={creditLimit ? fmtMoney(creditLimit) : null} />
                <IdField label="Automations live" value={automationsLive > 0 ? String(automationsLive) : null} />
                <IdField label="Active users" value={activeUsers > 0 ? String(activeUsers) : null} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Technical IDs */}
        <Accordion type="single" collapsible>
          <AccordionItem value="ids">
            <AccordionTrigger>External IDs</AccordionTrigger>
            <AccordionContent>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                <IdRow label="Salesforce account" value={salesforceAccountId} />
                <IdRow label="Monday item" value={mondayItemId} />
                <IdRow label="Monday workspace" value={mondayWorkspaceId} />
                <IdRow label="Slack channel" value={slackChannel ? `#${slackChannel}` : null} />
                <IdRow label="Email alias" value={emailAlias} />
                <IdRow label="Drive folder" value={driveFolderId} />
                <IdRow label="Kognitos v1 dept" value={kognitosV1DepartmentId} />
                <IdRow label="Kognitos v2 workspace" value={kognitosV2WorkspaceId} />
              </dl>
              {/* Future-signal placeholders — shown only if integrations are half-wired */}
              {(slackChannel || driveFolderId) ? (
                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  {slackChannel ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">Phase 3</Badge>
                      <Text level="xSmall" color="muted">Slack thread feed (Google/Slack integration coming)</Text>
                    </div>
                  ) : null}
                  {driveFolderId ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">Phase 3</Badge>
                      <Text level="xSmall" color="muted">Drive files (Google integration coming)</Text>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Protected fields callout */}
        {protectedFields.length > 0 ? (
          <div className="pt-2 border-t border-border flex flex-wrap items-center gap-2">
            <Text level="xSmall" color="muted">Locked from sync:</Text>
            {protectedFields.map((f) => (
              <Badge key={f} variant="warning" className="text-[10px]">{f}</Badge>
            ))}
            {lastManuallyEditedAt ? (
              <Text level="xSmall" color="muted">
                last edited {relTime(lastManuallyEditedAt)}
              </Text>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IdField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <Text level="xSmall" color="muted">{label}</Text>
      <Text level="small">{value ?? "—"}</Text>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Text level="xSmall" color="muted">{label}</Text>
      <span className="font-mono text-[11px] text-right text-muted-foreground truncate max-w-48">
        {value ?? "—"}
      </span>
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