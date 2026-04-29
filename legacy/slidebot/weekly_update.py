"""Weekly update orchestrator — collect → generate → send to customer."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from curator.brain import agent
from curator.customers import CUSTOMERS, get_customer
from curator.slidebot import metrics_collector, deck_generator
from curator.storage import event_log, gdrive, gmail
from curator.listeners import slack_listener

logger = logging.getLogger(__name__)


def _format_weekly_summary(
    credits: dict[str, Any],
    highlights: str,
) -> str:
    """Format metrics + highlights into a clean markdown summary."""
    lines = [
        "# Weekly Update\n",
        "## Credit Usage",
        f"- **Used:** {credits.get('credits_used', '—')} / {credits.get('credit_limit', '—')}",
        f"- **Remaining:** {credits.get('credits_remaining', '—')}",
        f"- **Utilization:** {credits.get('utilization_pct', '—')}",
        f"- **Burn rate:** {credits.get('burn_rate', '—')} credits/day",
        "",
        "## Highlights",
        highlights,
    ]
    return "\n".join(lines)


async def run_weekly_update(customer_key: str) -> str:
    """Generate and send the weekly update for one customer.

    Steps:
    1. Collect metrics from credits and events
    2. Use Claude to generate narrative highlights
    3. Build slide deck from template
    4. Save summary to GDrive
    5. Send via email and Slack
    6. Log the event
    """
    customer = get_customer(customer_key)
    week_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    logger.info("[%s] Starting weekly update for %s", customer_key, week_str)

    # ── 1. Collect metrics ────────────────────────────────────────────────
    credits = await metrics_collector.get_credits(customer_key)
    events = await event_log.get_week(customer_key)

    # ── 2. Generate narrative highlights via Claude ───────────────────────
    highlights_prompt = (
        f"Summarize this week's activity for {customer.get('display_name', customer_key)}. "
        f"Credits: {credits}. Events: {events}. "
        f"Be concise, 3-5 bullet points. Focus on what matters to a CS manager."
    )
    highlights = await agent.run(customer_key, highlights_prompt)

    # ── 3. Build slide deck ───────────────────────────────────────────────
    deck_url = await deck_generator.create(
        template_id=None,  # uses default from config
        customer=customer,
        metrics=credits,
        credits=credits,
        highlights=highlights,
        events=events,
    )

    # ── 4. Save summary to GDrive ─────────────────────────────────────────
    from curator.customers import ensure_customer_drive_folder
    summary_md = _format_weekly_summary(credits, highlights)
    try:
        drive_id = await ensure_customer_drive_folder(customer_key)
        await gdrive.upload(drive_id, f"weekly-updates/{week_str}.md", summary_md)
    except Exception:
        logger.warning("Failed to save weekly summary to GDrive", exc_info=True)

    # ── 5. Send to customer ───────────────────────────────────────────────
    primary_contact = customer.get("contacts", {}).get("primary")
    if primary_contact:
        try:
            await gmail.send(
                from_addr=customer["email_alias"],
                to=primary_contact,
                subject=f"Kognitos Weekly Update — {week_str}",
                body=f"{summary_md}\n\n📊 Slide deck: {deck_url}",
            )
        except Exception:
            logger.warning("Failed to send weekly email", exc_info=True)

    slack_channel = customer.get("slack_channel")
    if slack_channel:
        try:
            await slack_listener.post_message(
                slack_channel,
                f"📊 Weekly update is ready: {deck_url}\n\n{summary_md}",
            )
        except Exception:
            logger.warning("Failed to post weekly update to Slack", exc_info=True)

    # ── 6. Log it ─────────────────────────────────────────────────────────
    await event_log.append(
        customer_key,
        "WEEKLY_UPDATE_SENT",
        {
            "deck_url": deck_url,
            "recipients": customer.get("contacts", {}),
            "week": week_str,
        },
        summary=f"Weekly update sent for {week_str}",
    )

    logger.info("[%s] Weekly update complete: %s", customer_key, deck_url)
    return deck_url


async def run_all_customers() -> dict[str, str]:
    """Run the weekly update for all customers.

    Returns a dict of customer_key → deck_url.
    """
    results: dict[str, str] = {}
    for customer_key in CUSTOMERS:
        try:
            deck_url = await run_weekly_update(customer_key)
            results[customer_key] = deck_url
        except Exception:
            logger.error("Weekly update failed for %s", customer_key, exc_info=True)
            results[customer_key] = "(failed)"
    return results
