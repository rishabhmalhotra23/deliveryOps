"""Event log — append events to per-customer weekly event files.

Events are stored as JSONL files in:
  GDrive: /customers/<key>/events/<YYYY-WNN>.jsonl
  Cache:  ~/curator/cache/<key>/events/<YYYY-WNN>.jsonl
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles

from curator.config import CURATOR_CACHE_DIR
from curator.storage import gdrive

logger = logging.getLogger(__name__)


def _week_key(dt: datetime | None = None) -> str:
    """Return a ``YYYY-WNN`` string for the ISO week containing *dt*."""
    dt = dt or datetime.now(timezone.utc)
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _assert_path_contained(path: Path, customer_key: str) -> None:
    """Isolation guard: ensure path stays within the customer's directory."""
    resolved = path.resolve()
    allowed = (CURATOR_CACHE_DIR / customer_key).resolve()
    if not str(resolved).startswith(str(allowed)):
        raise PermissionError(
            f"Path traversal blocked: {resolved} is outside {allowed}"
        )


def _event_path(customer_key: str, week: str | None = None) -> Path:
    """Local cache path for a customer's weekly event file."""
    week = week or _week_key()
    path = CURATOR_CACHE_DIR / customer_key / "events" / f"{week}.jsonl"
    _assert_path_contained(path, customer_key)
    return path


async def append(
    customer_key: str,
    event_type: str,
    details: dict[str, Any] | None = None,
    *,
    summary: str = "",
    tags: list[str] | None = None,
    timestamp: datetime | None = None,
) -> dict[str, Any]:
    """Append a structured event to this week's log for *customer_key*.

    Returns the event dict that was written.
    """
    ts = timestamp or datetime.now(timezone.utc)
    event = {
        "timestamp": ts.isoformat(),
        "event_type": event_type,
        "summary": summary or event_type,
        "details": details or {},
        "tags": tags or [],
    }

    # ── Write to local cache ──────────────────────────────────────────────
    path = _event_path(customer_key, _week_key(ts))
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "a") as fh:
        await fh.write(json.dumps(event) + "\n")

    logger.info("[%s] event: %s — %s", customer_key, event_type, summary or "(no summary)")

    # ── Also upload to GDrive (best-effort) ───────────────────────────────
    try:
        from curator.customers import ensure_customer_drive_folder

        drive_id = await ensure_customer_drive_folder(customer_key)
        if drive_id:
            week = _week_key(ts)
            await gdrive.upload(
                drive_id,
                f"events/{week}.jsonl",
                json.dumps(event) + "\n",
            )
    except Exception:
        logger.warning("Failed to upload event to GDrive for %s", customer_key, exc_info=True)

    return event


async def get_week(
    customer_key: str, week: str | None = None
) -> list[dict[str, Any]]:
    """Read all events for a given week from local cache."""
    path = _event_path(customer_key, week)
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    async with aiofiles.open(path) as fh:
        async for line in fh:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


async def get_recent(
    customer_key: str, limit: int = 50
) -> list[dict[str, Any]]:
    """Return the most recent *limit* events across all weeks, newest first."""
    events_dir = CURATOR_CACHE_DIR / customer_key / "events"
    if not events_dir.exists():
        return []
    all_events: list[dict[str, Any]] = []
    # Walk weekly files in reverse order (newest weeks first)
    for path in sorted(events_dir.glob("*.jsonl"), reverse=True):
        async with aiofiles.open(path) as fh:
            async for line in fh:
                line = line.strip()
                if line:
                    all_events.append(json.loads(line))
        if len(all_events) >= limit:
            break
    # Sort by timestamp descending and trim
    all_events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return all_events[:limit]
