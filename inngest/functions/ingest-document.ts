import { inngest } from "../client";
import { ingest, type IngestFile } from "@/lib/ingestion/pipeline";
import { requireAdmin } from "@/lib/supabase/server";
import { DOCS_BUCKET } from "@/lib/ingestion/storage";

// Event payload shape:
//   { customerKey, filename, mimeType, source, sourceDetail?, sourceUrl?, storagePath? }
// Either `sourceUrl` (signed URL the function will fetch) OR `storagePath`
// (an existing object in the docs bucket) must be provided.
export const ingestDocument = inngest.createFunction(
  { id: "ingest-document", retries: 3 },
  { event: "delivery-ops/document.uploaded" },
  async ({ event, step }) => {
    const data = event.data as {
      customerKey: string;
      filename: string;
      mimeType: string;
      source: IngestFile["source"];
      sourceDetail?: string;
      sourceUrl?: string;
      storagePath?: string;
      metadata?: Record<string, unknown>;
    };

    if (!data.customerKey || !data.filename) {
      throw new Error("ingest-document: missing customerKey or filename in event payload.");
    }

    const buffer = await step.run("fetch-bytes", async () => {
      if (data.sourceUrl) {
        const res = await fetch(data.sourceUrl);
        if (!res.ok) throw new Error(`Source fetch failed: ${res.status}`);
        const ab = await res.arrayBuffer();
        return Buffer.from(ab).toString("base64");
      }
      if (data.storagePath) {
        const sb = requireAdmin();
        const { data: dl, error } = await sb.storage.from(DOCS_BUCKET).download(data.storagePath);
        if (error || !dl) throw error ?? new Error("Storage download returned empty.");
        const ab = await dl.arrayBuffer();
        return Buffer.from(ab).toString("base64");
      }
      throw new Error("ingest-document: provide either sourceUrl or storagePath.");
    });

    const result = await step.run("ingest", async () =>
      ingest(data.customerKey, {
        filename: data.filename,
        content: Buffer.from(buffer, "base64"),
        mimeType: data.mimeType ?? "application/octet-stream",
        source: data.source ?? "upload",
        sourceDetail: data.sourceDetail,
        metadata: data.metadata,
      })
    );

    return result;
  }
);
