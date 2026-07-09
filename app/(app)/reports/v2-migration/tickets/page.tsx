import { BackButton } from "@/app/_components/back-button";
import { loadTicketsBundle } from "@/lib/tickets/loader";
import { TicketsClient } from "./_components/tickets-client";

export const dynamic = "force-dynamic";

export default async function OpenTicketsPage() {
  const bundle = await loadTicketsBundle();

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1200px] mx-auto space-y-8">
      <BackButton href="/reports/v2-migration" label="V2 Migration" />
      <TicketsClient bundle={bundle} />
    </div>
  );
}
