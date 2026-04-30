import { integrationStatus } from "@/lib/dev/mode";
import { IntegrationsClient } from "./integrations-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const status = integrationStatus();
  const m = (n: string) => status.find((s) => s.name === n)?.live ?? false;

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <h2 className="font-medium mb-1">Phase 2 probe panel</h2>
        <p className="text-[color:var(--brand-gray)]">
          Live data from <strong>Monday</strong> (the customer roster), <strong>Salesforce</strong> (enrichment), and <strong>Kognitos v2</strong> (automation usage). Click into anything that looks like the customer list — once we know which Monday board / workspace holds &ldquo;real customers&rdquo;, we wire the per-customer sync.
        </p>
      </div>

      <IntegrationsClient
        salesforceLive={m("Salesforce")}
        mondayLive={m("Monday.com")}
        kognitosLive={m("Kognitos v2")}
      />
    </div>
  );
}
