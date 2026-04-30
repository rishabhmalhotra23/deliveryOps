import { OperationsClient } from "./operations-client";
import { PageHeader } from "@/app/_components/brand";

export const dynamic = "force-dynamic";

const SUGGESTED = [
  "Owen has left the company. Reassign all his active accounts to Binny.",
  "Show me every customer where the AE is Rajesh.",
  "Move all High Risk customers into the At Risk category.",
  "How many customers does each AE have?",
  "Which customers don't have a Salesforce account mapped yet?",
];

export default function OperationsPage() {
  return (
    <div className="px-8 lg:px-12 py-10 max-w-5xl mx-auto space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Tell DeliveryOps what changed."
        subtitle="Bulk reassignments, recategorisations, partner updates — everything across the whole portfolio. Manual edits here lock those fields against future sync overwrites."
      />
      <OperationsClient suggested={SUGGESTED} />
    </div>
  );
}
