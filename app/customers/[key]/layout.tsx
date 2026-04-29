import Link from "next/link";
import { notFound } from "next/navigation";

import { getCustomerByKey } from "@/lib/customers";

const TABS: Array<{ slug: string; label: string }> = [
  { slug: "", label: "Overview" },
  { slug: "profile", label: "Profile" },
  { slug: "events", label: "Events" },
  { slug: "tasks", label: "Tasks" },
  { slug: "documents", label: "Documents" },
  { slug: "rules", label: "Rules" },
  { slug: "chat", label: "Chat" },
];

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}

export default async function CustomerLayout({ children, params }: LayoutProps) {
  const { key } = await params;
  let customer;
  try {
    customer = await getCustomerByKey(key);
  } catch {
    customer = null;
  }
  if (!customer) notFound();

  return (
    <main className="min-h-screen">
      <div className="border-b border-[color:var(--brand-metal)] bg-white">
        <div className="max-w-6xl mx-auto px-8 pt-6 pb-2">
          <div className="text-xs text-[color:var(--brand-gray)] mb-2">
            <Link href="/customers" className="hover:text-[color:var(--brand-night)]">
              Customers
            </Link>{" "}
            <span className="mx-1">/</span> {customer.display_name}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{customer.display_name}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--brand-gray)] mt-1">
            <span>
              <span className="font-medium text-[color:var(--brand-night)]">key</span> {customer.key}
            </span>
            {customer.slack_channel ? (
              <span>
                <span className="font-medium text-[color:var(--brand-night)]">slack</span> #
                {customer.slack_channel}
              </span>
            ) : null}
            {customer.email_alias ? (
              <span>
                <span className="font-medium text-[color:var(--brand-night)]">email</span>{" "}
                {customer.email_alias}
              </span>
            ) : null}
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-8 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.slug}
              href={`/customers/${customer.key}${t.slug ? `/${t.slug}` : ""}`}
              className="px-3 py-2 text-sm rounded-t-md border-b-2 border-transparent hover:border-[color:var(--brand-metal)] hover:text-[color:var(--brand-night)] text-[color:var(--brand-gray)]"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
    </main>
  );
}
