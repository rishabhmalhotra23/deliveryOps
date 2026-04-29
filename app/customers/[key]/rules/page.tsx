import { getRules } from "@/lib/rules/rules";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function RulesPage({ params }: Props) {
  const { key } = await params;
  let rules = "";
  let error: string | null = null;
  try {
    rules = await getRules(key);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-[color:var(--brand-gray)]">
        These rules are injected into every agent interaction with this customer. They override the
        general system prompt. The agent reads them via <code>get_customer_rules</code> and updates them
        via <code>update_customer_rules</code>.
      </div>
      {error ? (
        <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
          <div className="font-medium mb-1">Couldn&rsquo;t load rules.</div>
          <p className="text-[color:var(--brand-gray)]">{error}</p>
        </div>
      ) : (
        <pre className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-xs leading-relaxed whitespace-pre-wrap">
          {rules}
        </pre>
      )}
      <div className="text-xs text-[color:var(--brand-gray)]">
        Inline editor lands in Phase 1.5. Until then, edit through the agent or directly in the{" "}
        <code>rules</code> table.
      </div>
    </div>
  );
}
