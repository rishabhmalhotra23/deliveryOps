import Link from "next/link";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/dev", label: "Status" },
  { href: "/dev/simulate", label: "Simulate inbound" },
  { href: "/dev/outbox", label: "Outbox" },
  { href: "/dev/integrations", label: "Integrations" },
];

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <div className="border-b border-[color:var(--brand-metal)] bg-white">
        <div className="max-w-5xl mx-auto px-8 pt-6 pb-2">
          <div className="text-xs text-[color:var(--brand-gray)] mb-2">
            <Link href="/" className="hover:text-[color:var(--brand-night)]">
              Home
            </Link>{" "}
            <span className="mx-1">/</span> Dev
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Local dev console</h1>
          <p className="text-sm text-[color:var(--brand-gray)] mt-1">
            See which integrations are wired up, simulate inbound traffic without Slack or Gmail apps,
            and watch every outbound call land in the outbox.
          </p>
        </div>
        <nav className="max-w-5xl mx-auto px-8 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="px-3 py-2 text-sm rounded-t-md border-b-2 border-transparent hover:border-[color:var(--brand-metal)] hover:text-[color:var(--brand-night)] text-[color:var(--brand-gray)]"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="max-w-5xl mx-auto px-8 py-8">{children}</div>
    </main>
  );
}
