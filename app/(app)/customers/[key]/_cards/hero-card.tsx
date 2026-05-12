"use client";

import {
  Card,
  CardContent,
  CardHeader,
  Badge,
  Title,
  Text,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@kognitos/lattice";
import { InlineEdit } from "@/app/_components/inline-edit";
import type { HeroCardProps } from "@/lib/customers/view-model";

const CATEGORY_VARIANT: Record<string, "destructive" | "warning" | "success" | "secondary" | "default" | "outline"> = {
  "At Risk": "destructive",
  "To Drop": "destructive",
  "Upcoming Renewals": "warning",
  "Strategic Growth": "success",
  Active: "success",
  "Partner Managed": "secondary",
  POV: "outline",
  Churned: "secondary",
};

function FieldLabel({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Text level="xSmall" color="muted">
          {children}
        </Text>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-[8px] font-bold text-muted-foreground hover:text-foreground flex items-center justify-center"
            >
              i
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-xs">{tip}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function HeroCard({
  customerKey,
  displayName,
  category,
  aeOwner,
  partner,
  industry,
  renewalDate,
  protectedFields,
  knownAes,
  knownPartners,
  knownCategories,
  className,
}: HeroCardProps & { className?: string }) {
  const badgeVariant = CATEGORY_VARIANT[category] ?? "default";

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Title level="h2" className="leading-none">
            {displayName}
          </Title>
          <Badge variant={badgeVariant}>{category}</Badge>
          {industry ? (
            <Badge variant="outline" className="text-xs">
              {industry}
            </Badge>
          ) : null}
        </div>
        {renewalDate ? (
          <Text level="xSmall" color="muted">
            Renews {renewalDate}
          </Text>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {/* AE */}
          <div>
            <FieldLabel tip="The Kognitos Account Executive who owns this customer. Pulled from Monday on every sync; editing here locks the field.">
              Account Executive
            </FieldLabel>
            <InlineEdit
              customerKey={customerKey}
              field="ae_owner"
              initialValue={aeOwner}
              label="AE"
              placeholder="(unassigned)"
              suggestions={knownAes}
            />
          </div>
          {/* Category */}
          <div>
            <FieldLabel tip="DeliveryOps operational bucket. Drives dashboard filters and chart colors. Seeded from Monday's lifecycle group; manually editing here locks it from future syncs.">
              Category
            </FieldLabel>
            <InlineEdit
              customerKey={customerKey}
              field="custom_category"
              initialValue={category}
              label="Category"
              placeholder="(uncategorised)"
              options={knownCategories.map((c) => ({ value: c, label: c }))}
              allowNull={false}
            />
          </div>
          {/* Partner */}
          <div>
            <FieldLabel tip="Implementation partner. Direct = Kognitos delivers without a partner.">
              Partner
            </FieldLabel>
            <InlineEdit
              customerKey={customerKey}
              field="partner"
              initialValue={partner}
              label="Partner"
              placeholder="(direct)"
              suggestions={knownPartners}
            />
          </div>
        </div>
        {protectedFields.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5 items-center">
            <Text level="xSmall" color="muted">
              Locked from sync:
            </Text>
            {protectedFields.map((f) => (
              <Badge key={f} variant="outline" className="text-[10px]">
                {f}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
