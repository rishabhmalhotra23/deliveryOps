import { getInternalProfile, getProfile } from "@/lib/profile/profile";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function ProfilePage({ params }: Props) {
  const { key } = await params;
  const [profileRes, internalRes] = await Promise.allSettled([
    getProfile(key),
    getInternalProfile(key),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Customer-facing profile" subtitle="Visible to the agent. Lives in the `profiles` table.">
        {profileRes.status === "fulfilled" ? (
          <pre className="text-xs leading-relaxed overflow-auto whitespace-pre-wrap">
            {JSON.stringify(profileRes.value, null, 2)}
          </pre>
        ) : (
          <ErrorText message={errorMessage(profileRes.reason)} />
        )}
        <FooterNote text="Inline editor lands in Phase 1.5. Until then, edit via the agent (`update_customer_profile`) or directly in the `profiles` table." />
      </Card>
      <Card
        title="Internal profile"
        subtitle="Health score, NPS, churn risk. Agent has zero access. Lives in `internal_profiles`."
      >
        {internalRes.status === "fulfilled" ? (
          <pre className="text-xs leading-relaxed overflow-auto whitespace-pre-wrap">
            {JSON.stringify(internalRes.value, null, 2)}
          </pre>
        ) : (
          <ErrorText message={errorMessage(internalRes.reason)} />
        )}
      </Card>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[color:var(--brand-metal)] bg-white p-5">
      <h2 className="font-medium">{title}</h2>
      <p className="text-xs text-[color:var(--brand-gray)] mt-0.5 mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

function FooterNote({ text }: { text: string }) {
  return <div className="text-xs text-[color:var(--brand-gray)] mt-3">{text}</div>;
}

function ErrorText({ message }: { message: string }) {
  return <div className="text-xs text-[color:var(--brand-gray)]">{message}</div>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
