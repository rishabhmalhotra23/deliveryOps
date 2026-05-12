"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Text,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@kognitos/lattice";
import type { HealthSpotlightProps } from "@/lib/customers/view-model";

function scoreTone(score: number): "success" | "warning" | "destructive" {
  if (score >= 70) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

function riskVariant(risk: string): "destructive" | "warning" | "secondary" {
  if (risk === "high") return "destructive";
  if (risk === "medium") return "warning";
  return "secondary";
}

export function HealthSpotlight({
  category,
  healthScore,
  healthExplanation,
  churnRisk,
  npsAverage,
  npsCount,
  nextQbrDate,
  sfAccountOwner,
  className,
}: HealthSpotlightProps & { className?: string }) {
  return (
    <Card className={`${className ?? ""} bg-card`}>
      <CardHeader className="pb-2">
        <CardTitle>
          <Text level="xSmall" color="muted" weight="semibold" as="span" className="uppercase tracking-widest">
            Internal health
          </Text>
        </CardTitle>
        <Text level="xSmall" color="muted">
          CSM-only · computed live
        </Text>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Scores row */}
        <div className="grid grid-cols-2 gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-default">
                  <Text level="xSmall" color="muted">
                    Health
                  </Text>
                  <div
                    className={`text-3xl font-bold font-display tabular-nums ${
                      scoreTone(healthScore) === "success"
                        ? "text-green-600"
                        : scoreTone(healthScore) === "warning"
                        ? "text-amber-600"
                        : "text-red-600"
                    }`}
                  >
                    {healthScore}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs">{healthExplanation}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div>
            <Text level="xSmall" color="muted">
              NPS avg
            </Text>
            <div
              className={`text-3xl font-bold font-display tabular-nums ${
                (npsAverage ?? 0) >= 7
                  ? "text-green-600"
                  : (npsAverage ?? 0) >= 5
                  ? "text-amber-600"
                  : npsAverage == null
                  ? "text-muted-foreground"
                  : "text-red-600"
              }`}
            >
              {npsAverage != null ? npsAverage.toFixed(1) : "—"}
            </div>
            <Text level="xSmall" color="muted">
              {npsCount} response{npsCount === 1 ? "" : "s"}
            </Text>
          </div>
        </div>

        {/* Detail row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Text level="xSmall" color="muted">
              Churn risk
            </Text>
            <Badge variant={riskVariant(churnRisk)} className="mt-1 text-xs capitalize">
              {churnRisk}
            </Badge>
          </div>
          <div>
            <Text level="xSmall" color="muted">
              Next QBR
            </Text>
            <Text level="small" className="mt-0.5">
              {nextQbrDate ?? "—"}
            </Text>
          </div>
          {sfAccountOwner ? (
            <div className="col-span-2">
              <Text level="xSmall" color="muted">
                SF Account owner
              </Text>
              <Text level="small" className="mt-0.5">
                {sfAccountOwner}
              </Text>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}