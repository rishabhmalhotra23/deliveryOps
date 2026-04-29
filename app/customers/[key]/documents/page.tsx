import { listEvents } from "@/lib/events/events";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

interface DocumentEntry {
  filename: string;
  category: string;
  source: string;
  pageCount: number | null;
  ingestedAt: string;
  packageId: string;
}

export default async function DocumentsPage({ params }: Props) {
  const { key } = await params;
  let docs: DocumentEntry[] = [];
  let error: string | null = null;

  try {
    const events = await listEvents(key, { eventType: "DOCUMENT_INGESTED", limit: 200 });
    docs = events.map((e) => {
      const d = (e.details ?? {}) as Record<string, unknown>;
      return {
        filename: String(d.filename ?? "(unknown)"),
        category: String(d.category ?? "other"),
        source: String(d.source ?? "unknown"),
        pageCount: typeof d.page_count === "number" ? d.page_count : null,
        ingestedAt: e.ts,
        packageId: String(d.package_id ?? e.id),
      };
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-4 text-sm">
        <div className="font-medium mb-1">Couldn&rsquo;t load documents.</div>
        <p className="text-[color:var(--brand-gray)]">{error}</p>
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[color:var(--brand-metal)] bg-white p-6 text-sm text-[color:var(--brand-gray)]">
        No documents yet. Drop a PDF in the customer Slack channel or POST one to{" "}
        <code>/api/customers/{key}/upload</code> — Claude vision will OCR it, classify it, and file it.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-[color:var(--brand-gray)]">
        {docs.length} document{docs.length === 1 ? "" : "s"}. Categories: contracts, meeting-notes, sops,
        support, onboarding, invoices, reports, presentations, correspondence, other.
      </div>
      <table className="w-full text-sm border-separate border-spacing-y-1">
        <thead className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] text-left">
          <tr>
            <th className="px-3 py-2">File</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Pages</th>
            <th className="px-3 py-2">Ingested</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.packageId} className="bg-white">
              <td className="px-3 py-2 rounded-l-md border-y border-l border-[color:var(--brand-metal)] font-medium">
                {d.filename}
              </td>
              <td className="px-3 py-2 border-y border-[color:var(--brand-metal)]">{d.category}</td>
              <td className="px-3 py-2 border-y border-[color:var(--brand-metal)]">{d.source}</td>
              <td className="px-3 py-2 border-y border-[color:var(--brand-metal)] tabular-nums">
                {d.pageCount ?? "—"}
              </td>
              <td className="px-3 py-2 rounded-r-md border-y border-r border-[color:var(--brand-metal)] text-xs text-[color:var(--brand-gray)] tabular-nums">
                {new Date(d.ingestedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
