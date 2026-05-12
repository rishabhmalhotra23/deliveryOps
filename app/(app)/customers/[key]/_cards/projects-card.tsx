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
import type { ProjectsCardProps } from "@/lib/customers/view-model";

const HEALTH_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  "On Track": "success",
  Healthy: "success",
  Watch: "warning",
  "At Risk": "destructive",
  Blocked: "destructive",
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "outline" | "default"> = {
  Delivered: "success",
  Live: "success",
  "In Progress": "default",
  "On Hold": "secondary",
  Cancelled: "secondary",
  Backlog: "outline",
  Upcoming: "outline",
};

const GROUP_ORDER = ["Active", "Pipeline", "On Hold", "Backlog"];
const TODAY = new Date().toISOString().slice(0, 10);

export function ProjectsCard({ customerName, projects, mondaySyncedAt, className }: ProjectsCardProps & { className?: string }) {
  if (projects.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <Text level="xSmall" color="muted">from Monday Projects board</Text>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon="FolderOpen"
            title="No projects yet"
            description="Projects from Monday's Projects board appear here once matched to this customer."
          />
        </CardContent>
      </Card>
    );
  }

  // Bucket: delivered vs in-flight
  const delivered = projects.filter(
    (p) =>
      ["Delivered", "Live"].includes(p.project_status ?? "") ||
      ((p.go_live_date ?? "") <= TODAY && (p.go_live_date ?? "").length >= 8)
  ).sort((a, b) => ((a.go_live_date ?? "") < (b.go_live_date ?? "") ? 1 : -1));
  const inFlight = projects.filter((p) => !delivered.includes(p));

  // Group in-flight by Monday board group
  const grouped = new Map<string, typeof inFlight>();
  for (const p of inFlight) {
    const key = p.group_title ?? "(other)";
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }
  const ordered = [
    ...GROUP_ORDER.filter((g) => grouped.has(g)).map((g) => [g, grouped.get(g)!] as const),
    ...[...grouped.entries()].filter(([g]) => !GROUP_ORDER.includes(g)),
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Projects ({projects.length})</CardTitle>
          {mondaySyncedAt ? (
            <Text level="xSmall" color="muted">synced {relTime(mondaySyncedAt)}</Text>
          ) : null}
        </div>
        <Text level="xSmall" color="muted">from Monday · PM tool</Text>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* In-flight groups */}
        {ordered.map(([groupName, list]) => (
          <Accordion key={groupName} type="single" collapsible defaultValue="open">
            <AccordionItem value="open">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span>{groupName}</span>
                  <Badge variant="outline" className="text-xs">{list.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-1">
                  {list.map((p) => (
                    <ProjectRow key={p.monday_item_id} project={p} customerName={customerName} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ))}

        {/* Delivered bucket */}
        {delivered.length > 0 ? (
          <Accordion type="single" collapsible defaultValue="delivered">
            <AccordionItem value="delivered">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span>Delivered</span>
                  <Badge variant="success" className="text-xs">{delivered.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-1">
                  {delivered.map((p) => (
                    <ProjectRow key={p.monday_item_id} project={p} customerName={customerName} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : (
          <div className="pt-2 border-t border-border">
            <Text level="xSmall" color="muted" className="italic">
              No delivered projects yet — will appear once go-live dates are set on Monday.
            </Text>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectRow({
  project,
  customerName,
}: {
  project: ProjectsCardProps["projects"][0];
  customerName: string;
}) {
  const cleanName = project.name.replace(new RegExp(`^${customerName}\\s*[-—]\\s*`), "");
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <Text level="small" weight="medium" className="truncate">{cleanName}</Text>
        <div className="flex items-center gap-1.5 shrink-0">
          {project.dev_platform ? (
            <Badge variant="outline" className="text-[10px]">{project.dev_platform}</Badge>
          ) : null}
          {project.health ? (
            <Badge variant={HEALTH_VARIANT[project.health] ?? "outline"} className="text-[10px]">
              {project.health}
            </Badge>
          ) : null}
          {project.project_status ? (
            <Badge variant={STATUS_VARIANT[project.project_status] ?? "outline"} className="text-[10px]">
              {project.project_status}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {project.current_phase ? <Meta label="Phase">{project.current_phase}</Meta> : null}
        {project.complexity ? <Meta label="Complexity">{project.complexity}</Meta> : null}
        {project.kickoff_date ? <Meta label="Kickoff">{project.kickoff_date}</Meta> : null}
        {project.go_live_date ? (
          <Meta label="Go live">
            <span className="font-medium text-foreground">{project.go_live_date}</span>
          </Meta>
        ) : null}
        {project.tam ? <Meta label="TAM">{project.tam.split("@")[0]}</Meta> : null}
        {project.dev ? <Meta label="Dev">{project.dev.split("@")[0]}</Meta> : null}
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="text-xs text-muted-foreground">
      {label}: {children}
    </span>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}