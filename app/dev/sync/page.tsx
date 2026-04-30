import { SyncClient } from "./sync-client";

export const dynamic = "force-dynamic";

export default function SyncPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <h2 className="font-medium mb-1">Sync status</h2>
        <p className="text-[color:var(--brand-gray)]">
          DeliveryOps caches Salesforce + Monday in Postgres so dashboards stay fast and the live
          APIs don&rsquo;t get hammered. The cron job runs once a week in production; here you can
          trigger it on demand.
        </p>
      </div>
      <SyncClient />
    </div>
  );
}
