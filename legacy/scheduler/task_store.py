"""Persistent task storage — JSON files in GDrive + local cache.

Each customer has:
  GDrive: /customers/<key>/meta/tasks.json   (source of truth)
  Cache:  ~/curator/cache/<key>/meta/tasks.json  (fast reads)
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles

from curator.config import CURATOR_CACHE_DIR
from curator.storage import gdrive

logger = logging.getLogger(__name__)


def _assert_path_contained(path: Path, customer_key: str) -> None:
    """Isolation guard: ensure path stays within the customer's directory."""
    resolved = path.resolve()
    allowed = (CURATOR_CACHE_DIR / customer_key).resolve()
    if not str(resolved).startswith(str(allowed)):
        raise PermissionError(
            f"Path traversal blocked: {resolved} is outside {allowed}"
        )


def _tasks_path(customer_key: str) -> Path:
    """Local cache path for a customer's tasks file."""
    path = CURATOR_CACHE_DIR / customer_key / "meta" / "tasks.json"
    _assert_path_contained(path, customer_key)
    return path


async def _read_tasks(customer_key: str) -> list[dict[str, Any]]:
    """Read all tasks from local cache."""
    path = _tasks_path(customer_key)
    if not path.exists():
        return []
    async with aiofiles.open(path) as fh:
        content = await fh.read()
    try:
        data = json.loads(content)
        return data.get("tasks", [])
    except (json.JSONDecodeError, KeyError):
        logger.warning("Corrupt tasks file for %s", customer_key)
        return []


async def _write_tasks(customer_key: str, tasks: list[dict[str, Any]]) -> None:
    """Write all tasks to local cache and GDrive."""
    path = _tasks_path(customer_key)
    path.parent.mkdir(parents=True, exist_ok=True)

    payload = json.dumps({"tasks": tasks}, indent=2)

    # Write local
    async with aiofiles.open(path, "w") as fh:
        await fh.write(payload)

    # Write to GDrive (best-effort)
    try:
        from curator.customers import ensure_customer_drive_folder

        drive_id = await ensure_customer_drive_folder(customer_key)
        if drive_id:
            await gdrive.upload(drive_id, "meta/tasks.json", payload)
    except Exception:
        logger.warning("Failed to upload tasks to GDrive for %s", customer_key, exc_info=True)


# ── Public API ────────────────────────────────────────────────────────────────


async def create_task(
    customer_key: str,
    description: str,
    schedule: dict[str, Any],
    action: dict[str, Any],
    tags: list[str] | None = None,
    created_by: str = "agent",
) -> dict[str, Any]:
    """Create a new scheduled task.

    Returns the created task dict.
    """
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()

    task = {
        "id": task_id,
        "customer": customer_key,
        "created_at": now,
        "created_by": created_by,
        "description": description,
        "schedule": schedule,
        "action": action,
        "status": "active",
        "last_run": None,
        "tags": tags or [],
    }

    tasks = await _read_tasks(customer_key)
    tasks.append(task)
    await _write_tasks(customer_key, tasks)

    logger.info("[%s] Created task %s: %s", customer_key, task_id, description)
    return task


async def get_tasks(
    customer_key: str, *, include_completed: bool = False
) -> list[dict[str, Any]]:
    """Get tasks for a customer.  By default only active tasks."""
    tasks = await _read_tasks(customer_key)
    if not include_completed:
        tasks = [t for t in tasks if t.get("status") == "active"]
    return tasks


async def get_active(customer_key: str) -> list[dict[str, Any]]:
    """Get only active tasks (shortcut)."""
    return await get_tasks(customer_key, include_completed=False)


async def complete_task(customer_key: str, task_id: str) -> bool:
    """Mark a task as completed. Returns True if found."""
    tasks = await _read_tasks(customer_key)
    for task in tasks:
        if task["id"] == task_id:
            task["status"] = "completed"
            await _write_tasks(customer_key, tasks)
            logger.info("[%s] Completed task %s", customer_key, task_id)
            return True
    return False


async def cancel_task(customer_key: str, task_id: str) -> bool:
    """Cancel a task. Returns True if found."""
    tasks = await _read_tasks(customer_key)
    for task in tasks:
        if task["id"] == task_id and task["status"] == "active":
            task["status"] = "cancelled"
            await _write_tasks(customer_key, tasks)
            logger.info("[%s] Cancelled task %s", customer_key, task_id)
            return True
    return False


async def update_last_run(customer_key: str, task_id: str, run_time: datetime) -> bool:
    """Update the last_run timestamp for a recurring task."""
    tasks = await _read_tasks(customer_key)
    for task in tasks:
        if task["id"] == task_id:
            task["last_run"] = run_time.isoformat()
            await _write_tasks(customer_key, tasks)
            return True
    return False
