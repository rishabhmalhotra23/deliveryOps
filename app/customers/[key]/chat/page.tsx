import Link from "next/link";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function CustomerChatPage({ params }: Props) {
  const { key } = await params;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <div className="font-medium mb-1">Chat with the agent for {key}.</div>
        <p className="text-[color:var(--brand-gray)] mb-3">
          The shared chat UI lives at <Link href="/chat" className="underline">/chat</Link> and now drives
          the DeliveryOps agent against the first customer in the database. A customer-scoped chat panel
          (so the same UI re-points to <code>{key}</code> automatically) lands in Phase 1.5 once the
          chat-context provider takes a customer key from the route.
        </p>
        <p className="text-[color:var(--brand-gray)]">
          You can also call <code>POST /api/chat</code> directly with{" "}
          <code>{`{ sessionId, message, customerKey: "${key}" }`}</code> to scope a session to this
          customer today.
        </p>
      </div>
    </div>
  );
}
