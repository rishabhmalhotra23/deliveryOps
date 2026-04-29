"""Per-customer rules storage — free-form markdown dos and don'ts.

Each customer gets a ``rules.md`` file that the agent must follow.
Both the dashboard UI and the agent can read and update the rules.
The file is synced to Google Drive alongside profiles and event logs.
"""

from __future__ import annotations

import logging
from pathlib import Path

import aiofiles

from curator.config import CURATOR_CACHE_DIR

logger = logging.getLogger(__name__)

# ── Default starter template ──────────────────────────────────────────────────

_DEFAULT_RULES = """\
# Customer Rules

<!-- Add dos and don'ts for the AI agent when working with this customer. -->
<!-- These rules are injected into every agent interaction and override general guidelines. -->

## Communication preferences
- 

## Topics to avoid
- 

## Escalation policies
- 

## Other notes
- 
"""


# ── Helpers ───────────────────────────────────────────────────────────────────


def _rules_path(customer_key: str) -> Path:
    return CURATOR_CACHE_DIR / customer_key / "meta" / "rules.md"


async def _save_to_disk_and_drive(
    customer_key: str, path: Path, content: str,
) -> None:
    """Write rules to local cache and upload to Drive (best-effort)."""
    path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(path, "w") as fh:
        await fh.write(content)

    try:
        from curator.customers import ensure_customer_drive_folder
        from curator.storage import gdrive

        drive_id = await ensure_customer_drive_folder(customer_key)
        if drive_id:
            await gdrive.upload(
                drive_id, "meta/rules.md", content, "text/markdown",
            )
    except Exception:
        logger.warning(
            "Failed to upload rules.md to GDrive for %s",
            customer_key,
            exc_info=True,
        )


# ── Public API ────────────────────────────────────────────────────────────────


async def get_rules(customer_key: str) -> str:
    """Load the customer's rules markdown.

    Returns the content string (may be the default template if no file exists).
    """
    path = _rules_path(customer_key)

    if path.exists():
        try:
            async with aiofiles.open(path) as fh:
                return await fh.read()
        except Exception:
            logger.warning("Failed to read %s, returning default", path, exc_info=True)

    # First access — create with default template and sync
    await _save_to_disk_and_drive(customer_key, path, _DEFAULT_RULES)
    return _DEFAULT_RULES


async def update_rules(
    customer_key: str,
    content: str,
    *,
    updated_by: str = "dashboard",
) -> str:
    """Replace the customer's rules with *content*.

    Returns the saved content.
    """
    path = _rules_path(customer_key)
    await _save_to_disk_and_drive(customer_key, path, content)
    logger.info("[%s] Rules updated by %s (%d chars)", customer_key, updated_by, len(content))
    return content
