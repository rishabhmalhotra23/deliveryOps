"""Deck generator — builds Google Slides decks from a template + data.

Uses the shared OAuth2 credentials to access the Slides and Drive APIs.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from curator.config import WEEKLY_TEMPLATE_ID
from curator.storage.google_auth import get_slides_service, get_drive_service

logger = logging.getLogger(__name__)


def _create_sync(
    template_id: str | None,
    customer: dict[str, Any],
    metrics: dict[str, Any],
    credits: dict[str, Any],
    highlights: str,
    events: list[dict[str, Any]],
) -> str:
    """Synchronous deck creation."""
    template = template_id or WEEKLY_TEMPLATE_ID
    if not template:
        logger.warning("No slides template ID configured — skipping deck generation")
        return "(Deck generation skipped — no template configured)"

    drive_service = get_drive_service()
    slides_service = get_slides_service()

    customer_name = customer.get("display_name", "Customer")
    week_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    copy_title = f"Weekly Update — {customer_name} — {week_str}"

    # ── 1. Copy the template ──────────────────────────────────────────────
    try:
        copy = (
            drive_service.files()
            .copy(fileId=template, body={"name": copy_title})
            .execute()
        )
        deck_id = copy["id"]
    except Exception as exc:
        logger.error("Failed to copy template %s: %s", template, exc)
        return f"(Deck generation failed: {exc})"

    # ── 2. Replace placeholders ───────────────────────────────────────────
    replacements = _build_replacements(customer, metrics, credits, highlights, events, week_str)

    requests = []
    for placeholder, value in replacements.items():
        requests.append(
            {
                "replaceAllText": {
                    "containsText": {"text": placeholder, "matchCase": True},
                    "replaceText": str(value),
                }
            }
        )

    if requests:
        try:
            slides_service.presentations().batchUpdate(
                presentationId=deck_id, body={"requests": requests}
            ).execute()
        except Exception as exc:
            logger.warning("Failed to update slides: %s", exc)

    deck_url = f"https://docs.google.com/presentation/d/{deck_id}/edit"
    logger.info("Created deck: %s", deck_url)
    return deck_url


async def create(
    template_id: str | None,
    customer: dict[str, Any],
    metrics: dict[str, Any],
    credits: dict[str, Any],
    highlights: str,
    events: list[dict[str, Any]],
) -> str:
    """Create a weekly update slide deck from a template.

    1. Copy the template
    2. Replace placeholder text with real data
    3. Return the URL of the new deck
    """
    return await asyncio.to_thread(
        _create_sync, template_id, customer, metrics, credits, highlights, events
    )


def _build_replacements(
    customer: dict[str, Any],
    metrics: dict[str, Any],
    credits: dict[str, Any],
    highlights: str,
    events: list[dict[str, Any]],
    week_str: str,
) -> dict[str, str]:
    """Build a dict of {{PLACEHOLDER}} → value mappings."""
    contract = customer.get("contract", {})

    # Format events as a bullet list
    event_lines = []
    for e in events[:10]:
        event_lines.append(f"• [{e.get('event_type', '?')}] {e.get('summary', '?')}")
    events_text = "\n".join(event_lines) if event_lines else "No notable events this week."

    return {
        "{{CUSTOMER_NAME}}": customer.get("display_name", ""),
        "{{WEEK_DATE}}": week_str,
        "{{TIER}}": contract.get("tier", "—"),
        "{{RENEWAL_DATE}}": contract.get("renewal_date", "—"),
        "{{CREDITS_USED}}": str(credits.get("credits_used", "—")),
        "{{CREDITS_REMAINING}}": str(credits.get("credits_remaining", "—")),
        "{{CREDIT_LIMIT}}": str(credits.get("credit_limit", "—")),
        "{{UTILIZATION_PCT}}": (
            f"{credits.get('utilization_pct', 0):.0%}"
            if isinstance(credits.get("utilization_pct"), (int, float))
            else "—"
        ),
        "{{HIGHLIGHTS}}": highlights,
        "{{EVENTS}}": events_text,
    }
