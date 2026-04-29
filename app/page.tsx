export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-metal)] px-3 py-1 text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">
          <span className="size-2 rounded-full bg-[color:var(--brand-yellow)]" />
          Phase 0 — scaffolded
        </div>

        <h1 className="text-5xl font-bold tracking-tight">
          DeliveryOps
        </h1>

        <p className="text-lg text-[color:var(--brand-gray)] leading-relaxed">
          The single source of truth for everything that happens to a customer after the deal closes.
          Salesforce, Kognitos, Google Workspace, Slack, Monday — one operational dashboard, one agent.
        </p>

        <div className="rounded-lg border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
          <div className="font-medium mb-2">Next up</div>
          <ul className="space-y-1 text-[color:var(--brand-gray)]">
            <li>Phase 1 — port the brain (agent + tools + system prompt)</li>
            <li>Phase 1 — Slack Events listener + Gmail watch + ingestion pipeline</li>
            <li>Phase 1 — customer dashboard pages in Lattice</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
