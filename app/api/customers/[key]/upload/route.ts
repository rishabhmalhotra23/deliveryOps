import { NextResponse } from "next/server";

import { ensureBucket, uploadFile } from "@/lib/ingestion/storage";
import { requireCustomerByKey } from "@/lib/customers";
import { inngest } from "@/inngest/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ key: string }>;
}

// POST a multipart/form-data with a `file` field. We store it in Storage and
// kick off Inngest ingestion. The route returns immediately with the storage
// path; the ingestion itself runs async and lands in the events feed.
export async function POST(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  try {
    await requireCustomerByKey(key);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Customer not found." },
      { status: 404 }
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field." }, { status: 400 });
  }

  await ensureBucket();
  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpPackage = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = await uploadFile(
    {
      customerKey: key,
      packageId: tmpPackage,
      filename: file.name,
      content: buffer,
      contentType: file.type || "application/octet-stream",
    },
    "raw"
  );

  await inngest.send({
    name: "delivery-ops/document.uploaded",
    data: {
      customerKey: key,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      source: "upload",
      sourceDetail: "Dashboard upload",
      storagePath: path,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      storage_path: path,
      message:
        "Upload received. The ingestion pipeline runs in the background — watch the events feed for the DOCUMENT_INGESTED event.",
    },
    { status: 202 }
  );
}
