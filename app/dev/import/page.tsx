import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <h2 className="font-medium mb-1">Customer import — Monday → DeliveryOps</h2>
        <p className="text-[color:var(--brand-gray)]">
          Pulls every row from your Monday <strong>Customers</strong> board, matches each one against the{" "}
          <strong>Projects</strong> board + the per-customer Monday <strong>workspace</strong> + a{" "}
          <strong>Salesforce</strong> account candidate. Confirm the SF match per row, then hit{" "}
          <strong>Import all</strong> to land them in <code>customers</code>.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}
