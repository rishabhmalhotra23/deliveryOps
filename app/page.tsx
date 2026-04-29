import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-metal)] px-3 py-1 text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">
          <span className="size-2 rounded-full bg-[color:var(--brand-yellow)]" />
          Phase 1 — brain ported
        </div>

        <h1 className="text-5xl font-bold tracking-tight">DeliveryOps</h1>

        <p className="text-lg text-[color:var(--brand-gray)] leading-relaxed">
          The single source of truth for everything that happens to a customer after the deal closes.
          Salesforce, Kognitos, Google Workspace, Slack, Monday — one operational dashboard, one agent.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/customers"
            className="rounded-md bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Open the dashboard
          </Link>
          <Link
            href="/chat"
            className="rounded-md border border-[color:var(--brand-night)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--brand-night)] hover:text-[color:var(--brand-seasalt)]"
          >
            Talk to the agent
          </Link>
        </div>

        <div className="rounded-lg border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
          <div className="font-medium mb-2">What&rsquo;s wired</div>
          <ul className="space-y-1 text-[color:var(--brand-gray)]">
            <li>Streaming Claude agent with all 16 tools, voice-correct system prompt</li>
            <li>Slack Events listener (signature-verified) + file ingestion via Inngest</li>
            <li>Claude-vision document pipeline (PDF / image OCR), categorised + indexed</li>
            <li>Gmail send + send-as alias verification + Pub/Sub push handler</li>
            <li>Vercel Cron (every minute) + Inngest run-task replaces APScheduler</li>
            <li>Customer dashboard: list, overview, profile, events, tasks, documents, rules, chat</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
