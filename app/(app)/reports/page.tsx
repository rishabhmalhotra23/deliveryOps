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
    id: "v2-migration",
    title: "All-Hands",
    subtitle: "Company-wide · Delivery & Customer Success",
    description:
      "Portfolio and migration status, cumulative migration progress since the program started, upcoming-renewal spotlight, this week's blockers, and live ticket health. All from live processes + Linear data — export as PNG or print for the meeting.",
    icon: "🚀",
    status: "available",
    needs: [],
    href: "/reports/v2-migration",
  },
  {
    id: "delivery-review",
    title: "Weekly Delivery Review",
    subtitle: "Delivery & Customer Success team",
    description:
      "What's done, what's coming up, and what's blocked — grouped by customer, live from processes. The working review for the team, not a presented artifact.",
    icon: "📋",
    status: "available",
    needs: [],
    href: "/reports/delivery-review",
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
          Real-time delivery and migration tracking for your entire organization. From all-hands presentations to team working documents — powered by live process and Linear data, ready to export or print.
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
