import { listCustomers } from "@/lib/customers";
import { SimulatorClient } from "./simulator-client";

export const dynamic = "force-dynamic";

export default async function SimulatePage() {
  let customers: Awaited<ReturnType<typeof listCustomers>> = [];
  let supabaseError: string | null = null;
  try {
    customers = await listCustomers();
  } catch (err) {
    supabaseError = err instanceof Error ? err.message : String(err);
  }

  if (supabaseError || customers.length === 0) {
    return (
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-6 text-sm">
        <div className="font-medium mb-1">No customers to simulate against yet.</div>
        <p className="text-[color:var(--brand-gray)] mb-3">
          Head to{" "}
          <a href="/dev" className="underline">
            /dev
          </a>{" "}
          and seed the demo customer first.
        </p>
        {supabaseError ? <p className="text-xs text-[color:var(--brand-gray)]">{supabaseError}</p> : null}
      </div>
    );
  }

  return (
    <SimulatorClient
      customers={customers.map((c) => ({
        key: c.key,
        display_name: c.display_name,
        slack_channel: c.slack_channel,
        email_alias: c.email_alias,
      }))}
    />
  );
}
