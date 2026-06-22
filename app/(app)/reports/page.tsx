import Link from "next/link";
import { BackButton } from "@/app/_components/back-button";

export const dynamic = "force-dynamic";

interface ReportCard {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  status: "coming-soon" | "available" | "needs-access";
  needs: string[];
  href?: string;
}

const REPORT_CARDS: ReportCard[] = [
  {
    id: "qbr",
    title: "QBR Generator",
    subtitle: "Quarterly Business Review decks",
    description:
      "Auto-build a 10–12 slide QBR deck for any customer: contract history, active projects, NPS trend, key wins, open issues, and renewal risk — all sourced from live Salesforce + Monday data. Brand-correct slides, ready to customise and send.",
    icon: "📊",
    status: "coming-soon",
    needs: ["Kognitos v1/v2 live process data", "Google Slides API access", "Customer slide template (.pptx)"],
  },
  {
    id: "weekly",
    title: "Delivery Update",
    subtitle: "Weekly · monthly · quarterly · custom range",
    description:
      "Live portfolio snapshot for any time window: what shipped, what's in UAT, what's at risk, team workload, and a delivery trend chart. Pick a preset or set custom dates. Export as PNG or print-to-PDF for your All Hands or QBR.",
    icon: "📋",
    status: "available",
    needs: [],
    href: "/reports/weekly",
  },
  {
    id: "v2-migration",
    title: "V2 Migration — All Hands",
    subtitle: "Weekly migration & delivery update",
    description:
      "Company All-Hands view of the V1→V2 migration: the migrate-or-retire split across the V1 estate, net-new V2 builds, renewals due this quarter with migration readiness, live engineering blockers from Linear, and key decision points. Export as PNG for the deck.",
    icon: "🚀",
    status: "available",
    needs: [],
    href: "/reports/v2-migration",
  },
  {
    id: "monthly-digest",
    title: "Monthly Customer Digest",
    subtitle: "Customer-facing monthly summary",
    description:
      "A branded monthly digest sent to each customer's primary contact: automations live, credits consumed, recent milestones, upcoming work. One per customer, generated in under 60 seconds.",
    icon: "📨",
    status: "needs-access",
    needs: ["Gmail send-as aliases (Google Suite access)", "Kognitos v2 credit data"],
  },
  {
    id: "health-report",
    title: "Customer Health Report",
    subtitle: "Portfolio health scorecard",
    description:
      "A data-derived health score for every customer — based on NPS trend, credit burn, project velocity, support case volume, and open exceptions. No more subjective colour coding.",
    icon: "🩺",
    status: "coming-soon",
    needs: ["Kognitos v1/v2 run + exception data", "NPS trend (partially available)"],
  },
];

const STATUS_BADGE: Record<ReportCard["status"], { label: string; cls: string }> = {
  available:    { label: "Available",    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  "coming-soon":{ label: "Coming soon",  cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  "needs-access":{ label: "Needs access",cls: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20" },
};

export default function ReportsPage() {
  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/dashboard" label="Dashboard" />

      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--muted-foreground)] mb-1">Reports</div>
        <h1 className="text-4xl font-bold tracking-tight text-[color:var(--foreground)]">
          Reports & insights.
        </h1>
        <p className="text-sm text-[color:var(--muted-foreground)] mt-2 max-w-2xl">
          Automated reports powered by live data from Salesforce, Monday, and Kognitos. No manual copy-paste — every report generates from a single click and reflects the current state of the customer relationship.
        </p>
      </div>

      {/* Report cards grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {REPORT_CARDS.map((card) => {
          const badge = STATUS_BADGE[card.status];
          return (
            <div
              key={card.id}
              className="glass-card glass-card-hover p-6 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{card.icon}</div>
                  <div>
                    <div className="text-base font-semibold tracking-tight text-[color:var(--foreground)]">
                      {card.title}
                    </div>
                    <div className="text-xs text-[color:var(--muted-foreground)] mt-0.5">{card.subtitle}</div>
                  </div>
                </div>
                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>

              <p className="text-sm text-[color:var(--muted-foreground)] leading-relaxed">
                {card.description}
              </p>

              {card.needs.length > 0 ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-2">
                    Required to activate
                  </div>
                  <ul className="space-y-1">
                    {card.needs.map((need) => (
                      <li key={need} className="flex items-start gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <span className="mt-0.5 text-amber-500 shrink-0">○</span>
                        {need}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {card.href ? (
                <Link
                  href={card.href}
                  className="mt-auto btn-primary inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                >
                  Generate →
                </Link>
              ) : (
                <div className="mt-auto rounded-xl border border-[var(--glass-border)] px-4 py-2.5 text-sm text-center text-[color:var(--muted-foreground)] italic">
                  Will be available once dependencies are wired
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Data sources note */}
      <section className="glass-card p-6">
        <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] mb-4">
          Report data sources
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { source: "Salesforce", status: "Live", color: "#60a5fa", items: ["Contract ARR", "Renewal dates", "Opportunities", "Cases"] },
            { source: "Monday", status: "Live", color: "#818cf8", items: ["Projects delivered", "Team workload", "NPS responses", "Activity log"] },
            { source: "Kognitos v2", status: "Needs creds", color: "#34d399", items: ["Live run counts", "Exception rates", "Credit consumption", "Process health"] },
            { source: "Kognitos v1", status: "Needs creds", color: "#fb923c", items: ["Legacy automation runs", "Historical usage", "Department data", "Workspace stats"] },
          ].map((s) => (
            <div key={s.source}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-xs font-semibold text-[color:var(--foreground)]">{s.source}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                  s.status === "Live"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                }`}>
                  {s.status}
                </span>
              </div>
              <ul className="space-y-0.5">
                {s.items.map((item) => (
                  <li key={item} className="text-xs text-[color:var(--muted-foreground)]">· {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
