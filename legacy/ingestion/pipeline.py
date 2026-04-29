"""Ingestion pipeline — orchestrates: detect type → convert → index → organize → log."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from slugify import slugify

from curator.customers import get_customer
from curator.ingestion import converters, classifier
from curator.storage import gdrive, event_log, cache_sync

logger = logging.getLogger(__name__)


# ── File abstraction ──────────────────────────────────────────────────────────


@dataclass
class IngestFile:
    """Represents a file to be ingested, regardless of source."""

    filename: str
    content: bytes
    mime_type: str = "application/octet-stream"
    source: str = "unknown"  # "slack", "email", "upload"
    source_detail: str = ""  # e.g. channel name, email subject
    metadata: dict[str, Any] = field(default_factory=dict)


# ── Pipeline ──────────────────────────────────────────────────────────────────


def _compute_md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


async def ingest(customer_key: str, file: IngestFile) -> str:
    """Full ingestion: inbox → indexed_documents → organized_docs → event log → cache sync.

    Returns a human-readable status string.
    """
    from curator.customers import ensure_customer_drive_folder
    customer = get_customer(customer_key)
    drive_folder_id = await ensure_customer_drive_folder(customer_key)
    timestamp = datetime.now(timezone.utc)
    md5_short = _compute_md5(file.content)[:8]
    slug = slugify(file.filename, max_length=60)
    package_id = f"{customer_key}-{slug}_{timestamp:%Y%m%d%H%M%S}_{md5_short}"

    # Determine file extension
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin"

    logger.info("[%s] Ingesting %s (%s, %d bytes)", customer_key, file.filename, file.mime_type, len(file.content))

    # ── 1. Drop original in /inbox/ ───────────────────────────────────────
    inbox_name = f"{timestamp.isoformat()}_{file.filename}"
    await gdrive.upload(drive_folder_id, f"inbox/{inbox_name}", file.content, file.mime_type)

    # ── 2. Create indexed_documents package ───────────────────────────────
    package_path = f"indexed_documents/{package_id}"
    await gdrive.create_folder(drive_folder_id, package_path)
    await gdrive.upload(drive_folder_id, f"{package_path}/original.{ext}", file.content, file.mime_type)

    # ── 3. Convert based on type ──────────────────────────────────────────
    pages: list[bytes] = []
    page_map: list[dict[str, Any]] = []
    markdown = ""

    match file.mime_type:
        case "application/pdf":
            pages, markdown, page_map = await converters.pdf_to_package(file.content)
            for i, page_img in enumerate(pages):
                await gdrive.upload(
                    drive_folder_id,
                    f"{package_path}/pages/page_{i + 1:03d}.png",
                    page_img,
                    "image/png",
                )
            if page_map:
                await gdrive.upload(
                    drive_folder_id,
                    f"{package_path}/text/page_map.json",
                    json.dumps(page_map),
                )

        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            markdown = await converters.docx_to_markdown(file.content)

        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            markdown = await converters.pptx_to_markdown(file.content)

        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            markdown = await converters.xlsx_to_markdown(file.content)

        case t if t.startswith("image/"):
            markdown = await converters.image_to_markdown(file.content)

        case _:
            markdown = await converters.generic_to_text(file.content)

    # Upload the markdown content
    await gdrive.upload(drive_folder_id, f"{package_path}/text/content.md", markdown)

    # ── 4. Write metadata.json ────────────────────────────────────────────
    metadata = {
        "id": package_id,
        "title": file.filename,
        "source": file.source,
        "source_detail": file.source_detail,
        "ingested_at": timestamp.isoformat(),
        "original_filename": file.filename,
        "mime_type": file.mime_type,
        "md5": md5_short,
        "page_count": len(pages) if pages else None,
        "status": "indexed",
    }

    # ── 5. Classify and place in organized_docs + original_docs ─────────
    category = await classifier.classify(markdown, file.filename)
    metadata["category"] = category
    org_path = f"organized_docs/{category}/{slug}.md"
    metadata["organized_path"] = org_path
    await gdrive.upload(drive_folder_id, org_path, markdown)

    # Store the original (unprocessed) document in original_docs
    orig_doc_path = f"original_docs/{category}/{file.filename}"
    metadata["original_doc_path"] = orig_doc_path
    await gdrive.upload(drive_folder_id, orig_doc_path, file.content, file.mime_type)

    await gdrive.upload(
        drive_folder_id,
        f"{package_path}/metadata.json",
        json.dumps(metadata, indent=2),
    )

    # ── 6. Log event ─────────────────────────────────────────────────────
    await event_log.append(
        customer_key,
        "DOCUMENT_INGESTED",
        {
            "filename": file.filename,
            "package_id": package_id,
            "category": category,
            "source": file.source,
            "mime_type": file.mime_type,
            "page_count": len(pages) if pages else None,
        },
        summary=f"Ingested {file.filename} → {category}/",
    )

    # ── 7. Sync to cache ─────────────────────────────────────────────────
    try:
        await cache_sync.sync_customer(customer_key)
    except Exception:
        logger.warning("Post-ingest cache sync failed for %s", customer_key, exc_info=True)

    status = f"📄 Ingested {file.filename} → {category}/ ({len(pages) if pages else '?'} pages)"
    logger.info("[%s] %s", customer_key, status)
    return status
