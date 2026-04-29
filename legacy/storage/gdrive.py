"""Google Drive operations via OAuth2 user credentials.

Uses the shared credential loader from ``google_auth`` and calls the
Drive v3 API directly.  Synchronous client calls are wrapped with
``asyncio.to_thread`` so the rest of the codebase stays async.
"""

from __future__ import annotations

import asyncio
import io
import logging
import ssl
import time
from typing import Any

from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload

from curator.storage.google_auth import get_drive_service

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds


def _retry(func):
    """Decorator that retries a sync function on transient SSL/connection errors."""
    def wrapper(*args, **kwargs):
        last_exc = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                return func(*args, **kwargs)
            except (ssl.SSLError, ConnectionError, OSError) as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                    logger.warning(
                        "Transient error in %s (attempt %d/%d): %s — retrying in %.1fs",
                        func.__name__, attempt, _MAX_RETRIES, exc, delay,
                    )
                    time.sleep(delay)
                else:
                    logger.error("All %d retries exhausted for %s", _MAX_RETRIES, func.__name__)
        raise last_exc  # type: ignore[misc]
    return wrapper


# ── Folder helpers ────────────────────────────────────────────────────────────


@_retry
def _resolve_folder_path_sync(root_folder_id: str, path: str) -> str | None:
    """Walk *path* segments under *root_folder_id*, returning the final ID."""
    service = get_drive_service()
    segments = [s for s in path.split("/") if s]
    current_id = root_folder_id

    for segment in segments:
        query = (
            f"'{current_id}' in parents "
            f"and name = '{segment}' "
            f"and mimeType = 'application/vnd.google-apps.folder' "
            f"and trashed = false"
        )
        results = service.files().list(
            q=query, fields="files(id)", spaces="drive", pageSize=1
        ).execute()
        files = results.get("files", [])
        if not files:
            return None
        current_id = files[0]["id"]

    return current_id


async def resolve_folder_path(root_folder_id: str, path: str) -> str | None:
    """Walk *path* (e.g. ``"inbox/2026"``) under *root_folder_id* and return
    the final folder ID, or ``None`` if any segment is missing."""
    return await asyncio.to_thread(_resolve_folder_path_sync, root_folder_id, path)


@_retry
def _create_folder_sync(root_folder_id: str, path: str) -> str:
    """Create folder hierarchy, returning the deepest folder ID."""
    service = get_drive_service()
    segments = [s for s in path.split("/") if s]
    current_id = root_folder_id

    for segment in segments:
        # Check if this segment already exists
        query = (
            f"'{current_id}' in parents "
            f"and name = '{segment}' "
            f"and mimeType = 'application/vnd.google-apps.folder' "
            f"and trashed = false"
        )
        results = service.files().list(
            q=query, fields="files(id)", spaces="drive", pageSize=1
        ).execute()
        files = results.get("files", [])

        if files:
            current_id = files[0]["id"]
        else:
            metadata = {
                "name": segment,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [current_id],
            }
            folder = service.files().create(body=metadata, fields="id").execute()
            current_id = folder["id"]

    return current_id


async def create_folder(root_folder_id: str, path: str) -> str:
    """Create a folder hierarchy under *root_folder_id*, returning the deepest
    folder ID.  Segments that already exist are reused."""
    folder_id = await asyncio.to_thread(_create_folder_sync, root_folder_id, path)
    logger.info("Created/resolved folder %s/%s → %s", root_folder_id, path, folder_id)
    return folder_id


# ── File operations ───────────────────────────────────────────────────────────


@_retry
def _upload_sync(
    root_folder_id: str,
    path: str,
    content: bytes | str,
    mime_type: str,
) -> str:
    """Upload content to <root_folder_id>/<path>.

    If a file with the same name already exists in the target folder,
    it is **updated** (overwritten) instead of creating a duplicate.
    """
    service = get_drive_service()
    parts = [s for s in path.split("/") if s]
    file_name = parts[-1]
    folder_parts = parts[:-1]

    # Ensure parent folder exists
    parent_id = root_folder_id
    if folder_parts:
        parent_id = _create_folder_sync(root_folder_id, "/".join(folder_parts))

    # Prepare content
    if isinstance(content, str):
        stream = io.BytesIO(content.encode("utf-8"))
        if mime_type == "application/octet-stream":
            mime_type = "text/plain"
    else:
        stream = io.BytesIO(content)

    media = MediaIoBaseUpload(stream, mimetype=mime_type, resumable=True)

    # Check if a file with this name already exists in the folder
    query = (
        f"'{parent_id}' in parents "
        f"and name = '{file_name}' "
        f"and mimeType != 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    existing = service.files().list(
        q=query, fields="files(id)", spaces="drive", pageSize=1
    ).execute().get("files", [])

    if existing:
        # Update the existing file
        file_id = existing[0]["id"]
        service.files().update(
            fileId=file_id, media_body=media
        ).execute()
        return file_id
    else:
        # Create a new file
        metadata = {"name": file_name, "parents": [parent_id]}
        file = service.files().create(body=metadata, media_body=media, fields="id").execute()
        return file["id"]


