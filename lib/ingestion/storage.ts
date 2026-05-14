// Supabase Storage helper — bucket conventions for ingested docs.
// Replaces the GDrive-as-source-of-truth pattern from
// legacy/storage/gdrive.py. Drive is now a daily mirror (Phase 2 cron).

import { requireAdmin } from "@/lib/supabase/server";

export const DOCS_BUCKET = "delivery-ops-docs";

export interface UploadInput {
  customerKey: string;
  packageId: string;
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export async function ensureBucket(): Promise<void> {
  const sb = requireAdmin();
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === DOCS_BUCKET)) {
    // Create lazily — service-role can. RLS for the bucket will be tightened
    // in Phase 3.
    await sb.storage.createBucket(DOCS_BUCKET, { public: false });
  }
}

export async function uploadFile(input: UploadInput, path: string): Promise<string> {
  const sb = requireAdmin();
  const fullPath = `${input.customerKey}/${input.packageId}/${path}`;
  const body = typeof input.content === "string" ? Buffer.from(input.content, "utf-8") : input.content;
  const { error } = await sb.storage
    .from(DOCS_BUCKET)
    .upload(fullPath, body, { contentType: input.contentType, upsert: true });
  if (error) throw error;
  return fullPath;
}

export async function signedUrl(path: string, expiresInSec = 3600): Promise<string> {
  const sb = requireAdmin();
  const { data, error } = await sb.storage.from(DOCS_BUCKET).createSignedUrl(path, expiresInSec);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadText(path: string): Promise<string> {
  const sb = requireAdmin();
  const { data, error } = await sb.storage.from(DOCS_BUCKET).download(path);
  if (error || !data) throw error ?? new Error("Storage download returned empty.");
  return await data.text();
}
