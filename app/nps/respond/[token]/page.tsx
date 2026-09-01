import { getRecipientByToken } from "@/lib/nps/campaigns";
import { getCustomerById } from "@/lib/customers";
import { SurveyFormClient } from "./survey-form-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ score?: string }>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--background)] px-4">
      <div className="w-full max-w-md text-center glass-card p-8 space-y-3">{children}</div>
    </div>
  );
}

export default async function NpsRespondPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { score } = await searchParams;
  const recipient = await getRecipientByToken(token);

  if (!recipient) {
    return (
      <Centered>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          This survey link isn&apos;t valid. If you think this is a mistake, reach out to your Kognitos contact.
        </p>
      </Centered>
    );
  }

  if (recipient.response_id) {
    return (
      <Centered>
        <h1 className="text-display text-2xl tracking-tight mb-2">Thanks — we&apos;ve got your response</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          You&apos;ve already completed this survey. We appreciate your feedback!
        </p>
      </Centered>
    );
  }

  const customer = await getCustomerById(recipient.customer_id);
  const prefillScore = score ? Number(score) : recipient.quick_score;

  return (
    <div className="min-h-screen bg-[color:var(--background)] px-4 py-10">
      <div className="max-w-xl mx-auto">
        <div className="text-display text-2xl tracking-tighter font-semibold text-[color:var(--foreground)] mb-1">
          Kognitos Customer Feedback Survey
        </div>
        <p className="text-sm text-[color:var(--muted-foreground)] mb-6">
          We value your feedback. This short survey helps us understand how well we are serving you and where we can
          improve.
        </p>
        <SurveyFormClient
          token={token}
          respondentName={recipient.respondent_name ?? ""}
          companyName={customer?.display_name ?? ""}
          prefillScore={prefillScore ?? null}
        />
      </div>
    </div>
  );
}
