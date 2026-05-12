"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  EmptyState,
  Text,
} from "@kognitos/lattice";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import type { ArrPoint } from "@/lib/customers/view-model";
import { fmtMoney } from "@/lib/customers/view-model";

const CHART_CONFIG = {
  amount: { label: "ARR", color: "var(--chart-1)" },
} as const;

export function ArrTrend({ data, className }: { data: ArrPoint[]; className?: string }) {
  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>ARR over time</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon="TrendingUp"
            title="No contract history yet"
            description="Appears once a Salesforce opportunity closes Won. The step chart shows each annual contract event — the JBI-style $24K → $384K expansion story."
          />
        </CardContent>
      </Card>
    );
  }

  const openPoints = data.filter((d) => d.type === "Open");

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>ARR over time</CardTitle>
        <Text level="xSmall" color="muted">
          Each step = a Salesforce contract event. Yellow dots = open expected ARR.
        </Text>
      </CardHeader>
      <CardContent>
        <ChartContainer config={CHART_CONFIG}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="arrFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(0, 7)}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(n: number) => fmtMoney(n)}
              className="text-muted-foreground"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => fmtMoney(Number(value))}
                />
              }
            />
            <Area
              type="stepAfter"
              dataKey="amount"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              fill="url(#arrFillGrad)"
            />
            {openPoints.map((d) => (
              <ReferenceDot
                key={d.date + d.name}
                x={d.date}
                y={d.amount}
                r={5}
                fill="hsl(var(--primary))"
                stroke="var(--chart-1)"
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
