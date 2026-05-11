"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  match?: (pathname: string) => boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" || p === "/" },
  { href: "/analytics", label: "Analytics", match: (p) => p.startsWith("/analytics") },
  { href: "/customers", label: "Customers", match: (p) => p.startsWith("/customers") },
  { href: "/operations", label: "Operations", match: (p) => p.startsWith("/operations") },
  { href: "/chat", label: "Agent", match: (p) => p === "/chat" || p.startsWith("/chat/") },
];

const SECONDARY_NAV: NavItem[] = [
  { href: "/dev", label: "Dev console" },
  { href: "/dev/integrations", label: "Integrations" },
  { href: "/dev/import", label: "Import customers" },
  { href: "/dev/sync", label: "Sync status" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex bg-[color:var(--background)]">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] sticky top-0 h-screen">
        <Link href="/dashboard" className="px-6 py-6 block">
          <div className="text-display text-2xl tracking-tight">DeliveryOps</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--brand-metal)] mt-1">
            Kognitos · post-sales
          </div>
        </Link>

        <nav className="px-3 mt-2 space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const active = item.match ? item.match(pathname) : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] font-semibold"
                    : "text-[color:var(--brand-seasalt)] hover:bg-[color:var(--brand-night-soft)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-6 mt-8 mb-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--brand-metal)]">
          Tools
        </div>
        <nav className="px-3 space-y-0.5">
          {SECONDARY_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-xs transition-colors ${
                  active
                    ? "bg-[color:var(--brand-night-soft)] text-[color:var(--brand-seasalt)]"
                    : "text-[color:var(--brand-metal)] hover:text-[color:var(--brand-seasalt)] hover:bg-[color:var(--brand-night-soft)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-6 py-5 text-[10px] text-[color:var(--brand-metal)]">
          <div>v0.1 · local dev</div>
          <div className="mt-1 opacity-70">English as Code, but for CSMs.</div>
        </div>
      </aside>

      {/* Mobile top nav (visible <lg) */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)]">
        <Link href="/dashboard" className="text-display text-xl">DeliveryOps</Link>
        <nav className="flex gap-3 text-sm">
          {PRIMARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Main column */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
