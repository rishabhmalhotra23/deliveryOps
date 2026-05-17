"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { UserPill } from "./user-pill";

interface NavItem {
  href: string;
  label: string;
  match?: (pathname: string) => boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" || p === "/" },
  { href: "/customers", label: "Customers", match: (p) => p.startsWith("/customers") },
  { href: "/delivery", label: "Delivery", match: (p) => p.startsWith("/delivery") },
  { href: "/analytics", label: "Analytics", match: (p) => p.startsWith("/analytics") },
  { href: "/reports", label: "Reports", match: (p) => p.startsWith("/reports") },
  { href: "/operations", label: "Operations", match: (p) => p.startsWith("/operations") },
  { href: "/chat", label: "Agent", match: (p) => p === "/chat" || p.startsWith("/chat/") },
];

const SECONDARY_NAV: NavItem[] = [
  { href: "/dev", label: "Dev console" },
  { href: "/dev/integrations", label: "Integrations" },
  { href: "/dev/import", label: "Import customers" },
  { href: "/dev/sync", label: "Sync status" },
];

// ── Theme toggle ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-7 h-7" />;
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="w-7 h-7 rounded-md flex items-center justify-center text-[color:var(--brand-metal)] hover:text-[color:var(--brand-seasalt)] hover:bg-[color:var(--brand-night-soft)] transition-colors"
    >
      {isDark ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
      )}
    </button>
  );
}

// ── Dynamic sync status ───────────────────────────────────────────────────────

interface SyncStatus {
  sf: string | null;
  monday: string | null;
}

function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({ sf: null, monday: null });
  useEffect(() => {
    fetch("/api/dev/sync/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.runs) return;
        const sfRun = (d.runs as Array<{ source: string; status: string; finished_at: string }>)
          .find((r) => r.source === "salesforce" && r.status === "ok");
        const monRun = (d.runs as Array<{ source: string; status: string; finished_at: string }>)
          .find((r) => r.source === "monday" && r.status === "ok");
        setStatus({ sf: sfRun?.finished_at ?? null, monday: monRun?.finished_at ?? null });
      })
      .catch(() => {});
  }, []);
  return status;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function SyncDot({ label, time }: { label: string; time: string | null }) {
  const stale = !time || Date.now() - new Date(time).getTime() > 25 * 3_600_000;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${stale ? "bg-amber-400" : "bg-emerald-500"}`} />
      <span className="truncate text-[10px] text-[color:var(--brand-metal)]">
        {label} · {timeAgo(time)}
      </span>
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────

export function AppShell({
  children,
  userEmail,
  userPicture,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
  userPicture?: string | null;
}) {
  const pathname = usePathname();
  const syncStatus = useSyncStatus();

  return (
    <div className="min-h-screen flex bg-[color:var(--background)]">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-60 flex-col bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] sticky top-0 h-screen border-r border-[color:var(--glass-border)]">
        <Link href="/dashboard" className="px-5 py-5 block">
          <div className="text-display text-xl tracking-tighter font-semibold">DeliveryOps</div>
          <div className="eyebrow mt-1 text-[color:var(--brand-metal)]">Kognitos · delivery</div>
        </Link>

        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="mx-3 mb-3 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-[color:var(--brand-metal)] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.18)] hover:text-[color:var(--brand-seasalt)] transition-all cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[9px] border border-[rgba(255,255,255,0.15)] rounded px-1 py-0.5 font-mono">⌘K</kbd>
        </button>

        <nav className="px-3 space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const active = item.match ? item.match(pathname) : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm tracking-tight transition-colors ${
                  active
                    ? "bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] font-semibold"
                    : "text-[color:var(--brand-seasalt)] hover:bg-[rgba(255,255,255,0.06)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 mt-6 mb-2 eyebrow text-[color:var(--brand-metal)]">Tools</div>
        <nav className="px-3 space-y-0.5">
          {SECONDARY_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-1.5 text-xs tracking-tight transition-colors ${
                  active
                    ? "bg-[rgba(255,255,255,0.08)] text-[color:var(--brand-seasalt)]"
                    : "text-[color:var(--brand-metal)] hover:text-[color:var(--brand-seasalt)] hover:bg-[rgba(255,255,255,0.06)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-3 py-4 space-y-3 border-t border-[rgba(255,255,255,0.06)]">
          <div className="px-2 space-y-1.5">
            <SyncDot label="Salesforce" time={syncStatus.sf} />
            <SyncDot label="Monday" time={syncStatus.monday} />
          </div>
          {userEmail ? <UserPill email={userEmail} picture={userPicture} /> : null}
          <div className="flex items-center justify-between px-2">
            <div className="text-[10px] text-[color:var(--brand-metal)] opacity-50">DeliveryOps</div>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)]">
        <Link href="/dashboard" className="text-display text-xl tracking-tighter">DeliveryOps</Link>
        <nav className="flex gap-3 text-sm">
          {PRIMARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">{item.label}</Link>
          ))}
        </nav>
      </header>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
