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
          Live data from <strong>Salesforce</strong> (enrichment) and <strong>Kognitos v2</strong> (automation usage).
        </p>
      </div>

      <IntegrationsClient
        salesforceLive={m("Salesforce")}
        kognitosLive={m("Kognitos v2")}
      />
    </div>
  );
}