async def upload(
    root_folder_id: str,
    path: str,
    content: bytes | str,
    mime_type: str = "application/octet-stream",
) -> str:
    """Upload *content* to ``<root_folder_id>/<path>``.

    Intermediate folders are created automatically.  Returns the new file ID.
    """
    file_id = await asyncio.to_thread(_upload_sync, root_folder_id, path, content, mime_type)
    logger.info("Uploaded %s → %s", path, file_id)
    return file_id


@_retry
def _download_sync(file_id: str) -> bytes:
    """Download a file by ID and return raw bytes."""
    service = get_drive_service()
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


async def download(file_id: str) -> bytes:
    """Download a file by ID and return raw bytes."""
    return await asyncio.to_thread(_download_sync, file_id)


@_retry
def _list_files_sync(
    folder_id: str,
    query_extra: str = "",
    fields: str = "files(id, name, mimeType, modifiedTime)",
) -> list[dict[str, Any]]:
    """List files in a folder."""
    service = get_drive_service()
    query = f"'{folder_id}' in parents and trashed = false"
    if query_extra:
        query += f" and {query_extra}"

    all_files: list[dict[str, Any]] = []
    page_token = None

    while True:
        results = service.files().list(
            q=query,
            fields=f"nextPageToken, {fields}",
            spaces="drive",
            pageSize=100,
            pageToken=page_token,
        ).execute()
        all_files.extend(results.get("files", []))
        page_token = results.get("nextPageToken")
        if not page_token:
            break

    return all_files


async def list_files(
    folder_id: str,
    query_extra: str = "",
    fields: str = "files(id, name, mimeType, modifiedTime)",
) -> list[dict[str, Any]]:
    """List files in *folder_id*.  *query_extra* is appended to the query."""
    return await asyncio.to_thread(_list_files_sync, folder_id, query_extra, fields)


@_retry
def _move_sync(file_id: str, new_parent_id: str) -> None:
    """Move a file to a new parent folder."""
    service = get_drive_service()
    file = service.files().get(fileId=file_id, fields="parents").execute()
    previous_parents = ",".join(file.get("parents", []))
    service.files().update(
        fileId=file_id,
        addParents=new_parent_id,
        removeParents=previous_parents,
        fields="id, parents",
    ).execute()


async def move(file_id: str, new_parent_id: str) -> None:
    """Move a file to a new parent folder."""
    await asyncio.to_thread(_move_sync, file_id, new_parent_id)
    logger.info("Moved %s → parent %s", file_id, new_parent_id)


@_retry
def _delete_sync(file_id: str) -> None:
    """Trash a file."""
    service = get_drive_service()
    service.files().update(fileId=file_id, body={"trashed": True}).execute()


async def delete(file_id: str) -> None:
    """Trash a file."""
    await asyncio.to_thread(_delete_sync, file_id)
    logger.info("Trashed %s", file_id)


@_retry
def _get_file_metadata_sync(file_id: str) -> dict[str, Any]:
    """Get file metadata."""
    service = get_drive_service()
    return service.files().get(
        fileId=file_id,
        fields="id, name, mimeType, modifiedTime, size, parents",
    ).execute()


async def get_file_metadata(file_id: str) -> dict[str, Any]:
    """Get metadata for a file."""
    return await asyncio.to_thread(_get_file_metadata_sync, file_id)


# ── File-by-path helpers ──────────────────────────────────────────────────────


@_retry
def _resolve_file_by_path_sync(
    root_folder_id: str, path: str,
) -> dict[str, Any] | None:
    """Resolve a file by its path under *root_folder_id*.

    Returns ``{id, name, mimeType, webViewLink}`` or ``None``.
    """
    service = get_drive_service()
    parts = [s for s in path.split("/") if s]
    if not parts:
        return None

    file_name = parts[-1]
    folder_parts = parts[:-1]

    # Walk folders
    parent_id = root_folder_id
    for segment in folder_parts:
        query = (
            f"'{parent_id}' in parents "
            f"and name = '{segment}' "
            f"and mimeType = 'application/vnd.google-apps.folder' "
            f"and trashed = false"
        )
        results = service.files().list(
            q=query, fields="files(id)", spaces="drive", pageSize=1,
        ).execute()
        files = results.get("files", [])
        if not files:
            return None
        parent_id = files[0]["id"]

    # Find the file itself
    query = (
        f"'{parent_id}' in parents "
        f"and name = '{file_name}' "
        f"and mimeType != 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    results = service.files().list(
        q=query,
        fields="files(id, name, mimeType, webViewLink, size)",
        spaces="drive",
        pageSize=1,
    ).execute()
    files = results.get("files", [])
    return files[0] if files else None


async def resolve_file_by_path(
    root_folder_id: str, path: str,
) -> dict[str, Any] | None:
    """Resolve a file by path, returning metadata with ``webViewLink``."""
    return await asyncio.to_thread(_resolve_file_by_path_sync, root_folder_id, path)
