"""Cache sync — keep the local VM cache in sync with Google Drive.

Google Drive is treated as the **source of truth**.  Any local files or
directories that no longer exist in Drive are removed during sync.

Syncs the ``indexed_documents/``, ``events/``, and ``meta/`` subtrees
for each customer to the local cache directory.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

import aiofiles

from curator.config import CURATOR_CACHE_DIR
from curator.storage import gdrive
from curator.customers import CUSTOMERS

logger = logging.getLogger(__name__)


async def sync_customer(customer_key: str) -> int:
    """Sync a single customer's Drive content to local cache.

    Drive is the source of truth — local files not present in Drive are
    deleted.  Returns the number of files downloaded.
    """
    from curator.customers import get_customer, ensure_customer_drive_folder

    cfg = get_customer(customer_key)
    if not cfg.get("drive_folder_id"):
        logger.warning("No drive_folder_id for %s — skipping sync", customer_key)
        return 0

    drive_folder_id = await ensure_customer_drive_folder(customer_key)
    cache_root = Path(cfg["cache_path"])
    synced = 0

    # Sync these subtrees
    for subtree in ("indexed_documents", "original_docs", "events", "meta", "conversations"):
        folder_id = await gdrive.resolve_folder_path(drive_folder_id, subtree)
        local_subtree = cache_root / subtree
        if not folder_id:
            # Subtree doesn't exist in Drive → remove local copy entirely
            if local_subtree.exists():
                logger.info("Removing local subtree %s (not in Drive)", local_subtree)
                shutil.rmtree(local_subtree, ignore_errors=True)
            continue
        synced += await _sync_folder(folder_id, local_subtree)

    logger.info("Synced %d files for %s", synced, customer_key)
    return synced


async def _sync_folder(folder_id: str, local_dir: Path, depth: int = 0) -> int:
    """Recursively sync a GDrive folder to a local directory.

    After downloading all Drive items, any local files or sub-directories
    that were NOT seen in Drive are deleted.
    """
    if depth > 10:
        logger.warning("Max depth reached syncing folder %s", folder_id)
        return 0

    local_dir.mkdir(parents=True, exist_ok=True)
    items = await gdrive.list_files(
        folder_id, fields="files(id, name, mimeType, modifiedTime)"
    )
    synced = 0

    # Track names that exist in Drive so we can prune local orphans
    drive_names: set[str] = set()

    for item in items:
        name = item["name"]
        mime = item["mimeType"]
        local_path = local_dir / name
        drive_names.add(name)

        if mime == "application/vnd.google-apps.folder":
            synced += await _sync_folder(item["id"], local_path, depth + 1)
        else:
            try:
                data = await gdrive.download(item["id"])
                async with aiofiles.open(local_path, "wb") as fh:
                    await fh.write(data)
                synced += 1
            except Exception:
                logger.warning("Failed to sync %s/%s", folder_id, name, exc_info=True)

    # ── Prune local items not present in Drive ────────────────────────────
    for child in local_dir.iterdir():
        if child.name not in drive_names:
            if child.is_dir():
                logger.info("Removing orphaned local dir: %s", child)
                shutil.rmtree(child, ignore_errors=True)
            else:
                logger.info("Removing orphaned local file: %s", child)
                child.unlink(missing_ok=True)

    return synced


async def sync_all() -> dict[str, int]:
    """Sync all customers. Returns a dict of customer_key → files synced."""
    results: dict[str, int] = {}
    for customer_key in CUSTOMERS:
        try:
            results[customer_key] = await sync_customer(customer_key)
        except Exception:
            logger.error("Sync failed for %s", customer_key, exc_info=True)
            results[customer_key] = 0
    return results
