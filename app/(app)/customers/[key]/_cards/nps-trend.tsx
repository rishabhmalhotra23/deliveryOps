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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { NpsTrendPoint } from "@/lib/customers/view-model";

const CHART_CONFIG = {
  average: { label: "Avg score", color: "var(--chart-1)" },
  promoter: { label: "Promoters", color: "var(--chart-2)" },
  detractor: { label: "Detractors", color: "var(--chart-5)" },
} as const;

export function NpsTrend({ data, className }: { data: NpsTrendPoint[]; className?: string }) {
  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>NPS trend</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon="Smile"
            title="No NPS data yet"
            description="Populates once NPS responses from Monday are linked to this customer. The chart shows average score per quarter with promoter and detractor counts."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>NPS trend by quarter</CardTitle>
        <Text level="xSmall" color="muted">
          Solid line = avg score · dashed = promoter / detractor counts
        </Text>
      </CardHeader>
      <CardContent>
        <ChartContainer config={CHART_CONFIG}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="quarter" tick={{ fontSize: 10 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 10]} ticks={[0, 5, 7, 9, 10]} className="text-muted-foreground" />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="average"
              name="average"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              dot={{ fill: "hsl(var(--primary))", r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="promoter"
              name="promoter"
              stroke="var(--chart-2)"
              strokeWidth={1.5}
              dot={{ r: 2 }}
              strokeDasharray="4 3"
            />
            <Line
              type="monotone"
              dataKey="detractor"
              name="detractor"
              stroke="var(--chart-5)"
              strokeWidth={1.5}
              dot={{ r: 2 }}
              strokeDasharray="4 3"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
