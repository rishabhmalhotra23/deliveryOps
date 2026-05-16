// POST /api/jobs/ingest-document
//
// Background job: fetch a document (from a signed URL or Supabase Storage)
// and run it through the Claude vision + classifier ingestion pipeline.
// Replaces the previous Inngest function with the same logic.
//
// Triggered fire-and-forget by Slack file-shared / Gmail attachment /
// customer dashboard upload handlers via dispatchJob("ingest-document", …).

import { NextResponse } from "next/server";
import { ingest, type IngestFile } from "@/lib/ingestion/pipeline";
import { requireAdmin } from "@/lib/supabase/server";
import { DOCS_BUCKET } from "@/lib/ingestion/storage";
import { assertJobAuth } from "@/lib/jobs/dispatch";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = logger("jobs.ingest-document");

interface IngestPayload {
  customerKey: string;
  filename: string;
  mimeType: string;
  source: IngestFile["source"];
  sourceDetail?: string;
  sourceUrl?: string;
  storagePath?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const authErr = await assertJobAuth(request);
  if (authErr) return authErr;

  let payload: IngestPayload;
  try {
    payload = (await request.json()) as IngestPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!payload.customerKey || !payload.filename) {
    return NextResponse.json(
      { error: "Missing customerKey or filename." },
      { status: 400 }
    );
  }

  try {
    // Resolve bytes from either a remote URL or Supabase Storage.
    let buffer: Buffer;
    if (payload.sourceUrl) {
      const res = await fetch(payload.sourceUrl);
      if (!res.ok) throw new Error(`Source fetch failed: ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    } else if (payload.storagePath) {
      const sb = requireAdmin();
      const { data: dl, error } = await sb.storage.from(DOCS_BUCKET).download(payload.storagePath);
      if (error || !dl) throw error ?? new Error("Storage download returned empty.");
      buffer = Buffer.from(await dl.arrayBuffer());
    } else {
      return NextResponse.json(
        { error: "Provide either sourceUrl or storagePath." },
        { status: 400 }
      );
    }

    const result = await ingest(payload.customerKey, {
      filename: payload.filename,
      content: buffer,
      mimeType: payload.mimeType ?? "application/octet-stream",
      source: payload.source ?? "upload",
      sourceDetail: payload.sourceDetail,
      metadata: payload.metadata,
    });

    log.info("ingested", { customer: payload.customerKey, filename: payload.filename });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    log.error("ingest failed", { customer: payload.customerKey, filename: payload.filename, ...errorCtx(err) });
    return NextResponse.json({ error: "Ingest failed." }, { status: 500 });
  }
}
