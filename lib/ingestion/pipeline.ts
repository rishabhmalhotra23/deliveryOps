// Document ingestion pipeline. Port of legacy/ingestion/pipeline.py.
//
// Flow per file:
//   1. Drop raw file in Storage at <customer>/<package_id>/original.<ext>
//   2. Extract Markdown via lib/ingestion/extract (Claude vision for PDF/img)
//   3. Save Markdown alongside the raw file
//   4. Classify into one of the document categories
//   5. Save metadata.json
//   6. Append a DOCUMENT_INGESTED event with the package id + category
//
// Drive mirror is intentionally deferred — Supabase Storage is canonical now.

import crypto from "crypto";
import { appendEvent } from "@/lib/events/events";
import { extract } from "@/lib/ingestion/extract";
import { classifyDocument, type DocumentCategory } from "@/lib/ingestion/classifier";
import { uploadFile, ensureBucket } from "@/lib/ingestion/storage";

export interface IngestFile {
  filename: string;
  content: Buffer;
  mimeType: string;
  source: "slack" | "email" | "upload" | "drive" | "unknown";
  sourceDetail?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  packageId: string;
  category: DocumentCategory;
  pageCount: number;
  markdownPath: string;
  originalPath: string;
  metadataPath: string;
  status: string;
}

export function slugify(s: string, max = 60): string {
  return (
    s
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w\-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "untitled"
  );
}

export async function ingest(customerKey: string, file: IngestFile): Promise<IngestResult> {
  await ensureBucket();
  const ts = new Date();
  const md5 = crypto.createHash("md5").update(file.content).digest("hex").slice(0, 8);
  const slug = slugify(file.filename);
  const stamp = ts.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "");
  const packageId = `${customerKey}-${slug}_${stamp}_${md5}`;
  const ext = (file.filename.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "bin").toLowerCase();

  // 1 + 3 — store original and markdown side by side.
  const originalPath = await uploadFile(
    {
      customerKey,
      packageId,
      filename: file.filename,
      content: file.content,
      contentType: file.mimeType,
    },
    `original.${ext}`
  );

  // 2 — extract markdown.
  const { markdown, pageCount } = await extract(file.content, file.mimeType);

  const markdownPath = await uploadFile(
    {
      customerKey,
      packageId,
      filename: `${slug}.md`,
      content: markdown,
      contentType: "text/markdown; charset=utf-8",
    },
    "content.md"
  );

  // 4 — classify.
  const category = await classifyDocument(file.filename, markdown);

  // Mirror into a category-keyed copy so the agent's search and the dashboard
  // organised view both have a stable lookup path.
  const orgPath = await uploadFile(
    {
      customerKey,
      packageId,
      filename: `${slug}.md`,
      content: markdown,
      contentType: "text/markdown; charset=utf-8",
    },
    `organized/${category}/${slug}.md`
  );
  const orgOrigPath = await uploadFile(
    {
      customerKey,
      packageId,
      filename: file.filename,
      content: file.content,
      contentType: file.mimeType,
    },
    `original_docs/${category}/${file.filename}`
  );

  const metadata = {
    id: packageId,
    title: file.filename,
    source: file.source,
    source_detail: file.sourceDetail ?? "",
    ingested_at: ts.toISOString(),
    original_filename: file.filename,
    mime_type: file.mimeType,
    md5,
    page_count: pageCount,
    category,
    organized_path: orgPath,
    original_doc_path: orgOrigPath,
    status: "indexed",
    extra: file.metadata ?? {},
  };

  const metadataPath = await uploadFile(
    {
      customerKey,
      packageId,
      filename: "metadata.json",
      content: JSON.stringify(metadata, null, 2),
      contentType: "application/json",
    },
    "metadata.json"
  );

  // 6 — log event so the agent and dashboard see the new doc.
  await appendEvent(
    customerKey,
    "DOCUMENT_INGESTED",
    {
      filename: file.filename,
      package_id: packageId,
      category,
      source: file.source,
      mime_type: file.mimeType,
      page_count: pageCount,
      organized_path: orgPath,
      original_doc_path: orgOrigPath,
    },
    {
      summary: `Ingested ${file.filename} → ${category}/`,
      tags: ["document", category, file.source],
    }
  );

  return {
    packageId,
    category,
    pageCount,
    markdownPath,
    originalPath,
    metadataPath,
    status: `Ingested ${file.filename} → ${category}/ (${pageCount} page${pageCount === 1 ? "" : "s"}).`,
  };
}
