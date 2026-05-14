import { NextResponse } from "next/server";

import { listEvents } from "@/lib/events/events";
import { downloadText } from "@/lib/ingestion/storage";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

interface DocumentRow {
  package_id: string;
  filename: string;
  category: string;
  source: string;
  ingested_at: string;
  original_path: string | null;
  organized_path: string | null;
  summary: string;
  snippet?: string;
  match_count?: number;
}

// GET /api/customers/[key]/documents
//   ?q=<query>     keyword search across content + metadata (case-insensitive)
//   ?category=<c>  limit to a single classifier category
//
// Source is the events table (DOCUMENT_INGESTED), enriched with snippets
// from content.md in Storage when a query is provided.
export async function GET(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const category = url.searchParams.get("category") ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200"), 1), 500);

  try {
    const events = await listEvents(key, {
      eventType: "DOCUMENT_INGESTED",
      limit,
    });

    type Details = {
      package_id?: string;
      category?: string;
      filename?: string;
      organized_path?: string;
      original_doc_path?: string;
      source?: string;
    };

    let rows: DocumentRow[] = events.map((e) => {
      const d = (e.details ?? {}) as Details;
      return {
        package_id: d.package_id ?? "",
        filename: d.filename ?? e.summary,
        category: d.category ?? "other",
        source: d.source ?? "unknown",
        ingested_at: e.ts,
        original_path: d.original_doc_path ?? null,
        organized_path: d.organized_path ?? null,
        summary: e.summary,
      };
    });

    if (category) {
      rows = rows.filter((r) => r.category === category);
    }

    if (query) {
      const ql = query.toLowerCase();
      const metaHits = rows.filter(
        (r) =>
          r.filename.toLowerCase().includes(ql) ||
          r.summary.toLowerCase().includes(ql) ||
          r.category.toLowerCase().includes(ql)
      );
      // Content search bounded to first 50 rows to avoid hammering Storage.
      const toScan = rows.slice(0, 50).filter((r) => r.package_id);
      const enriched: Array<DocumentRow | null> = await Promise.all(
        toScan.map(async (r): Promise<DocumentRow | null> => {
          const contentPath = `${key}/${r.package_id}/content.md`;
          try {
            const text = await downloadText(contentPath);
            const idx = text.toLowerCase().indexOf(ql);
            if (idx < 0) return null;
            const start = Math.max(0, idx - 80);
            const end = Math.min(text.length, idx + 200);
            const matches = text.toLowerCase().split(ql).length - 1;
            return {
              ...r,
              snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
              match_count: matches,
            };
          } catch {
            return null;
          }
        })
      );
      const contentHits: DocumentRow[] = enriched.filter((r): r is DocumentRow => r !== null);

      // Merge: prefer content hit version when both metadata + content match.
      const byKey = new Map<string, DocumentRow>();
      for (const r of metaHits) byKey.set(r.package_id || r.filename, r);
      for (const r of contentHits) byKey.set(r.package_id || r.filename, r);
      rows = Array.from(byKey.values()).sort(
        (a, b) => (b.match_count ?? 0) - (a.match_count ?? 0)
      );
    }

    return NextResponse.json({
      documents: rows,
      total: rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
