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
import type { NpsResponsesCardProps } from "@/lib/customers/view-model";

const CAT_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  Promoter: "success",
  Passive: "warning",
  Detractor: "destructive",
};

// Sort quarters newest-first: "4Q25" → year=25, q=4
function quarterSort(q: string): number {
  const m = /^(\d)Q(\d{2})$/.exec(q);
  return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
}

export function NpsResponsesCard({ responses, className }: NpsResponsesCardProps & { className?: string }) {
  if (responses.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>NPS responses</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon="MessageSquare"
            title="No NPS data yet"
            description="NPS responses appear here once linked via the Customer column on Monday's NPS Tracking board. Run a sync after populating that column."
          />
        </CardContent>
      </Card>
    );
  }

  // Group by quarter, sort newest first
  const grouped = new Map<string, typeof responses>();
  for (const r of responses) {
    const key = r.quarter ?? "(no quarter)";
    const list = grouped.get(key) ?? [];
    list.push(r);
    grouped.set(key, list);
  }
  const ordered = [...grouped.entries()].sort((a, b) => quarterSort(b[0]) - quarterSort(a[0]));

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>NPS responses</CardTitle>
          <Badge variant="outline" className="text-xs">{responses.length} total</Badge>
        </div>
        <Text level="xSmall" color="muted">Grouped by quarter, newest first · full comments shown</Text>
      </CardHeader>
      <CardContent className="space-y-2">
        <Accordion type="multiple" defaultValue={ordered.slice(0, 2).map(([q]) => q)}>
          {ordered.map(([quarter, list]) => {
            const validScores = list.filter((r) => r.score != null).map((r) => r.score!);
            const avg = validScores.length
              ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10
              : null;
            const promoters = list.filter((r) => r.category === "Promoter").length;
            const passives = list.filter((r) => r.category === "Passive").length;
            const detractors = list.filter((r) => r.category === "Detractor").length;

            return (
              <AccordionItem key={quarter} value={quarter}>
                <AccordionTrigger>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="text-display font-medium">{quarter}</span>
                    <Text level="xSmall" color="muted" as="span">
                      {list.length} response{list.length === 1 ? "" : "s"}
                    </Text>
                    {avg != null ? (
                      <Text level="xSmall" color="muted" as="span">
                        avg <strong className="text-foreground">{avg.toFixed(1)}</strong>
                      </Text>
                    ) : null}
                    {promoters > 0 ? <Badge variant="success" className="text-[10px]">{promoters}P</Badge> : null}
                    {passives > 0 ? <Badge variant="warning" className="text-[10px]">{passives}N</Badge> : null}
                    {detractors > 0 ? <Badge variant="destructive" className="text-[10px]">{detractors}D</Badge> : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2 sm:grid-cols-2 pt-2">
                    {list.map((r) => (
                      <NpsResponseTile key={r.monday_item_id} response={r} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function NpsResponseTile({ response }: { response: NpsResponsesCardProps["responses"][0] }) {
  const catVariant = response.category ? CAT_VARIANT[response.category] ?? "outline" : "outline";
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="min-w-0">
          <Text level="small" weight="semibold" className="truncate">{response.respondent}</Text>
          {response.respondent_type ? (
            <Text level="xSmall" color="muted">{response.respondent_type}</Text>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-2xl font-display tabular-nums font-bold leading-none ${
              catVariant === "success"
                ? "text-green-600"
                : catVariant === "destructive"
                ? "text-red-600"
                : "text-amber-600"
            }`}
          >
            {response.score ?? "—"}
          </div>
          {response.category ? (
            <Badge variant={catVariant as "success" | "warning" | "destructive" | "outline"} className="text-[10px] mt-1">
              {response.category}
            </Badge>
          ) : null}
        </div>
      </div>
      {response.feedback ? (
        <Text level="xSmall" color="muted" className="italic leading-relaxed mt-2 whitespace-pre-line">
          &ldquo;{response.feedback}&rdquo;
        </Text>
      ) : null}
      {response.response_date ? (
        <Text level="xSmall" color="muted" className="tabular-nums mt-2">
          {response.response_date}
        </Text>
      ) : null}
    </div>
  );
}