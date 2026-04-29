"""Conversation persistence — store Slack/email conversations as searchable docs.

Every conversation (inbound message + agent response) is:
1. Logged as a structured event in the weekly JSONL event log.
2. Saved as a markdown file in GDrive + local cache under
   ``conversations/<YYYY-MM-DD>/<timestamp>_<source>.md``
   so ripgrep can find them later.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles

from curator.config import CURATOR_CACHE_DIR
from curator.customers import get_customer
from curator.storage import event_log, gdrive

logger = logging.getLogger(__name__)


async def save_slack_conversation(
    customer_key: str,
    *,
    user_id: str,
    user_name: str = "",
    channel_name: str,
    user_message: str,
    bot_response: str,
) -> None:
    """Persist a Slack conversation exchange."""
    now = datetime.now(timezone.utc)
    ts_slug = now.strftime("%Y%m%dT%H%M%S")
    date_folder = now.strftime("%Y-%m-%d")
    display = user_name or user_id

    # ── 1. Log as event ──────────────────────────────────────────────────
    await event_log.append(
        customer_key,
        "SLACK_CONVERSATION",
        details={
            "channel": channel_name,
            "user_id": user_id,
            "user_name": display,
            "message": user_message[:2000],
            "response": bot_response[:2000],
        },
        summary=f"Slack ({display}): {user_message[:100]}",
        tags=["slack", "conversation"],
        timestamp=now,
    )

    # ── 2. Save as searchable markdown ───────────────────────────────────
    md = (
        f"# Slack Conversation — #{channel_name}\n"
        f"**Date:** {now.strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"**User:** {display} (<@{user_id}>)\n"
        f"**Channel:** #{channel_name}\n\n"
        f"---\n\n"
        f"## Question\n\n"
        f"{user_message}\n\n"
        f"---\n\n"
        f"## Response\n\n"
        f"{bot_response}\n"
    )

    rel_path = f"conversations/{date_folder}/{ts_slug}_slack.md"
    await _save_to_cache_and_drive(customer_key, rel_path, md)


async def save_slack_conversation_backfill(
    customer_key: str,
    *,
    user_id: str,
    user_name: str = "",
    channel_name: str,
    user_message: str,
    bot_response: str = "",
    timestamp: datetime,
) -> bool:
    """Persist a historical Slack conversation, using its original timestamp.

    Returns True if saved, False if a file for this timestamp already exists (dedup).
    """
    ts_slug = timestamp.strftime("%Y%m%dT%H%M%S")
    date_folder = timestamp.strftime("%Y-%m-%d")
    display = user_name or user_id

    # ── Dedup: skip if file already exists ────────────────────────────────
    cache_root = Path(get_customer(customer_key)["cache_path"])
    rel_path = f"conversations/{date_folder}/{ts_slug}_slack.md"
    if (cache_root / rel_path).exists():
        return False

    # ── 1. Log as event ──────────────────────────────────────────────────
    await event_log.append(
        customer_key,
        "SLACK_CONVERSATION",
        details={
            "channel": channel_name,
            "user_id": user_id,
            "user_name": display,
            "message": user_message[:2000],
            "response": bot_response[:2000],
            "backfill": True,
        },
        summary=f"Slack ({display}): {user_message[:100]}",
        tags=["slack", "conversation", "backfill"],
        timestamp=timestamp,
    )

    # ── 2. Save as searchable markdown ───────────────────────────────────
    time_str = timestamp.strftime("%Y-%m-%d %H:%M:%S UTC")
    md_parts = [
        f"# Slack Conversation — #{channel_name}\n",
        f"**Date:** {time_str}\n",
        f"**User:** {display} (<@{user_id}>)\n",
        f"**Channel:** #{channel_name}\n\n",
        f"---\n\n",
        f"## Message\n\n",
        f"{user_message}\n",
    ]
    if bot_response:
        md_parts.extend([
            f"\n---\n\n",
            f"## Response\n\n",
            f"{bot_response}\n",
        ])

    md = "".join(md_parts)
    await _save_to_cache_and_drive(customer_key, rel_path, md)
    return True


async def save_email_conversation(
    customer_key: str,
    *,
    from_addr: str,
    to_addr: str,
    subject: str,
    email_body: str,
    bot_response: str,
    response_status: str = "sent",
    approval_id: str = "",
) -> None:
    """Persist an email conversation exchange."""
    now = datetime.now(timezone.utc)
    ts_slug = now.strftime("%Y%m%dT%H%M%S")
    date_folder = now.strftime("%Y-%m-%d")

    status_label = {
        "sent": "responded",
        "pending_approval": "response pending approval",
    }.get(response_status, response_status)

    # ── 1. Log as event ──────────────────────────────────────────────────
    details: dict[str, Any] = {
        "from": from_addr,
        "to": to_addr,
        "subject": subject,
        "body": email_body[:2000],
        "response": bot_response[:2000],
        "response_status": response_status,
    }
    if approval_id:
        details["approval_id"] = approval_id

    await event_log.append(
        customer_key,
        "EMAIL_CONVERSATION",
        details=details,
        summary=f"Email from {from_addr}: {subject[:80]} → {status_label}",
        tags=["email", "conversation"],
        timestamp=now,
    )

    # ── 2. Save as searchable markdown ───────────────────────────────────
    md = (
        f"# Email Conversation\n"
        f"**Date:** {now.strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"**From:** {from_addr}\n"
        f"**To:** {to_addr}\n"
        f"**Subject:** {subject}\n\n"
        f"---\n\n"
        f"## Inbound Email\n\n"
        f"{email_body}\n\n"
        f"---\n\n"
        f"## Response\n\n"
        f"{bot_response}\n"
    )

    rel_path = f"conversations/{date_folder}/{ts_slug}_email.md"
    await _save_to_cache_and_drive(customer_key, rel_path, md)


async def _save_to_cache_and_drive(
    customer_key: str, rel_path: str, content: str
) -> None:
    """Write a conversation file to both local cache and GDrive."""
    # ── Local cache ──────────────────────────────────────────────────────
    cache_path = Path(get_customer(customer_key)["cache_path"]) / rel_path
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(cache_path, "w") as fh:
        await fh.write(content)
    logger.info("[%s] Saved conversation: %s", customer_key, rel_path)

    # ── GDrive (best-effort) ─────────────────────────────────────────────
    try:
        from curator.customers import ensure_customer_drive_folder
        drive_id = await ensure_customer_drive_folder(customer_key)
        if drive_id:
            await gdrive.upload(drive_id, rel_path, content, "text/markdown")
    except Exception:
        logger.warning(
            "Failed to upload conversation to GDrive for %s", customer_key, exc_info=True
        )
