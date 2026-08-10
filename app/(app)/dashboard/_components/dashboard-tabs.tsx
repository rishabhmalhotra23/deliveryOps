import Link from "next/link";

const TABS = [
  { key: "overview", label: "Overview", href: "/dashboard" },
  { key: "trends", label: "Trends", href: "/dashboard?tab=trends" },
] as const;

export function DashboardTabs({ active }: { active: "overview" | "trends" }) {
  return (
    <div className="flex gap-6 border-b border-line dark:border-[color:var(--surface-1)] mb-6">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`text-sm font-semibold pb-2.5 -mb-px border-b-2 transition-colors ${
            active === tab.key
              ? "text-[color:var(--foreground)] border-[color:var(--brand-yellow)]"
              : "text-[color:var(--muted-foreground)] border-transparent hover:text-[color:var(--foreground)]"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
