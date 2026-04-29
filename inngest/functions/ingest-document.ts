import { inngest } from "../client";

// TODO Phase 1: port curator/ingestion/pipeline.py end-to-end using
// lib/ingestion/extract.ts (Claude vision) instead of marker-pdf / pandoc / tesseract.
export const ingestDocument = inngest.createFunction(
  { id: "ingest-document" },
  { event: "delivery-ops/document.uploaded" },
  async ({ event, step }) => {
    await step.run("noop", async () => ({
      received: true,
      payload: event.data ?? null,
    }));
    return { ok: true };
  }
);
