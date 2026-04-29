// Google Drive client — per-customer folder model.
// Drive is a daily mirror of Supabase Storage in the new architecture, not
// the source of truth. Cron job (Phase 2) does Supabase → Drive sync once a
// day so humans can browse customer files in the Drive UI.
//
// Dev-mode behaviour: when Google OAuth env vars are missing, ensureFolder
// returns a mock folder id, findChild returns null, and upload logs to the
// dev outbox.

import { getGoogleAccessToken } from "./auth";
import { recordOutbox } from "@/lib/dev/outbox";
import { driveEnabled } from "@/lib/dev/mode";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

async function driveFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`Drive API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

export async function findChild(
  parentId: string,
  name: string,
  opts: { folderOnly?: boolean } = {}
): Promise<DriveFile | null> {
  if (!driveEnabled()) return null;
  const folderClause = opts.folderOnly
    ? "and mimeType = 'application/vnd.google-apps.folder' "
    : "";
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' ${folderClause}and trashed = false`;
  const data = await driveFetch<{ files: DriveFile[] }>(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink)&pageSize=1`
  );
  return data.files[0] ?? null;
}

export async function ensureFolder(parentId: string, path: string): Promise<string> {
  if (!driveEnabled()) return `mock-${Buffer.from(`${parentId}/${path}`).toString("base64").slice(0, 16)}`;
  const segments = path.split("/").filter(Boolean);
  let currentId = parentId;
  for (const segment of segments) {
    const existing = await findChild(currentId, segment, { folderOnly: true });
    if (existing) {
      currentId = existing.id;
      continue;
    }
    const created = await driveFetch<{ id: string }>("/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: segment,
        mimeType: "application/vnd.google-apps.folder",
        parents: [currentId],
      }),
    });
    currentId = created.id;
  }
  return currentId;
}

export interface UploadInput {
  rootFolderId: string;
  path: string; // including filename, e.g. "inbox/2026-04/contract.pdf"
  content: Buffer | string;
  contentType: string;
  customerKey?: string; // for dev-mode outbox tagging
}

export async function upload(input: UploadInput): Promise<DriveFile> {
  if (!driveEnabled()) {
    const filename = input.path.split("/").pop() ?? "upload";
    const size =
      typeof input.content === "string"
        ? Buffer.byteLength(input.content, "utf-8")
        : input.content.length;
    const id = `mock-drive-${Date.now()}`;
    await recordOutbox({
      kind: "drive.upload",
      customerKey: input.customerKey ?? "unknown",
      summary: `Drive upload → ${input.path} (${formatBytes(size)})`,
      payload: {
        rootFolderId: input.rootFolderId,
        path: input.path,
        contentType: input.contentType,
        size,
        mock_file_id: id,
      },
    });
    return {
      id,
      name: filename,
      mimeType: input.contentType,
      webViewLink: `mock://drive/${id}`,
    };
  }
  const segments = input.path.split("/");
  const filename = segments.pop()!;
  const folderPath = segments.join("/");
  const parentId = folderPath ? await ensureFolder(input.rootFolderId, folderPath) : input.rootFolderId;

  // Multipart upload — small payloads only. Stream uploads land if/when we
  // start dealing with files >5 MB regularly.
  const boundary = `---${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: filename, parents: [parentId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`,
      "utf-8"
    ),
    typeof input.content === "string" ? Buffer.from(input.content, "utf-8") : input.content,
    Buffer.from(`\r\n--${boundary}--`, "utf-8"),
  ]);

  const token = await getGoogleAccessToken();
  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as DriveFile;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
